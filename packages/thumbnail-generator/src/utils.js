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
