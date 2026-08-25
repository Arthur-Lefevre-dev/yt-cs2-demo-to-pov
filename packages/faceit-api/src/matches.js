/**
 * Rank recent FACEIT matches for tracked players by Rating (performance), not K/D.
 */

import {
  extractDemoUrls,
  extractFaceitElo,
  extractPlayerKd,
  faceitMatchRoomUrl,
  getMatch,
  getMatchStats,
  getPlayerHistory,
  lookupPlayer,
  normalizeFaceitUrl,
} from "./client.js";

/**
 * @param {string} apiKey
 * @param {import('./tracked-players.js').TrackedPlayer[]} players
 * @param {{ perPlayerLimit?: number, page?: number, pageSize?: number }} [opts]
 */
export async function listBestRecentMatches(apiKey, players, opts = {}) {
  const perPlayerLimit = opts.perPlayerLimit ?? 15;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));

  /** @type {Array<object>} */
  const all = [];

  for (const tracked of players) {
    let faceitId = tracked.faceit_player_id;
    let nickname = tracked.nickname || tracked.display_name;
    let faceitElo = null;
    if (!faceitId || faceitElo == null) {
      const profile = await lookupPlayer(apiKey, {
        steamId: tracked.steam_id,
        nickname: tracked.nickname,
      });
      faceitId = faceitId || profile.player_id;
      nickname = profile.nickname || nickname;
      faceitElo = extractFaceitElo(profile);
    }

    const history = await getPlayerHistory(apiKey, faceitId, { offset: 0, limit: perPlayerLimit });
    const items = history.items ?? [];

    for (const item of items) {
      const matchId = item.match_id;
      if (!matchId) {
        continue;
      }
      let statsInfo = {
        kills: 0,
        deaths: 0,
        assists: 0,
        kd: 0,
        rounds: 0,
        rating: 0,
        faceit_elo: faceitElo,
        faceit_rating: 0,
        map: item.game_mode || null,
        result: null,
      };
      let demoUrls = [];
      try {
        const [stats, match] = await Promise.all([
          getMatchStats(apiKey, matchId),
          getMatch(apiKey, matchId),
        ]);
        statsInfo = extractPlayerKd(stats, faceitId, { faceitElo });
        demoUrls = extractDemoUrls(match);
        if (!statsInfo.map && match?.voting?.map?.pick?.[0]) {
          statsInfo.map = match.voting.map.pick[0];
        }
      } catch {
        // Stats may lag after match end — keep history row.
      }

      const faceitUrl =
        normalizeFaceitUrl(item.faceit_url) || faceitMatchRoomUrl(matchId);

      all.push({
        match_id: matchId,
        finished_at: item.finished_at ?? null,
        competition_name: item.competition_name ?? null,
        faceit_url: faceitUrl,
        tracked_player_id: tracked.id,
        steam_id: tracked.steam_id,
        nickname: nickname || tracked.display_name || tracked.steam_id,
        photo_path: tracked.photo_path ?? null,
        team_logo_path: tracked.team_logo_path ?? null,
        kills: statsInfo.kills,
        deaths: statsInfo.deaths,
        assists: statsInfo.assists,
        kd: statsInfo.kd,
        rounds: statsInfo.rounds,
        rating: statsInfo.rating,
        faceit_elo: statsInfo.faceit_elo ?? faceitElo,
        /** FACEIT Rating = Elo (integer). Falls back to performance rating. */
        faceit_rating: statsInfo.faceit_elo ?? faceitElo ?? statsInfo.rating,
        map: statsInfo.map,
        result: statsInfo.result,
        demo_urls: demoUrls,
        has_demo: demoUrls.length > 0,
      });
    }
  }

  all.sort(
    (a, b) =>
      (b.faceit_rating ?? 0) - (a.faceit_rating ?? 0) ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (b.finished_at ?? 0) - (a.finished_at ?? 0),
  );

  const total = all.length;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items,
  };
}
