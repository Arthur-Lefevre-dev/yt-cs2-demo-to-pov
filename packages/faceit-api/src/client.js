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
 * Clean a match id (strip screenshot filename leftovers / extract from room URL).
 * Room URLs must be /cs2/room/{id} — never "...-lobby".
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function sanitizeFaceitMatchId(raw) {
  let id = String(raw ?? "").trim();
  if (!id) {
    return "";
  }
  const fromUrl = id.match(/\/room\/([^/?#]+)/i);
  if (fromUrl) {
    id = decodeURIComponent(fromUrl[1]);
  }
  // Accidental reuse of lobby screenshot basename: "1-uuid-lobby.jpg"
  id = id.replace(/-lobby(\.jpe?g|\.png|\.webp)?$/i, "");
  id = id.replace(/\.(jpe?g|png|webp)$/i, "");
  return id.trim();
}

/**
 * Build a public match room URL: https://www.faceit.com/en/cs2/room/{matchId}
 * @param {string} matchId
 * @param {string} [lang]
 */
export function faceitMatchRoomUrl(matchId, lang = "en") {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    return null;
  }
  return `https://www.faceit.com/${lang}/cs2/room/${id}`;
}

/**
 * @type {Promise<void>}
 */
let requestGate = Promise.resolve();

function enqueueRequest(ms = 120) {
  const run = requestGate.then(
    () => new Promise((resolve) => setTimeout(resolve, ms)),
    () => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  requestGate = run.catch(() => {});
  return run;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} err
 * @param {string} url
 */
function formatNetworkError(err, url) {
  const cause =
    err && typeof err === "object" && "cause" in err
      ? /** @type {{ code?: string, message?: string, syscall?: string, hostname?: string }} */ (
          err.cause
        )
      : null;
  const parts = [
    cause?.code,
    cause?.syscall,
    cause?.hostname,
    cause?.message,
    err instanceof Error ? err.message : String(err),
  ].filter(Boolean);
  const detail = [...new Set(parts)].join(" · ");
  return `FACEIT network error (${url}): ${detail || "fetch failed"}`;
}

/**
 * @param {string} apiKey
 * @param {string} path
 * @param {Record<string, string | number | undefined>} [query]
 * @param {{ retries?: number }} [opts]
 */
export async function faceitFetch(apiKey, path, query = {}, opts = {}) {
  if (!apiKey?.trim()) {
    throw new Error("FACEIT API key missing. Set FACEIT_API_KEY or save it in app settings.");
  }
  const retries = opts.retries ?? 3;
  const url = new URL(`${DATA_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  let lastError = /** @type {unknown} */ (null);
  for (let attempt = 0; attempt <= retries; attempt++) {
    await enqueueRequest(attempt === 0 ? 80 : 0);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if ([429, 502, 503, 504].includes(response.status) && attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new Error(`FACEIT ${response.status} ${path}: ${body.slice(0, 300)}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/^FACEIT (40[0-8]|41[0-9]|422)/.test(msg)) {
        throw err;
      }
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }
  throw new Error(formatNetworkError(lastError, url.toString()));
}

/**
 * Resolve FACEIT player by SteamID64 and/or nickname.
 * Steam lookup often 404s for CS2 — fall back to csgo game id, then nickname.
 * @param {string} apiKey
 * @param {{ steamId?: string, nickname?: string }} input
 */
export async function lookupPlayer(apiKey, { steamId, nickname }) {
  const attempts = [];
  const nick = nickname?.trim();
  const sid = steamId ? String(steamId).trim() : "";

  // Nickname first — Steam game_player_id often 404s and burns rate limit.
  if (nick) {
    attempts.push({ nickname: nick });
  }
  if (sid) {
    for (const game of ["cs2", "csgo"]) {
      attempts.push({ game, game_player_id: sid });
    }
  }

  if (attempts.length === 0) {
    throw new Error("lookupPlayer requires steamId or nickname");
  }

  /** @type {string[]} */
  const errors = [];
  for (const query of attempts) {
    try {
      return await faceitFetch(apiKey, "/players", query);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const label = nick || sid || "player";
  throw new Error(
    `FACEIT player not found for ${label}. Tried nickname then Steam (cs2/csgo).\n${errors.join("\n")}`,
  );
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
 * Per-match stats list for a player (often includes Rating / K/D / rounds).
 * @param {string} apiKey
 * @param {string} playerId
 * @param {{ offset?: number, limit?: number }} [opts]
 */
export async function getPlayerGameStats(apiKey, playerId, { offset = 0, limit = 15 } = {}) {
  return faceitFetch(apiKey, `/players/${playerId}/games/cs2/stats`, {
    offset,
    limit: Math.min(100, Math.max(1, limit)),
  });
}

/**
 * Match Rating as shown on FACEIT (≈0.5–3.5). Never confuse with Elo (~1000–5000).
 * @param {Record<string, unknown> | null | undefined} stats
 * @returns {number | null}
 */
export function parseMatchRating(stats) {
  if (!stats || typeof stats !== "object") {
    return null;
  }
  const raw =
    stats.Rating ??
    stats.rating ??
    stats["Match Rating"] ??
    stats["HLTV Rating"] ??
    stats["HLTV Rating 1.0"] ??
    stats.hltv_rating;
  const n = Number(raw);
  // Elo / level masquerading as Rating must be rejected.
  if (!Number.isFinite(n) || n <= 0 || n >= 10) {
    return null;
  }
  return Math.round(n * 100) / 100;
}

/**
 * Rough HLTV Rating 1.0 from match totals (fallback when API has no Rating field).
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
 * Read FACEIT Elo from a player profile payload (not match Rating).
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
 * Extract per-match stats for one FACEIT player (Rating du match, not Elo).
 * @param {object} statsPayload
 * @param {string} faceitPlayerId
 */
export function extractPlayerKd(statsPayload, faceitPlayerId) {
  const roundsPayload = statsPayload?.rounds ?? [];
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let mapName = null;
  let result = null;
  let roundsPlayed = 0;
  /** @type {number | null} */
  let apiMatchRating = null;

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
        const fromApi = parseMatchRating(st);
        if (fromApi != null) {
          apiMatchRating = fromApi;
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
  const computed = computeMatchRating({ kills, deaths, rounds: roundsPlayed });
  const rating = apiMatchRating != null ? apiMatchRating : computed;

  return {
    kills,
    deaths,
    assists,
    kd: Number(kd.toFixed(2)),
    rounds: roundsPlayed,
    rating,
    /** Match Rating (1.xx) — same as FACEIT "Rating" column. */
    faceit_rating: rating,
    map: mapName,
    result,
  };
}

/**
 * Normalize one row from GET /players/{id}/games/cs2/stats.
 * @param {object} item
 */
export function extractGameStatsRow(item) {
  const st = item?.stats ?? item ?? {};
  const matchId = String(st["Match Id"] ?? st.matchId ?? st.match_id ?? item?.match_id ?? "").trim();
  const kills = Number(st.Kills ?? st.kills ?? 0) || 0;
  const deaths = Number(st.Deaths ?? st.deaths ?? 0) || 0;
  const assists = Number(st.Assists ?? st.assists ?? 0) || 0;
  const rounds = Number(st.Rounds ?? st.rounds ?? 0) || 0;
  const kdRaw = Number(st["K/D Ratio"] ?? st.kd);
  const kd = Number.isFinite(kdRaw) ? Number(kdRaw.toFixed(2)) : deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
  const apiRating = parseMatchRating(st);
  const rating = apiRating != null ? apiRating : computeMatchRating({ kills, deaths, rounds });
  const resultRaw = st.Result ?? st.result;
  let result = null;
  if (resultRaw === "1" || resultRaw === 1 || /win/i.test(String(resultRaw))) {
    result = "win";
  } else if (resultRaw === "0" || resultRaw === 0 || /loss/i.test(String(resultRaw))) {
    result = "loss";
  }
  return {
    match_id: matchId || null,
    kills,
    deaths,
    assists,
    kd,
    rounds,
    rating,
    faceit_rating: rating,
    map: st.Map ?? st.map ?? null,
    result,
    finished_at: Number(st["Match Finished At"] ?? st.finished_at ?? 0) || null,
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
