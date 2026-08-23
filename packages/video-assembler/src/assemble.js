import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { resolveBinary, runProcess } from "./ffmpeg.js";

/**
 * Create a silent still-image clip from a lobby screenshot.
 */
export async function makeIntroClip({
  imagePath,
  outputPath,
  durationSeconds = 4,
  width = 3840,
  height = 2160,
  framerate = 60,
  ffmpegPath,
  onLog,
}) {
  const ffmpeg = resolveBinary("ffmpeg", ffmpegPath);
  const out = resolve(outputPath);
  await mkdir(dirname(out), { recursive: true });

  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    resolve(imagePath),
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t",
    String(durationSeconds),
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(framerate),
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ];

  await runProcess(ffmpeg, args, { onLog });
  return out;
}

/**
 * Re-encode a clip to a common profile so concat demuxer is safe.
 */
export async function normalizeClip({
  inputPath,
  outputPath,
  width = 3840,
  height = 2160,
  framerate = 60,
  ffmpegPath,
  onLog,
}) {
  const ffmpeg = resolveBinary("ffmpeg", ffmpegPath);
  const out = resolve(outputPath);
  await mkdir(dirname(out), { recursive: true });

  const args = [
    "-y",
    "-i",
    resolve(inputPath),
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${framerate}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    out,
  ];

  await runProcess(ffmpeg, args, { onLog });
  return out;
}

/**
 * Concatenate clips with the ffmpeg concat demuxer (same codec/params required).
 */
export async function concatClips({
  clipPaths,
  outputPath,
  workDir,
  ffmpegPath,
  onLog,
}) {
  if (!clipPaths?.length) {
    throw new Error("concatClips requires at least one clip");
  }

  const ffmpeg = resolveBinary("ffmpeg", ffmpegPath);
  const out = resolve(outputPath);
  const dir = resolve(workDir ?? dirname(out));
  await mkdir(dir, { recursive: true });

  const listPath = join(dir, "concat-list.txt");
  const listBody = clipPaths
    .map((clip) => {
      const absolute = resolve(clip).replaceAll("\\", "/");
      // Escape single quotes for concat demuxer
      const escaped = absolute.replaceAll("'", String.raw`'\''`);
      return `file '${escaped}'`;
    })
    .join("\n");
  await writeFile(listPath, `${listBody}\n`, "utf8");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    out,
  ];

  await runProcess(ffmpeg, args, { onLog });
  return out;
}

/**
 * Full assemble: optional intro image + round clips → one mp4.
 */
export async function assembleVideo({
  lobbyImagePath,
  introSeconds = 4,
  roundClipPaths,
  outputPath,
  workDir,
  width = 3840,
  height = 2160,
  framerate = 60,
  ffmpegPath,
  onLog,
}) {
  if (!roundClipPaths?.length) {
    throw new Error("assembleVideo requires at least one round clip");
  }

  const out = resolve(outputPath);
  const dir = resolve(workDir ?? join(dirname(out), "_assemble"));
  await mkdir(dir, { recursive: true });

  /** @type {string[]} */
  const normalized = [];

  if (lobbyImagePath) {
    const introPath = join(dir, "00-intro.mp4");
    await makeIntroClip({
      imagePath: lobbyImagePath,
      outputPath: introPath,
      durationSeconds: introSeconds,
      width,
      height,
      framerate,
      ffmpegPath,
      onLog,
    });
    normalized.push(introPath);
  }

  for (let index = 0; index < roundClipPaths.length; index += 1) {
    const input = roundClipPaths[index];
    const name = basename(input).replace(/\.[^.]+$/, "") || `round-${index + 1}`;
    const normalizedPath = join(dir, `${String(index + 1).padStart(2, "0")}-${name}.mp4`);
    await normalizeClip({
      inputPath: input,
      outputPath: normalizedPath,
      width,
      height,
      framerate,
      ffmpegPath,
      onLog,
    });
    normalized.push(normalizedPath);
  }

  await concatClips({
    clipPaths: normalized,
    outputPath: out,
    workDir: dir,
    ffmpegPath,
    onLog,
  });

  return {
    outputPath: out,
    workDir: dir,
    clipPaths: normalized,
    introIncluded: Boolean(lobbyImagePath),
    introSeconds: lobbyImagePath ? introSeconds : 0,
  };
}
