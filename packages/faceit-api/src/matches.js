/**
 * Rank recent FACEIT matches by match Rating (1.xx column on FACEIT), not K/D or Elo.
 */

import {
  extractDemoUrls,
  extractGameStatsRow,
  extractPlayerKd,
  faceitMatchRoomUrl,
  getMatch,
  getMatchStats,
  getPlayerGameStats,
  getPlayerHistory,
  lookupPlayer,
  sanitizeFaceitMatchId,
} from "./client.js";
import { upsertTrackedPlayer } from "./tracked-players.js";

/**
 * @param {string} apiKey
 * @param {import('./tracked-players.js').TrackedPlayer[]} players
 * @param {{ perPlayerLimit?: number, page?: number, pageSize?: number, storePath?: string }} [opts]
 */
export async function listBestRecentMatches(apiKey, players, opts = {}) {
  const perPlayerLimit = opts.perPlayerLimit ?? 15;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));

  /** @type {Array<object>} */
  const all = [];
  /** @type {string[]} */
  const errors = [];

  for (const tracked of players) {
    let faceitId = tracked.faceit_player_id;
    let nickname = tracked.nickname || tracked.display_name;

    try {
      // Mild pacing between players (FACEIT resets connections under burst).
      await new Promise((r) => setTimeout(r, 150));

      if (!faceitId) {
        const profile = await lookupPlayer(apiKey, {
          steamId: tracked.steam_id,
          nickname: tracked.nickname || tracked.display_name,
        });
        faceitId = profile.player_id;
        nickname = profile.nickname || nickname;
        if (opts.storePath && faceitId) {
          try {
            await upsertTrackedPlayer(opts.storePath, {
              steam_id: tracked.steam_id,
              faceit_player_id: faceitId,
              nickname: nickname || tracked.nickname,
              display_name: tracked.display_name,
              photo_path: tracked.photo_path,
              team_logo_path: tracked.team_logo_path,
            });
          } catch {
            // Non-fatal
          }
        }
      }

      /** @type {Map<string, ReturnType<typeof extractGameStatsRow>>} */
      const gameStatsByMatch = new Map();
      try {
        const gameStats = await getPlayerGameStats(apiKey, faceitId, {
          offset: 0,
          limit: perPlayerLimit,
        });
        for (const row of gameStats.items ?? []) {
          const parsed = extractGameStatsRow(row);
          if (parsed.match_id) {
            gameStatsByMatch.set(sanitizeFaceitMatchId(parsed.match_id), parsed);
          }
        }
      } catch {
        // Fall back to history rows below.
      }

      const history = await getPlayerHistory(apiKey, faceitId, {
        offset: 0,
        limit: perPlayerLimit,
      });

      for (const item of history.items ?? []) {
        const matchId = sanitizeFaceitMatchId(item.match_id);
        if (!matchId) {
          continue;
        }

        const fromGameStats = gameStatsByMatch.get(matchId);
        const rating = Number(fromGameStats?.faceit_rating ?? fromGameStats?.rating ?? 0) || 0;

        all.push({
          match_id: matchId,
          finished_at: item.finished_at ?? fromGameStats?.finished_at ?? null,
          competition_name: item.competition_name ?? null,
          faceit_url: faceitMatchRoomUrl(matchId),
          tracked_player_id: tracked.id,
          steam_id: tracked.steam_id,
          faceit_player_id: faceitId,
          nickname: nickname || tracked.display_name || tracked.steam_id,
          photo_path: tracked.photo_path ?? null,
          team_logo_path: tracked.team_logo_path ?? null,
          kills: fromGameStats?.kills ?? 0,
          deaths: fromGameStats?.deaths ?? 0,
          assists: fromGameStats?.assists ?? 0,
          kd: fromGameStats?.kd ?? 0,
          rounds: fromGameStats?.rounds ?? 0,
          rating,
          faceit_rating: rating,
          map: fromGameStats?.map ?? item.game_mode ?? null,
          result: fromGameStats?.result ?? null,
          demo_urls: [],
          has_demo: false,
          _needsStats: !(rating > 0),
        });
      }
    } catch (err) {
      const label = nickname || tracked.steam_id;
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  all.sort(
    (a, b) =>
      (b.faceit_rating ?? 0) - (a.faceit_rating ?? 0) ||
      (b.finished_at ?? 0) - (a.finished_at ?? 0),
  );

  const total = all.length;
  const start = (page - 1) * pageSize;
  const pageItems = all.slice(start, start + pageSize);

  // Enrich only the visible page (demos + missing Rating) — avoids hundreds of API calls.
  for (const row of pageItems) {
    try {
      const tasks = [getMatch(apiKey, row.match_id)];
      if (row._needsStats && row.faceit_player_id) {
        tasks.push(getMatchStats(apiKey, row.match_id));
      }
      const [match, stats] = await Promise.all(tasks);
      row.demo_urls = extractDemoUrls(match);
      row.has_demo = row.demo_urls.length > 0;
      if (!row.map && match?.voting?.map?.pick?.[0]) {
        row.map = match.voting.map.pick[0];
      }
      if (stats && row.faceit_player_id) {
        const extracted = extractPlayerKd(stats, row.faceit_player_id);
        row.kills = extracted.kills;
        row.deaths = extracted.deaths;
        row.assists = extracted.assists;
        row.kd = extracted.kd;
        row.rounds = extracted.rounds;
        row.rating = extracted.rating;
        row.faceit_rating = extracted.faceit_rating;
        row.result = extracted.result ?? row.result;
        row.map = extracted.map ?? row.map;
      }
    } catch {
      // Keep row without demos / extra stats.
    }
    delete row._needsStats;
    delete row.faceit_player_id;
  }

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize) || 1),
    items: pageItems,
    errors,
  };
}
