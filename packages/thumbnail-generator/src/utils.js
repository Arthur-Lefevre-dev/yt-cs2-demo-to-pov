/**
 * Escape text for SVG.
 * @param {string} value
 */
export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Normalize map folder / display names.
 * @param {string | null | undefined} mapName
 */
export function normalizeMapKey(mapName) {
  if (!mapName) {
    return "unknown";
  }
  const raw = String(mapName).trim().toLowerCase().replace(/\s+/g, "_");
  if (raw.startsWith("de_") || raw.startsWith("cs_") || raw.startsWith("ar_")) {
    return raw;
  }
  return `de_${raw}`;
}

/**
 * Pretty map label for thumbnails / titles (de_nuke → Nuke).
 * @param {string | null | undefined} mapName
 */
export function formatMapLabel(mapName) {
  const key = normalizeMapKey(mapName);
  const bare = key.replace(/^(de_|cs_|ar_)/, "");
  if (!bare || bare === "unknown") {
    return "MAP";
  }
  return bare
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Score string for titles: "16-18" or custom.
 * @param {{ kills?: number, deaths?: number, score?: string }} input
 */
export function formatScore(input) {
  if (input.score && String(input.score).trim()) {
    return String(input.score).trim();
  }
  const kills = Number(input.kills ?? 0);
  const deaths = Number(input.deaths ?? 0);
  return `${kills}-${deaths}`;
}

/**
 * Prefer K-D parsed from "16-18" score text; else use kills/deaths fields.
 * @param {{ kills?: number, deaths?: number, score?: string }} input
 */
export function resolveKillsDeaths(input) {
  const score = input.score && String(input.score).trim();
  if (score) {
    const match = score.match(/^(\d+)\s*[-–]\s*(\d+)/);
    if (match) {
      return { kills: Number(match[1]), deaths: Number(match[2]) };
    }
  }
  return {
    kills: Number(input.kills ?? 0) || 0,
    deaths: Number(input.deaths ?? 0) || 0,
  };
}

/**
 * Spread kills evenly across rounds (fallback when per-round kills unknown).
 * @param {number} kills
 * @param {number} rounds
 */
export function distributeKillsAcrossRounds(kills, rounds) {
  const counts = Array.from({ length: rounds }, () => 0);
  if (rounds <= 0 || kills <= 0) {
    return counts;
  }
  for (let i = 0; i < kills; i++) {
    counts[i % rounds] += 1;
  }
  return counts;
}

/**
 * HLTV Rating 1.0 (public formula).
 * @param {{ kills?: number, deaths?: number, rounds?: number, rating?: number, roundKillCounts?: number[] }} input
 */
export function computeHltvRating(input) {
  if (input.rating != null && Number.isFinite(Number(input.rating))) {
    return Math.round(Number(input.rating) * 100) / 100;
  }
  const rounds = Math.max(0, Number(input.rounds) || 0);
  if (rounds <= 0) {
    return 0;
  }
  const kills = Math.max(0, Number(input.kills) || 0);
  const deaths = Math.max(0, Number(input.deaths) || 0);
  const counts =
    Array.isArray(input.roundKillCounts) && input.roundKillCounts.length === rounds
      ? input.roundKillCounts
      : distributeKillsAcrossRounds(kills, rounds);

  const kpr = kills / rounds;
  const spr = Math.max(0, (rounds - Math.min(deaths, rounds)) / rounds);
  let mkSum = 0;
  for (const k of counts) {
    if (k > 0) {
      mkSum += k * k;
    }
  }
  const rating = (kpr / 0.679 + 0.7 * (spr / 0.317) + mkSum / rounds / 1.277) / 2.7;
  return Math.round(rating * 100) / 100;
}

/**
 * Display label: "1.46 Rating"
 * @param {number} rating
 */
export function formatRatingLabel(rating) {
  const value = Number.isFinite(Number(rating)) ? Number(rating) : 0;
  return `${value.toFixed(2)} Rating`;
}

/**
 * YouTube title: NAME (SCORE) MAP POV DATE
 * @param {{ playerName: string, score: string, mapLabel: string, date?: Date }} input
 */
export function buildYoutubeTitle({ playerName, score, mapLabel, date = new Date() }) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${playerName} (${score}) ${mapLabel} POV ${day}/${month}/${year}`;
}

/**
 * Pick a random image path from a list.
 * @template T
 * @param {T[]} items
 * @param {() => number} [rng]
 */
export function pickRandom(items, rng = Math.random) {
  if (!items.length) {
    throw new Error("No items to pick from");
  }
  const index = Math.floor(rng() * items.length);
  return items[Math.min(index, items.length - 1)];
}
