import { resolveBinary, runProcess } from "../../video-assembler/src/ffmpeg.js";

/**
 * Probe media duration in seconds (float).
 */
export async function probeDurationSeconds(filePath, { ffprobePath } = {}) {
  const ffprobe = resolveBinary("ffprobe", ffprobePath);
  const { stdout } = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`ffprobe returned invalid duration for ${filePath}: ${stdout}`);
  }
  return duration;
}

/**
 * Format seconds as YouTube chapter timestamp.
 * < 1h → M:SS or MM:SS; ≥ 1h → H:MM:SS
 */
export function formatChapterTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * @typedef {object} ChapterClip
 * @property {string} label
 * @property {string} [path] if set, duration is probed
 * @property {number} [durationSeconds] used when path is omitted
 */

/**
 * Build YouTube chapter lines from ordered clips (intro + rounds).
 */
export async function buildChapters(clips, { ffprobePath } = {}) {
  if (!clips?.length) {
    throw new Error("buildChapters requires at least one clip");
  }

  let cursor = 0;
  /** @type {Array<{ label: string, startSeconds: number, durationSeconds: number, timestamp: string }>} */
  const entries = [];

  for (const clip of clips) {
    let duration = clip.durationSeconds;
    if (clip.path) {
      duration = await probeDurationSeconds(clip.path, { ffprobePath });
    }
    if (!Number.isFinite(duration)) {
      throw new Error(`Missing duration for chapter "${clip.label}"`);
    }
    entries.push({
      label: clip.label,
      startSeconds: cursor,
      durationSeconds: duration,
      timestamp: formatChapterTimestamp(cursor),
    });
    cursor += duration;
  }

  const text = entries.map((entry) => `${entry.timestamp} ${entry.label}`).join("\n");
  return { entries, text, totalSeconds: cursor };
}

/**
 * Convenience: intro + Round N (+ optional Sponsors after R1) from assembler result.
 * Optionally injects smoke chapter markers (3s before throw) inside round clips.
 * @param {object} assembleResult
 * @param {{
 *   ffprobePath?: string,
 *   roundLabels?: string[],
 *   smokeMarkers?: Array<{ roundNumber: number, offsetSeconds: number, label?: string }>,
 * }} [options]
 */
export async function chaptersFromAssembleResult(assembleResult, { ffprobePath, roundLabels, smokeMarkers } = {}) {
  /** @type {ChapterClip[]} */
  const clips = [];
  const paths = assembleResult.clipPaths ?? [];
  const kinds = assembleResult.clipKinds;
  const commercialLabel = assembleResult.commercialLabel || "Sponsors";
  const labels = roundLabels ?? assembleResult.roundLabels ?? [];
  let roundIndex = 0;
  /** @type {number[]} */
  const roundEntryIndexes = [];

  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];
    const kind =
      Array.isArray(kinds) && kinds[i]
        ? kinds[i]
        : assembleResult.introIncluded && i === 0
          ? "intro"
          : "round";

    if (kind === "intro") {
      clips.push({ label: "Lobby", path });
      continue;
    }
    if (kind === "commercial") {
      clips.push({ label: commercialLabel, path });
      continue;
    }
    const label = labels[roundIndex] || `Round ${roundIndex + 1}`;
    roundEntryIndexes.push(clips.length);
    clips.push({ label, path });
    roundIndex += 1;
  }

  const base = await buildChapters(clips, { ffprobePath });
  return injectSmokeMarkers(base, roundEntryIndexes, smokeMarkers ?? []);
}

/**
 * Insert smoke chapter lines inside round windows (YouTube markers only).
 * `markers[].roundIndex` is the index in the selected-rounds order (0 = first played round clip).
 * @param {{ entries: Array<object>, text: string, totalSeconds: number }} base
 * @param {number[]} roundEntryIndexes indexes into base.entries for each selected round
 * @param {Array<{ roundIndex: number, offsetSeconds: number, label?: string }>} markers
 */
export function injectSmokeMarkers(base, roundEntryIndexes, markers) {
  if (!markers?.length || !roundEntryIndexes?.length) {
    return base;
  }

  /** @type {Array<{ label: string, startSeconds: number, durationSeconds: number, timestamp: string }>} */
  const extra = [];
  for (const marker of markers) {
    const entryIndex = roundEntryIndexes[marker.roundIndex];
    if (entryIndex == null) {
      continue;
    }
    const roundEntry = base.entries[entryIndex];
    if (!roundEntry) {
      continue;
    }
    const offset = Math.max(0, Number(marker.offsetSeconds) || 0);
    if (offset >= roundEntry.durationSeconds) {
      continue;
    }
    const startSeconds = roundEntry.startSeconds + offset;
    extra.push({
      label: marker.label || "Smoke",
      startSeconds,
      durationSeconds: 0,
      timestamp: formatChapterTimestamp(startSeconds),
    });
  }

  const entries = [...base.entries, ...extra].sort((a, b) => a.startSeconds - b.startSeconds);
  const text = entries.map((entry) => `${entry.timestamp} ${entry.label}`).join("\n");
  return { entries, text, totalSeconds: base.totalSeconds };
}

/**
 * Build smoke markers for selected rounds from demo-parser `player_smokes` + `player_rounds`.
 * Offset is relative to the recorded clip start (freeze skip applied).
 * @param {object} input
 */
export function buildSmokeMarkersFromParse({
  playerSmokes = [],
  playerRounds = [],
  steamId,
  rounds = [],
  tickrate = 64,
}) {
  const rate = Math.max(1, Math.round(Number(tickrate) || 64));
  const selected = rounds.map(Number);
  /** @type {Array<{ roundIndex: number, offsetSeconds: number, label: string }>} */
  const markers = [];

  for (const smoke of playerSmokes) {
    if (steamId && String(smoke.steam_id) !== String(steamId)) {
      continue;
    }
    const roundIndex = selected.indexOf(Number(smoke.round_number));
    if (roundIndex < 0) {
      continue;
    }
    const row = playerRounds.find(
      (entry) =>
        String(entry.steam_id) === String(steamId || smoke.steam_id) &&
        Number(entry.round_number) === Number(smoke.round_number),
    );
    const clipStart = Number(row?.clip_start_tick ?? row?.round_start_tick ?? smoke.chapter_tick);
    const offsetSeconds = Math.max(0, (Number(smoke.chapter_tick) - clipStart) / rate);
    markers.push({
      roundIndex,
      offsetSeconds: Number(offsetSeconds.toFixed(2)),
      label: smoke.label || `Smoke R${smoke.round_number}`,
    });
  }
  return markers;
}
