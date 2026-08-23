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
 */
export async function chaptersFromAssembleResult(assembleResult, { ffprobePath, roundLabels } = {}) {
  /** @type {ChapterClip[]} */
  const clips = [];
  const paths = assembleResult.clipPaths ?? [];
  const kinds = assembleResult.clipKinds;
  const commercialLabel = assembleResult.commercialLabel || "Sponsors";
  let roundIndex = 0;

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
    const label = roundLabels?.[roundIndex] ?? `Round ${roundIndex + 1}`;
    clips.push({ label, path });
    roundIndex += 1;
  }
  return buildChapters(clips, { ffprobePath });
}
