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

const W = 1920;
const H = 1080;
/** Layout scale vs legacy 1280×720 canvas. */
const S = W / 1280;
/** Horizontal center of the text block (red zone — may overlap the player). */
const TEXT_X = Math.round(W * 0.62);
/** Player cutout on the left; text may overlap the right side of the figure. */
const PLAYER_WIDTH_RATIO = 0.5;
const PLAYER_HEIGHT_RATIO = 1;
const PLAYER_LEFT = Math.round(4 * S);
/** Fixed 4K badge — top-left (blue zone). */
const BRAND_LOGO_NAMES = ["4k-logo.png", "4k-logo.webp", "4k-logo.jpg", "4k-logo.jpeg", "4k-logo.svg"];
const BRAND_LOGO_MAX_W = Math.round(W * 0.2);
const BRAND_LOGO_MAX_H = Math.round(H * 0.15);
/** Top-left corner — keep flush left (blue zone). */
const BRAND_LOGO_LEFT = Math.round(4 * S);
const BRAND_LOGO_TOP = Math.round(16 * S);
/** Large watermark behind the player — left side of the frame (see POV thumbnail refs). */
const TEAM_LOGO_SIZE_RATIO = 1.05;
const TEAM_LOGO_OPACITY = 0.4;
/** Logo center as a fraction of the player column width (0 = left edge, 0.5 = middle). */
const TEAM_LOGO_ANCHOR_X = 0.28;
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

/**
 * Apply uniform opacity to an RGBA image buffer.
 * @param {Buffer} imageBuffer
 * @param {number} opacity 0–1
 */
async function applyImageOpacity(imageBuffer, opacity) {
  const alpha = Math.max(0, Math.min(1, opacity));
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * alpha);
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Team logo watermark on the LEFT behind the player (large translucent brand mark).
 * Returns a full-frame transparent PNG; composite order must be: logo → player → text.
 * @param {string} teamLogoPath
 * @param {{ opacity?: number, sizeRatio?: number }} [options]
 */
async function prepareTeamLogo(teamLogoPath, options = {}) {
  const opacity = options.opacity ?? TEAM_LOGO_OPACITY;
  const size = Math.round(H * (options.sizeRatio ?? TEAM_LOGO_SIZE_RATIO));
  const logoBuf = await sharp(teamLogoPath)
    .rotate()
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  const faded = await applyImageOpacity(logoBuf, opacity);
  const meta = await sharp(faded).metadata();
  const width = meta.width ?? size;
  const height = meta.height ?? size;

  // Anchor in the left player column so the mark sits behind the cutout
  // and peeks out on the left (the circled zone on POV thumbnails).
  const playerZoneW = Math.round(W * PLAYER_WIDTH_RATIO);
  const logoCenterX = PLAYER_LEFT + Math.round(playerZoneW * TEAM_LOGO_ANCHOR_X);
  let left = Math.round(logoCenterX - width / 2);
  let top = Math.round(H * 0.42 - height / 2);

  // Build a full-frame layer; crop if the logo bleeds past the canvas edges.
  let input = faded;
  let placeLeft = left;
  let placeTop = top;
  let srcLeft = 0;
  let srcTop = 0;
  let srcW = width;
  let srcH = height;

  if (left < 0) {
    srcLeft = -left;
    srcW = width + left;
    placeLeft = 0;
  }
  if (top < 0) {
    srcTop = -top;
    srcH = height + top;
    placeTop = 0;
  }
  if (placeLeft + srcW > W) {
    srcW = W - placeLeft;
  }
  if (placeTop + srcH > H) {
    srcH = H - placeTop;
  }

  if (srcW > 0 && srcH > 0 && (srcLeft > 0 || srcTop > 0 || srcW < width || srcH < height)) {
    input = await sharp(faded)
      .extract({ left: srcLeft, top: srcTop, width: srcW, height: srcH })
      .png()
      .toBuffer();
  }

  const layer = await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input,
        left: Math.max(0, placeLeft),
        top: Math.max(0, placeTop),
      },
    ])
    .png()
    .toBuffer();

  return {
    buffer: layer,
    left: 0,
    top: 0,
    width: W,
    height: H,
  };
}

/**
 * @param {Array<{ input: Buffer, left?: number, top?: number }>} layers
 */
function compositeThumbnail(bgBuf, layers) {
  return sharp(bgBuf)
    .composite(layers)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

function textShadowFilter(id, dx = Math.round(4 * S), dy = Math.round(4 * S)) {
  const blur = Math.round(2 * S);
  return `
    <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}" flood-color="#000" flood-opacity="0.85"/>
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
 * Bottom context line on the thumbnail:
 * - FACEIT → "FACEIT POV"
 * - Premier → "PREMIER POV"
 * - Tournament → event name, else matchup
 * @param {{
 *   matchKind?: string | null,
 *   eventName?: string | null,
 *   matchup?: string | null,
 * }} input
 */
export function resolveThumbContextLine({ matchKind, eventName, matchup } = {}) {
  const kind = String(matchKind ?? "").toLowerCase();
  if (kind === "faceit") {
    return "FACEIT POV";
  }
  if (kind === "premier") {
    return "PREMIER POV";
  }
  const event = eventName?.trim();
  if (event) {
    return event;
  }
  const teams = matchup?.trim();
  return teams || null;
}

/**
 * Resolve the fixed 4K badge from a brand assets folder.
 * @param {string | null | undefined} brandRoot
 * @param {string | null | undefined} mapsRoot used to infer sibling `brand/` folder
 */
export function resolveBrandLogoPath(brandRoot, mapsRoot) {
  const roots = [];
  if (brandRoot) {
    roots.push(resolve(brandRoot));
  }
  if (mapsRoot) {
    roots.push(resolve(mapsRoot, "..", "brand"));
  }
  for (const root of roots) {
    for (const name of BRAND_LOGO_NAMES) {
      const candidate = join(root, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Fixed 4K / brand mark in the top-left corner (blue zone).
 * @param {string} brandLogoPath
 */
async function prepareBrandLogo(brandLogoPath) {
  const buf = await sharp(brandLogoPath)
    .rotate()
    .resize(BRAND_LOGO_MAX_W, BRAND_LOGO_MAX_H, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer();
  return {
    buffer: buf,
    left: BRAND_LOGO_LEFT,
    top: BRAND_LOGO_TOP,
  };
}

/**
 * Style A — gold name + red kills (ZywOo-like).
 */
function svgStyleGoldKills({ playerName, score, ratingLabel, mapLabel, contextLine }) {
  const name = escapeXml(playerName.toUpperCase());
  const { left, right } = splitKillDeath(score);
  const kills = escapeXml(left);
  const second = right != null ? `-${escapeXml(right)}` : "";
  const hasContext = Boolean(contextLine);
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
    <text x="${TEXT_X}" y="${hasContext ? 340 : 370}" text-anchor="middle" fill="url(#gold)" font-size="${hasContext ? 250 : 290}" stroke="#1a1200" stroke-width="18" paint-order="stroke fill">${name}</text>
    <text x="${TEXT_X}" y="${hasContext ? 550 : 600}" text-anchor="middle" font-size="${hasContext ? 210 : 240}" stroke="#1a0000" stroke-width="16" paint-order="stroke fill">
      <tspan fill="#ff2a2a">${kills}</tspan>
      <tspan fill="#ffffff">${second}</tspan>
    </text>
    <text x="${TEXT_X}" y="${hasContext ? 695 : 770}" text-anchor="middle" fill="#ffffff" font-size="${hasContext ? 110 : 130}" stroke="#000" stroke-width="12" paint-order="stroke fill">${escapeXml(ratingLabel)}</text>
    <text x="${TEXT_X}" y="${hasContext ? 830 : 940}" text-anchor="middle" fill="#ffffff" font-size="${hasContext ? 95 : 115}" stroke="#000" stroke-width="12" paint-order="stroke fill">${escapeXml(mapLabel.toUpperCase())}</text>
    ${
      hasContext
        ? `<text x="${TEXT_X}" y="980" text-anchor="middle" fill="#f5c518" font-size="90" stroke="#000" stroke-width="11" paint-order="stroke fill">${escapeXml(contextLine)}</text>`
        : ""
    }
  </g>
</svg>`);
}

/**
 * Style B — white stack + yellow accents (ropz-like).
 */
function svgStyleStack({ playerName, score, ratingLabel, mapLabel, contextLine }) {
  const name = escapeXml(playerName);
  const hasContext = Boolean(contextLine);
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${textShadowFilter("s", 6, 6)}</defs>
  <g filter="url(#s)" font-family="Arial Black, Impact, sans-serif" font-weight="900" fill="#fff" stroke="#000"
     stroke-width="16" paint-order="stroke fill">
    <text x="${TEXT_X}" y="${hasContext ? 320 : 350}" text-anchor="middle" font-size="${hasContext ? 220 : 260}">${name}</text>
    <text x="${TEXT_X}" y="${hasContext ? 520 : 570}" text-anchor="middle" font-size="${hasContext ? 190 : 220}">${escapeXml(score)}</text>
    <text x="${TEXT_X}" y="${hasContext ? 665 : 740}" text-anchor="middle" font-size="${hasContext ? 100 : 115}" fill="#f5c518" stroke="#000">${escapeXml(ratingLabel)}</text>
    <text x="${TEXT_X}" y="${hasContext ? 800 : 910}" text-anchor="middle" font-size="${hasContext ? 95 : 110}" fill="#f5c518" stroke="#000">${escapeXml(mapLabel)} POV</text>
    ${
      hasContext
        ? `<text x="${TEXT_X}" y="960" text-anchor="middle" font-size="88" fill="#f5c518" stroke="#000">${escapeXml(contextLine)}</text>`
        : ""
    }
  </g>
</svg>`);
}

/**
 * Style C — big white italic name + score (m0NESY-like).
 */
function svgStyleItalic({ playerName, score, ratingLabel, mapLabel, contextLine }) {
  const name = escapeXml(playerName.toUpperCase());
  const hasContext = Boolean(contextLine);
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${textShadowFilter("s", 8, 8)}</defs>
  <g filter="url(#s)" font-family="Impact, Arial Black, sans-serif" font-style="italic" font-weight="900"
     fill="#ffffff" stroke="#000000" stroke-width="20" paint-order="stroke fill">
    <text x="${TEXT_X}" y="${hasContext ? 350 : 380}" text-anchor="middle" font-size="${hasContext ? 240 : 280}">${name}</text>
    <text x="${TEXT_X}" y="${hasContext ? 560 : 620}" text-anchor="middle" font-size="${hasContext ? 200 : 230}">${escapeXml(score)}</text>
    <text x="${TEXT_X}" y="${hasContext ? 710 : 800}" text-anchor="middle" font-size="${hasContext ? 105 : 120}" font-style="normal">${escapeXml(ratingLabel)}</text>
    <text x="${TEXT_X}" y="${hasContext ? 840 : 970}" text-anchor="middle" font-size="${hasContext ? 90 : 105}" font-style="normal">${escapeXml(mapLabel.toUpperCase())} POV</text>
    ${
      hasContext
        ? `<text x="${TEXT_X}" y="990" text-anchor="middle" font-size="86" font-style="normal" fill="#f5c518">${escapeXml(contextLine)}</text>`
        : ""
    }
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
    teamLogoPath,
    brandLogoPath: brandLogoOverride,
    brandRoot,
    showBrandLogo = true,
    playerName,
    mapName,
    kills,
    deaths,
    rounds,
    rating: ratingOverride,
    score: scoreOverride,
    matchKind,
    eventName,
    matchup,
    mapsRoot,
    backgroundPaths,
    outDir,
    date = new Date(),
    rng = Math.random,
  } = options;

  if (!playerPhotoPath || !existsSync(playerPhotoPath)) {
    throw new Error(`Player photo not found: ${playerPhotoPath}`);
  }
  if (teamLogoPath && !existsSync(teamLogoPath)) {
    throw new Error(`Team logo not found: ${teamLogoPath}`);
  }
  if (!playerName?.trim()) {
    throw new Error("playerName is required");
  }

  const brandLogoPath =
    showBrandLogo === false
      ? null
      : brandLogoOverride && existsSync(brandLogoOverride)
        ? resolve(brandLogoOverride)
        : resolveBrandLogoPath(brandRoot, mapsRoot);

  const customBackgrounds = (backgroundPaths ?? [])
    .map((path) => resolve(String(path)))
    .filter((path) => existsSync(path));
  if (backgroundPaths?.length && customBackgrounds.length === 0) {
    throw new Error("None of the selected screenshot backgrounds were found on disk.");
  }

  const outBase = resolve(outDir);
  await mkdir(outBase, { recursive: true });

  let backgrounds = customBackgrounds;
  let usedDir = null;
  if (backgrounds.length === 0) {
    const mapsBase = resolve(mapsRoot);
    const listed = await listMapBackgrounds(mapsBase, mapName);
    backgrounds = listed.files;
    usedDir = listed.dir;
  }

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
  const contextLine = resolveThumbContextLine({ matchKind, eventName, matchup });
  const title = buildYoutubeTitle({
    playerName: playerName.trim(),
    score,
    mapLabel,
    date,
    matchKind,
    eventName,
    matchup,
  });

  const playerBuf = await preparePlayerCutout(playerPhotoPath);
  const playerMeta = await sharp(playerBuf).metadata();
  const playerLeft = PLAYER_LEFT;
  const playerTop = Math.max(0, H - (playerMeta.height ?? Math.round(H * PLAYER_HEIGHT_RATIO)));
  const teamLogo = teamLogoPath ? await prepareTeamLogo(teamLogoPath) : null;
  const brandLogo = brandLogoPath ? await prepareBrandLogo(brandLogoPath) : null;
  const variants = [];

  for (let i = 0; i < STYLES.length; i++) {
    const style = STYLES[i];
    // Prefer selected screenshots 1:1 with variants; otherwise random map pool.
    const bgPath =
      customBackgrounds.length > 0
        ? customBackgrounds[i % customBackgrounds.length]
        : pickRandom(backgrounds, rng);
    const bgBuf = await prepareBackground(bgPath, style.mood);
    const svg = style.buildSvg({
      playerName: playerName.trim(),
      score,
      ratingLabel,
      mapLabel,
      contextLine,
    });

    /** @type {Array<{ input: Buffer, left?: number, top?: number }>} */
    const layers = [];
    if (teamLogo) {
      layers.push({
        input: teamLogo.buffer,
        left: teamLogo.left,
        top: teamLogo.top,
      });
    }
    layers.push({ input: playerBuf, left: playerLeft, top: playerTop });
    layers.push({ input: svg, top: 0, left: 0 });
    if (brandLogo) {
      layers.push({
        input: brandLogo.buffer,
        left: brandLogo.left,
        top: brandLogo.top,
      });
    }

    const composed = await compositeThumbnail(bgBuf, layers);

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
    matchKind: matchKind ?? null,
    eventName: eventName?.trim() || null,
    matchup: matchup?.trim() || null,
    contextLine,
    teamLogoPath: teamLogoPath ? resolve(teamLogoPath) : null,
    brandLogoPath: brandLogoPath ? resolve(brandLogoPath) : null,
    map: normalizeMapKey(mapName),
    mapLabel,
    mapsDir: usedDir,
    primaryBackground: backgroundPath,
    backgroundMode: customBackgrounds.length > 0 ? "screenshots" : "map-pool",
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
    matchKind: matchKind ?? null,
    eventName: eventName?.trim() || null,
    matchup: matchup?.trim() || null,
    contextLine,
    mapLabel,
    outDir: outBase,
    metaPath,
    variants,
  };
}

export { STYLES, W as THUMB_WIDTH, H as THUMB_HEIGHT, basename };
