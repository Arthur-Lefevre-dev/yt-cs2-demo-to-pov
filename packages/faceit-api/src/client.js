/**
 * Minimal FACEIT Data API v4 client (server API key).
 * Docs: https://docs.faceit.com/
 */

const DATA_BASE = "https://open.faceit.com/data/v4";

/**
 * FACEIT history often returns faceit_url with a literal "{lang}" placeholder.
 * @param {string | null | undefined} url
 * @param {string} [lang]
 * @returns {string | null}
 */
export function normalizeFaceitUrl(url, lang = "en") {
  if (!url || typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replaceAll("%7Blang%7D", lang)
    .replaceAll("%7blang%7d", lang)
    .replaceAll("{lang}", lang);
}

/**
 * Build a public match room URL.
 * @param {string} matchId
 * @param {string} [lang]
 */
export function faceitMatchRoomUrl(matchId, lang = "en") {
  const id = String(matchId || "").trim();
  if (!id) {
    return null;
  }
  return `https://www.faceit.com/${lang}/cs2/room/${id}`;
}

/**
 * @param {string} apiKey
 * @param {string} path
 * @param {Record<string, string | number | undefined>} [query]
 */
export async function faceitFetch(apiKey, path, query = {}) {
  if (!apiKey?.trim()) {
    throw new Error("FACEIT API key missing. Set FACEIT_API_KEY or save it in app settings.");
  }
  const url = new URL(`${DATA_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`FACEIT ${response.status} ${path}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

/**
 * Resolve FACEIT player by SteamID64 or nickname.
 * @param {string} apiKey
 * @param {{ steamId?: string, nickname?: string }} input
 */
export async function lookupPlayer(apiKey, { steamId, nickname }) {
  if (steamId) {
    return faceitFetch(apiKey, "/players", { game: "cs2", game_player_id: String(steamId) });
  }
  if (nickname) {
    return faceitFetch(apiKey, "/players", { nickname: String(nickname) });
  }
  throw new Error("lookupPlayer requires steamId or nickname");
}

/**
 * Last matches for a FACEIT player_id.
 * @param {string} apiKey
 * @param {string} playerId
 * @param {{ offset?: number, limit?: number }} [opts]
 */
export async function getPlayerHistory(apiKey, playerId, { offset = 0, limit = 15 } = {}) {
  return faceitFetch(apiKey, `/players/${playerId}/history`, {
    game: "cs2",
    offset,
    limit: Math.min(100, Math.max(1, limit)),
  });
}

/**
 * Match details (may include demo URLs).
 * @param {string} apiKey
 * @param {string} matchId
 */
export async function getMatch(apiKey, matchId) {
  return faceitFetch(apiKey, `/matches/${matchId}`);
}

/**
 * Per-player match stats (K/D etc.).
 * @param {string} apiKey
 * @param {string} matchId
 */
export async function getMatchStats(apiKey, matchId) {
  return faceitFetch(apiKey, `/matches/${matchId}/stats`);
}

/**
 * Rough HLTV Rating 1.0 from match totals (used when FACEIT Elo is missing).
 * @param {{ kills: number, deaths: number, rounds: number }} input
 */
export function computeMatchRating({ kills, deaths, rounds }) {
  const r = Math.max(0, Number(rounds) || 0);
  if (r <= 0) {
    return 0;
  }
  const k = Math.max(0, Number(kills) || 0);
  const d = Math.max(0, Number(deaths) || 0);
  const kpr = k / r;
  const spr = Math.max(0, (r - Math.min(d, r)) / r);
  // Approximate multi-kill term from average kills/round.
  const avg = k / r;
  const mkSum = avg * avg * r;
  const rating = (kpr / 0.679 + 0.7 * (spr / 0.317) + mkSum / r / 1.277) / 2.7;
  return Math.round(rating * 100) / 100;
}

/**
 * Read FACEIT Elo ("Rating") from a player profile payload.
 * @param {object} profile
 * @returns {number | null}
 */
export function extractFaceitElo(profile) {
  const games = profile?.games ?? {};
  const cs2 = games.cs2 ?? games.csgo ?? {};
  const elo = Number(cs2.faceit_elo ?? cs2.elo ?? profile?.faceit_elo);
  return Number.isFinite(elo) && elo > 0 ? Math.round(elo) : null;
}

/**
 * Extract performance stats + FACEIT Rating (Elo) for one player.
 * @param {object} statsPayload
 * @param {string} faceitPlayerId
 * @param {{ faceitElo?: number | null }} [opts]
 */
export function extractPlayerKd(statsPayload, faceitPlayerId, opts = {}) {
  const roundsPayload = statsPayload?.rounds ?? [];
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let mapName = null;
  let result = null;
  let roundsPlayed = 0;
  let faceitElo =
    opts.faceitElo != null && Number.isFinite(Number(opts.faceitElo))
      ? Math.round(Number(opts.faceitElo))
      : null;

  for (const round of roundsPayload) {
    const rs = round.round_stats ?? {};
    if (!mapName && rs.Map) {
      mapName = String(rs.Map);
    }
    const roundCount = Number(rs.Rounds ?? rs.rounds ?? 0);
    if (Number.isFinite(roundCount) && roundCount > roundsPlayed) {
      roundsPlayed = roundCount;
    }
    for (const team of round.teams ?? []) {
      for (const player of team.players ?? []) {
        if (String(player.player_id) !== String(faceitPlayerId)) {
          continue;
        }
        const st = player.player_stats ?? {};
        kills += Number(st.Kills ?? st.kills ?? 0) || 0;
        deaths += Number(st.Deaths ?? st.deaths ?? 0) || 0;
        assists += Number(st.Assists ?? st.assists ?? 0) || 0;
        const eloFromStats = Number(
          st.Elo ?? st.ELO ?? st.Rating ?? st["Faceit Elo"] ?? st.faceit_elo,
        );
        if (Number.isFinite(eloFromStats) && eloFromStats > 0) {
          faceitElo = Math.round(eloFromStats);
        }
        if (result == null && team.team_stats?.["Team Win"] != null) {
          result = Number(team.team_stats["Team Win"]) === 1 ? "win" : "loss";
        }
      }
    }
  }

  if (roundsPlayed <= 0 && roundsPayload.length > 0) {
    // FACEIT often stores totals in a single "round" entry — estimate from score.
    const score = String(roundsPayload[0]?.round_stats?.Score ?? "");
    const parts = score.match(/(\d+)\s*\/\s*(\d+)/);
    if (parts) {
      roundsPlayed = Number(parts[1]) + Number(parts[2]);
    }
  }

  const kd = deaths > 0 ? kills / deaths : kills;
  const rating = computeMatchRating({ kills, deaths, rounds: roundsPlayed });

  return {
    kills,
    deaths,
    assists,
    kd: Number(kd.toFixed(2)),
    rounds: roundsPlayed,
    rating,
    faceit_elo: faceitElo,
    /** Performance Rating used for ranking (replaces K/D). */
    faceit_rating: rating,
    map: mapName,
    result,
  };
}

/**
 * Collect demo URL(s) from match details if present.
 * @param {object} match
 * @returns {string[]}
 */
export function extractDemoUrls(match) {
  const urls = [];
  const demo = match?.demo_url ?? match?.demoUrl;
  if (Array.isArray(demo)) {
    for (const item of demo) {
      if (typeof item === "string" && item.trim()) {
        urls.push(item.trim());
      }
    }
  } else if (typeof demo === "string" && demo.trim()) {
    urls.push(demo.trim());
  }
  return urls;
}
