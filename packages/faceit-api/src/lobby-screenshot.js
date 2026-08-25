/**
 * Capture a real screenshot of the public FACEIT match room page (1920×1080).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { faceitMatchRoomUrl, getMatch, normalizeFaceitUrl, sanitizeFaceitMatchId } from "./client.js";

const W = 1920;
const H = 1080;

/**
 * Normalize teams from FACEIT match payload into two sides (kept for unit tests / fallbacks).
 * @param {object} match
 */
export function extractLobbyTeams(match) {
  const teams = match?.teams ?? {};
  const keys = Object.keys(teams);
  const leftKey = keys.find((k) => /faction1|team1|ct/i.test(k)) ?? keys[0];
  const rightKey = keys.find((k) => k !== leftKey) ?? keys[1];
  const left = teams[leftKey] ?? { name: "Team A", roster: [] };
  const right = teams[rightKey] ?? { name: "Team B", roster: [] };
  const map =
    match?.voting?.map?.pick?.[0] ||
    match?.voting?.map?.entities?.find?.((e) => e?.status === "pick")?.guid ||
    null;
  const score = match?.results?.score ?? {};
  return {
    left: {
      name: left.name || leftKey || "Team A",
      avatar: left.avatar || null,
      roster: Array.isArray(left.roster) ? left.roster : [],
      score: score[leftKey] ?? score.faction1 ?? null,
    },
    right: {
      name: right.name || rightKey || "Team B",
      avatar: right.avatar || null,
      roster: Array.isArray(right.roster) ? right.roster : [],
      score: score[rightKey] ?? score.faction2 ?? null,
    },
    map,
    competition: match?.competition_name || "FACEIT",
    matchId: match?.match_id || null,
  };
}

/**
 * Dismiss common cookie / consent overlays when present.
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
  const candidates = [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Accepter")',
    'button:has-text("Tout accepter")',
    '[data-testid="cookie-accept"]',
    '#onetrust-accept-btn-handler',
  ];
  for (const selector of candidates) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 1500 });
        await page.waitForTimeout(400);
      }
    } catch {
      // Ignore missing consent UI.
    }
  }
}

/**
 * Screenshot the live FACEIT match room page.
 * @param {string} matchId
 * @param {string} outPath
 * @param {{ url?: string | null, lang?: string }} [opts]
 */
export async function captureFaceitRoomScreenshot(matchId, outPath, opts = {}) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    throw new Error("matchId is required");
  }
  // Always build the canonical room URL — never use "...-lobby" filenames as the page URL.
  const canonical = faceitMatchRoomUrl(id, opts.lang ?? "en");
  const fromOpt = normalizeFaceitUrl(opts.url, opts.lang ?? "en");
  const url =
    fromOpt && sanitizeFaceitMatchId(fromOpt) === id ? fromOpt : canonical;
  if (!url) {
    throw new Error("Cannot build FACEIT room URL");
  }

  const path = resolve(outPath);
  await mkdir(dirname(path), { recursive: true });

  // Prefer the standard user browser cache (not sandbox temp installs).
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const local =
      process.env.LOCALAPPDATA ||
      process.env.HOME ||
      process.env.USERPROFILE ||
      "";
    if (local) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = `${local.replace(/\\/g, "/")}/ms-playwright`;
    }
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    if (response && response.status() >= 400) {
      throw new Error(`FACEIT page returned HTTP ${response.status()} for ${url}`);
    }

    await dismissOverlays(page);

    // Wait for the room UI (roster / scoreboard) or fall back after a short settle.
    try {
      await page.waitForSelector(
        '[class*="MatchRoom"], [class*="match-room"], [class*="Roster"], [data-testid*="match"], main',
        { timeout: 25_000 },
      );
    } catch {
      await page.waitForTimeout(3_000);
    }

    // Extra settle for avatars / late JS.
    await page.waitForTimeout(2_000);
    await dismissOverlays(page);

    const title = await page.title().catch(() => "");
    if (/target lost|page not found|404/i.test(title) || /target lost/i.test(await page.content().catch(() => ""))) {
      throw new Error(`FACEIT room page looks like a 404: ${url}`);
    }

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 92,
      fullPage: false,
    });
    await writeFile(path, buffer);
    return { path, url, matchId: id };
  } finally {
    await browser.close();
  }
}

/**
 * @deprecated Synthetic SVG lobby — prefer captureFaceitRoomScreenshot.
 * Kept so older callers/tests still resolve.
 * @param {object} match
 * @param {string} outPath
 */
export async function renderLobbyScreenshot(match, outPath) {
  const matchId = match?.match_id || match?.id;
  if (!matchId) {
    throw new Error("renderLobbyScreenshot requires match.match_id — use captureFaceitRoomScreenshot");
  }
  const result = await captureFaceitRoomScreenshot(String(matchId), outPath, {
    url: match?.faceit_url,
  });
  return { path: result.path, lobby: extractLobbyTeams(match) };
}

/**
 * Fetch match metadata (optional) + capture real webpage screenshot.
 * @param {string} apiKey
 * @param {string} matchId
 * @param {string} outPath
 */
export async function generateFaceitLobbyScreenshot(apiKey, matchId, outPath) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    throw new Error("matchId is required");
  }
  // Prefer canonical room URL; optionally confirm match exists via API.
  try {
    await getMatch(apiKey, id);
  } catch {
    // Page capture does not require API — continue with constructed URL.
  }
  const result = await captureFaceitRoomScreenshot(id, outPath, {
    url: faceitMatchRoomUrl(id),
  });
  return { path: result.path, url: result.url, matchId: result.matchId };
}
