import { readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  buildYoutubeTitle,
  computeHltvRating,
  escapeXml,
  formatMapLabel,
  formatRatingLabel,
  formatScore,
  normalizeMapKey,
  pickRandom,
  resolveKillsDeaths,
} from "./utils.js";

const W = 1280;
const H = 720;
/** Horizontal center for the text column (right of the player cutout). */
const TEXT_X = 900;
/** Player cutout fills most of the left side without covering the text block. */
const PLAYER_WIDTH_RATIO = 0.54;
const PLAYER_HEIGHT_RATIO = 1;
const PLAYER_LEFT = 8;
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * @param {string} mapsRoot
 * @param {string} mapKey
 */
export async function listMapBackgrounds(mapsRoot, mapKey) {
  const key = normalizeMapKey(mapKey);
  const candidates = [
    join(mapsRoot, key),
    join(mapsRoot, key.replace(/^de_/, "")),
    join(mapsRoot, "_default"),
  ];

  for (const dir of candidates) {
    if (!existsSync(dir)) {
      continue;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && IMAGE_EXTS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(dir, entry.name));
    if (files.length > 0) {
      return { dir, files, key };
    }
  }

  throw new Error(
    `No map backgrounds for "${key}". Put images in fixtures/thumbnails/maps/${key}/ (jpg/png/webp).`,
  );
}

/**
 * Blurred / saturated gameplay background.
 * @param {string} imagePath
 * @param {"blur" | "pop" | "warm"} mood
 */
async function prepareBackground(imagePath, mood) {
  let pipeline = sharp(imagePath).rotate().resize(W, H, { fit: "cover", position: "centre" });

  if (mood === "blur") {
    pipeline = pipeline.blur(8).modulate({ saturation: 0.75, brightness: 0.85 });
  } else if (mood === "pop") {
    pipeline = pipeline.modulate({ saturation: 1.35, brightness: 1.05 });
  } else {
    pipeline = pipeline.modulate({ saturation: 1.2, brightness: 1.0 }).tint("#ffaa66");
  }

  return pipeline.png().toBuffer();
}

/**
 * Player cutout scaled on the left side.
 * @param {string} playerPhotoPath
 */
async function preparePlayerCutout(playerPhotoPath) {
  const targetH = Math.round(H * PLAYER_HEIGHT_RATIO);
  const targetW = Math.round(W * PLAYER_WIDTH_RATIO);
  return sharp(playerPhotoPath)
    .rotate()
    .resize(targetW, targetH, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      position: "bottom",
    })
    .png()
    .toBuffer();
}

function textShadowFilter(id, dx = 4, dy = 4) {
  return `
    <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="${dx}" dy="${dy}" stdDeviation="2" flood-color="#000" flood-opacity="0.85"/>
    </filter>`;
}

/**
 * Split "16-18" into kill / death parts for colored rendering.
 * @param {string} score
 */
function splitKillDeath(score) {
  const match = String(score).match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (!match) {
    return { left: String(score), right: null };
  }
  return { left: match[1], right: match[2] };
}

/**
 * Style A — gold name + red kills (ZywOo-like).
 */
function svgStyleGoldKills({ playerName, score, ratingLabel, mapLabel }) {
  const name = escapeXml(playerName.toUpperCase());
  const { left, right } = splitKillDeath(score);
  const kills = escapeXml(left);
  const second = right != null ? `-${escapeXml(right)}` : "";
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${textShadowFilter("s")}
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe566"/>
      <stop offset="55%" stop-color="#f5c518"/>
      <stop offset="100%" stop-color="#c99700"/>
    </linearGradient>
  </defs>
  <g filter="url(#s)" font-family="Impact, Arial Black, sans-serif" font-weight="900">
    <text x="${TEXT_X}" y="210" text-anchor="middle" fill="url(#gold)" font-size="148" stroke="#1a1200" stroke-width="12" paint-order="stroke fill">${name}</text>
    <text x="${TEXT_X}" y="360" text-anchor="middle" font-size="128" stroke="#1a0000" stroke-width="10" paint-order="stroke fill">
      <tspan fill="#ff2a2a">${kills}</tspan>
      <tspan fill="#ffffff">${second}</tspan>
    </text>
    <text x="${TEXT_X}" y="460" text-anchor="middle" fill="#ffffff" font-size="72" stroke="#000" stroke-width="8" paint-order="stroke fill">${escapeXml(ratingLabel)}</text>
    <text x="${TEXT_X}" y="560" text-anchor="middle" fill="#ffffff" font-size="64" stroke="#000" stroke-width="8" paint-order="stroke fill">${escapeXml(mapLabel.toUpperCase())}</text>
  </g>
</svg>`);
}

/**
 * Style B — white stack + yellow accents (ropz-like).
 */
function svgStyleStack({ playerName, score, ratingLabel, mapLabel }) {
  const name = escapeXml(playerName);
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${textShadowFilter("s", 3, 3)}</defs>
  <g filter="url(#s)" font-family="Arial Black, Impact, sans-serif" font-weight="900" fill="#fff" stroke="#000"
     stroke-width="10" paint-order="stroke fill">
    <text x="${TEXT_X}" y="180" text-anchor="middle" font-size="148">${name}</text>
    <text x="${TEXT_X}" y="320" text-anchor="middle" font-size="124">${escapeXml(score)}</text>
    <text x="${TEXT_X}" y="420" text-anchor="middle" font-size="68" fill="#f5c518" stroke="#000">${escapeXml(ratingLabel)}</text>
    <text x="${TEXT_X}" y="520" text-anchor="middle" font-size="64" fill="#f5c518" stroke="#000">${escapeXml(mapLabel)} POV</text>
  </g>
</svg>`);
}

/**
 * Style C — big white italic name + score (m0NESY-like).
 */
function svgStyleItalic({ playerName, score, ratingLabel, mapLabel }) {
  const name = escapeXml(playerName.toUpperCase());
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${textShadowFilter("s", 5, 5)}</defs>
  <g filter="url(#s)" font-family="Impact, Arial Black, sans-serif" font-style="italic" font-weight="900"
     fill="#ffffff" stroke="#000000" stroke-width="14" paint-order="stroke fill">
    <text x="${TEXT_X}" y="220" text-anchor="middle" font-size="168">${name}</text>
    <text x="${TEXT_X}" y="380" text-anchor="middle" font-size="136">${escapeXml(score)}</text>
    <text x="${TEXT_X}" y="490" text-anchor="middle" font-size="72" font-style="normal">${escapeXml(ratingLabel)}</text>
    <text x="${TEXT_X}" y="590" text-anchor="middle" font-size="56" font-style="normal">${escapeXml(mapLabel.toUpperCase())} POV</text>
  </g>
</svg>`);
}

const STYLES = [
  { id: "gold-kills", mood: "blur", buildSvg: svgStyleGoldKills },
  { id: "stack", mood: "pop", buildSvg: svgStyleStack },
  { id: "italic", mood: "warm", buildSvg: svgStyleItalic },
];

/**
 * Generate 3 YouTube thumbnail variants + title.
 * @param {object} options
 */
export async function generateThumbnails(options) {
  const {
    playerPhotoPath,
    playerName,
    mapName,
    kills,
    deaths,
    rounds,
    rating: ratingOverride,
    score: scoreOverride,
    mapsRoot,
    outDir,
    date = new Date(),
    rng = Math.random,
  } = options;

  if (!playerPhotoPath || !existsSync(playerPhotoPath)) {
    throw new Error(`Player photo not found: ${playerPhotoPath}`);
  }
  if (!playerName?.trim()) {
    throw new Error("playerName is required");
  }

  const mapsBase = resolve(mapsRoot);
  const outBase = resolve(outDir);
  await mkdir(outBase, { recursive: true });

  const { files: backgrounds, dir: usedDir } = await listMapBackgrounds(mapsBase, mapName);
  const backgroundPath = pickRandom(backgrounds, rng);
  const mapLabel = formatMapLabel(mapName);
  const score = formatScore({ kills, deaths, score: scoreOverride });
  const { kills: resolvedKills, deaths: resolvedDeaths } = resolveKillsDeaths({
    kills,
    deaths,
    score: scoreOverride,
  });
  const hltvRating = computeHltvRating({
    kills: resolvedKills,
    deaths: resolvedDeaths,
    rounds,
    rating: ratingOverride,
  });
  const ratingLabel = formatRatingLabel(hltvRating);
  const title = buildYoutubeTitle({
    playerName: playerName.trim(),
    score,
    mapLabel,
    date,
  });

  const playerBuf = await preparePlayerCutout(playerPhotoPath);
  const playerMeta = await sharp(playerBuf).metadata();
  const playerLeft = PLAYER_LEFT;
  const playerTop = Math.max(0, H - (playerMeta.height ?? Math.round(H * PLAYER_HEIGHT_RATIO)));
  const variants = [];

  for (let i = 0; i < STYLES.length; i++) {
    const style = STYLES[i];
    // Each variant can use a different random bg from the same map pool.
    const bgPath = pickRandom(backgrounds, rng);
    const bgBuf = await prepareBackground(bgPath, style.mood);
    const svg = style.buildSvg({
      playerName: playerName.trim(),
      score,
      ratingLabel,
      mapLabel,
    });

    const composed = await sharp(bgBuf)
      .composite([
        { input: playerBuf, left: playerLeft, top: playerTop },
        { input: svg, top: 0, left: 0 },
      ])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    const fileName = `thumb-v${i + 1}-${style.id}.jpg`;
    const filePath = join(outBase, fileName);
    await writeFile(filePath, composed);

    variants.push({
      id: style.id,
      index: i + 1,
      path: filePath,
      backgroundPath: bgPath,
      dataUrl: `data:image/jpeg;base64,${composed.toString("base64")}`,
    });
  }

  const metaPath = join(outBase, "thumbnail-meta.json");
  const meta = {
    title,
    playerName: playerName.trim(),
    score,
    hltvRating,
    ratingLabel,
    map: normalizeMapKey(mapName),
    mapLabel,
    mapsDir: usedDir,
    primaryBackground: backgroundPath,
    variants: variants.map(({ dataUrl, ...rest }) => rest),
    generatedAt: date.toISOString(),
  };
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await writeFile(join(outBase, "youtube-title.txt"), `${title}\n`, "utf8");

  return {
    title,
    score,
    hltvRating,
    ratingLabel,
    mapLabel,
    outDir: outBase,
    metaPath,
    variants,
  };
}

export { STYLES, W as THUMB_WIDTH, H as THUMB_HEIGHT, basename };
