/**
 * Propose gameplay screenshot backgrounds from recorded POV clips / final video.
 */

import { mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import {
  probeDurationSeconds,
  resolveBinary,
  runProcess,
} from "../../video-assembler/src/ffmpeg.js";

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".mov", ".webm"]);

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listVideosInDir(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && VIDEO_EXTS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Discover candidate video sources from a job work directory.
 * Prefers final.mp4, then CSDM round clips, then any mp4 under workDir.
 * @param {string} workDir
 * @param {string | null | undefined} videoPath
 */
export async function discoverJobVideos(workDir, videoPath) {
  const root = resolve(workDir);
  /** @type {{ path: string, label: string }[]} */
  const sources = [];

  if (videoPath && existsSync(videoPath)) {
    sources.push({ path: resolve(videoPath), label: "final" });
  }

  const finalInJob = join(root, "final.mp4");
  if (existsSync(finalInJob) && !sources.some((s) => s.path === resolve(finalInJob))) {
    sources.push({ path: finalInJob, label: "final" });
  }

  const csdmDir = join(root, "csdm");
  for (const clip of await listVideosInDir(csdmDir)) {
    sources.push({ path: clip, label: basename(clip) });
  }

  if (sources.length === 0) {
    for (const clip of await listVideosInDir(root)) {
      sources.push({ path: clip, label: basename(clip) });
    }
  }

  return sources;
}

/**
 * Build up to `count` sample points: (videoPath, seconds, label).
 * @param {{ path: string, label: string }[]} sources
 * @param {number} count
 */
export async function planScreenshotMoments(sources, count = 10) {
  if (sources.length === 0) {
    throw new Error(
      "No recorded POV video found. Finish a render (final.mp4 or CSDM round clips) first.",
    );
  }

  const target = Math.max(1, Math.min(30, Math.round(count)));
  /** @type {{ videoPath: string, seconds: number, label: string, sourceLabel: string }[]} */
  const moments = [];

  const finalSource = sources.find((s) => s.label === "final");
  if (finalSource) {
    const duration = await probeDurationSeconds(finalSource.path);
    const skipStart = duration > 45 ? Math.min(12, duration * 0.08) : Math.min(2, duration * 0.05);
    const skipEnd = Math.min(4, duration * 0.04);
    const usable = Math.max(0.5, duration - skipStart - skipEnd);
    for (let i = 0; i < target; i++) {
      const t = skipStart + ((i + 0.5) / target) * usable;
      moments.push({
        videoPath: finalSource.path,
        seconds: Number(t.toFixed(2)),
        label: `Moment ${i + 1}`,
        sourceLabel: "final",
      });
    }
    return moments;
  }

  // Spread samples across round clips (prefer mid + late action).
  const ratios = [0.35, 0.55, 0.72];
  let index = 0;
  outer: for (const source of sources) {
    const duration = await probeDurationSeconds(source.path);
    for (const ratio of ratios) {
      if (moments.length >= target) {
        break outer;
      }
      index += 1;
      const t = Math.max(0.2, Math.min(duration - 0.2, duration * ratio));
      moments.push({
        videoPath: source.path,
        seconds: Number(t.toFixed(2)),
        label: `R${index} · ${source.label}`,
        sourceLabel: source.label,
      });
    }
  }

  while (moments.length < target && sources.length > 0) {
    const source = sources[moments.length % sources.length];
    const duration = await probeDurationSeconds(source.path);
    const t = Math.max(0.2, duration * (0.4 + (moments.length % 5) * 0.08));
    moments.push({
      videoPath: source.path,
      seconds: Number(Math.min(duration - 0.15, t).toFixed(2)),
      label: `Extra ${moments.length + 1}`,
      sourceLabel: source.label,
    });
  }

  return moments.slice(0, target);
}

/**
 * Extract one JPEG frame at `seconds` from a video.
 * @param {string} videoPath
 * @param {number} seconds
 * @param {string} outPath
 * @param {{ ffmpegPath?: string }} [options]
 */
export async function extractFrameAt(videoPath, seconds, outPath, options = {}) {
  const ffmpeg = resolveBinary("ffmpeg", options.ffmpegPath);
  await runProcess(ffmpeg, [
    "-y",
    "-ss",
    String(Math.max(0, seconds)),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outPath,
  ]);
}

/**
 * Propose `count` gameplay screenshots for thumbnail background picker.
 * @param {object} options
 * @param {string} options.workDir
 * @param {string} [options.videoPath]
 * @param {string} options.outDir
 * @param {number} [options.count=10]
 */
export async function proposeThumbnailScreenshots(options) {
  const workDir = resolve(options.workDir);
  const outDir = resolve(options.outDir);
  const count = options.count ?? 10;
  await mkdir(outDir, { recursive: true });

  const sources = await discoverJobVideos(workDir, options.videoPath);
  const moments = await planScreenshotMoments(sources, count);

  /** @type {Array<{ id: string, index: number, path: string, label: string, seconds: number, sourceLabel: string, dataUrl: string }>} */
  const proposals = [];

  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i];
    const fileName = `proposal-${String(i + 1).padStart(2, "0")}.jpg`;
    const filePath = join(outDir, fileName);
    await extractFrameAt(moment.videoPath, moment.seconds, filePath);
    const buf = await readFile(filePath);
    proposals.push({
      id: `p${i + 1}`,
      index: i + 1,
      path: filePath,
      label: moment.label,
      seconds: moment.seconds,
      sourceLabel: moment.sourceLabel,
      dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
    });
  }

  return {
    outDir,
    count: proposals.length,
    proposals,
  };
}
