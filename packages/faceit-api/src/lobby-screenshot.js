/**
 * Capture a real screenshot of the public FACEIT match room page (1920×1080).
 * Target UI: two-team roster + map + "WATCH DEMO" (not the Match Not Found 404).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import {
  faceitMatchRoomUrl,
  getMatch,
  normalizeFaceitUrl,
  sanitizeFaceitMatchId,
} from "./client.js";

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
 * Candidate match-room URLs (API URL first, then cs2 / csgo).
 * @param {string} matchId
 * @param {{ lang?: string, apiUrl?: string | null, game?: string | null }} [opts]
 */
export function buildRoomUrlCandidates(matchId, opts = {}) {
  const id = sanitizeFaceitMatchId(matchId);
  const lang = opts.lang ?? "en";
  /** @type {string[]} */
  const urls = [];
  const fromApi = normalizeFaceitUrl(opts.apiUrl, lang);
  if (fromApi) {
    urls.push(fromApi);
  }
  const games = [];
  if (opts.game) {
    games.push(String(opts.game).toLowerCase());
  }
  games.push("cs2", "csgo");
  for (const game of [...new Set(games)]) {
    urls.push(`https://www.faceit.com/${lang}/${game}/room/${id}`);
  }
  return [...new Set(urls.filter(Boolean))];
}

/**
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Accepter")',
    'button:has-text("Tout accepter")',
    '[data-testid="cookie-accept"]',
    "#onetrust-accept-btn-handler",
  ];
  for (const selector of candidates) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 700 })) {
        await btn.click({ timeout: 1500 });
        await page.waitForTimeout(350);
      }
    } catch {
      // Ignore missing consent UI.
    }
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function readPageSignal(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    if (
      /match not found/.test(lower) ||
      /the match you are looking for does not exist/.test(lower) ||
      /target lost/.test(lower) ||
      /this page does not exist/.test(lower)
    ) {
      return { kind: "not_found", text: text.slice(0, 200) };
    }
    const hasWatch = /watch demo|download demo|view demo/.test(lower);
    const hasMap = /mirage|dust|inferno|ancient|anubis|nuke|overpass|vertigo|train|italy|office/.test(
      lower,
    );
    const hasLobbyChrome = /veto|matchmaking|server|players/.test(lower);
    if (hasWatch || (hasMap && hasLobbyChrome)) {
      return { kind: "lobby", text: text.slice(0, 200) };
    }
    return { kind: "unknown", text: text.slice(0, 200) };
  });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 */
async function tryLoadLobby(page, url) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  // SPA often returns HTTP 200 even for Match Not Found.
  if (response && response.status() >= 400) {
    return { ok: false, reason: `HTTP ${response.status()}` };
  }

  await dismissOverlays(page);

  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const signal = await readPageSignal(page);
    if (signal.kind === "not_found") {
      return { ok: false, reason: "Match Not Found" };
    }
    if (signal.kind === "lobby") {
      // Let avatars / late widgets settle.
      await page.waitForTimeout(2_500);
      await dismissOverlays(page);
      const again = await readPageSignal(page);
      if (again.kind === "not_found") {
        return { ok: false, reason: "Match Not Found" };
      }
      if (again.kind === "lobby") {
        return { ok: true };
      }
    }
    await page.waitForTimeout(800);
  }

  const finalSignal = await readPageSignal(page);
  if (finalSignal.kind === "lobby") {
    return { ok: true };
  }
  if (finalSignal.kind === "not_found") {
    return { ok: false, reason: "Match Not Found" };
  }
  return { ok: false, reason: `Lobby UI not detected (${finalSignal.text.slice(0, 80)})` };
}

/**
 * Screenshot the live FACEIT match room page.
 * @param {string} matchId
 * @param {string} outPath
 * @param {{ url?: string | null, lang?: string, game?: string | null }} [opts]
 */
export async function captureFaceitRoomScreenshot(matchId, outPath, opts = {}) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    throw new Error("matchId is required");
  }

  const candidates = buildRoomUrlCandidates(id, {
    lang: opts.lang ?? "en",
    apiUrl: opts.url,
    game: opts.game,
  });
  if (candidates.length === 0) {
    throw new Error("Cannot build FACEIT room URL");
  }

  const path = resolve(outPath);
  await mkdir(dirname(path), { recursive: true });

  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const local =
      process.env.LOCALAPPDATA || process.env.HOME || process.env.USERPROFILE || "";
    if (local) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = `${local.replace(/\\/g, "/")}/ms-playwright`;
    }
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  /** @type {string[]} */
  const attempts = [];

  try {
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();

    let usedUrl = candidates[0];
    let loaded = false;
    for (const url of candidates) {
      usedUrl = url;
      const result = await tryLoadLobby(page, url);
      if (result.ok) {
        loaded = true;
        break;
      }
      attempts.push(`${url} → ${result.reason}`);
    }

    if (!loaded) {
      throw new Error(
        `FACEIT lobby not found (got Match Not Found / empty room).\nTried:\n- ${attempts.join("\n- ")}`,
      );
    }

    // Prefer centering on the match overview (Watch Demo area) when possible.
    try {
      const watch = page.getByText(/watch demo|download demo/i).first();
      if (await watch.isVisible({ timeout: 1500 })) {
        await watch.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      }
    } catch {
      // Screenshot full viewport anyway.
    }

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 92,
      fullPage: false,
    });
    await writeFile(path, buffer);
    return { path, url: usedUrl, matchId: id };
  } finally {
    await browser.close();
  }
}

/**
 * Build a local FACEIT-like lobby HTML (fallback when www.faceit.com returns Match Not Found).
 * @param {ReturnType<typeof extractLobbyTeams>} lobby
 */
export function buildLobbyHtml(lobby) {
  const mapLabel = lobby.map
    ? String(lobby.map).replace(/^de_/i, "").replace(/_/g, " ").toUpperCase()
    : "MAP";
  const leftScore = lobby.left.score != null ? String(lobby.left.score) : "–";
  const rightScore = lobby.right.score != null ? String(lobby.right.score) : "–";

  function playerCard(p, side) {
    const nick = escapeHtml(p.nickname || p.game_player_name || "Player");
    const lvl = p.game_skill_level ?? p.skill_level;
    const lvlLabel = lvl != null ? `L${lvl}` : "";
    const avatar = p.avatar
      ? `<img class="avatar" src="${escapeHtml(p.avatar)}" alt="" />`
      : `<div class="avatar placeholder"></div>`;
    return `<div class="player ${side}">${avatar}<div class="meta"><div class="nick">${nick}</div><div class="lvl">${lvlLabel}</div></div></div>`;
  }

  const leftPlayers = (lobby.left.roster || []).slice(0, 5).map((p) => playerCard(p, "left")).join("");
  const rightPlayers = (lobby.right.roster || []).slice(0, 5).map((p) => playerCard(p, "right")).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #0b0d10; color: #fff;
    font-family: "Segoe UI", Arial, sans-serif; }
  .wrap { display: grid; grid-template-columns: 1fr 420px 1fr; height: 100%; gap: 0; }
  .col { padding: 48px 36px; display: flex; flex-direction: column; gap: 18px; }
  .col.left { background: linear-gradient(90deg, #12151a 0%, #0b0d10 100%); }
  .col.right { background: linear-gradient(270deg, #12151a 0%, #0b0d10 100%); }
  .center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    border-left: 1px solid #232833; border-right: 1px solid #232833; background: #0e1116; }
  .brand { color: #ff5500; letter-spacing: 0.35em; font-weight: 800; font-size: 18px; }
  .comp { color: #9aa3b2; font-size: 15px; }
  .teams { display: flex; gap: 18px; align-items: baseline; font-size: 28px; font-weight: 800; }
  .score { color: #ff5500; font-size: 56px; font-weight: 900; letter-spacing: 0.08em; }
  .map { color: #e8ecf2; font-size: 22px; font-weight: 700; margin-top: 4px; }
  .watch { margin-top: 10px; color: #ff5500; font-weight: 800; letter-spacing: 0.12em; font-size: 16px; }
  .cta { margin-top: 8px; background: #ff5500; color: #fff; border: none; border-radius: 4px;
    padding: 14px 28px; font-weight: 800; letter-spacing: 0.08em; font-size: 14px; }
  .player { display: flex; align-items: center; gap: 14px; background: #161a22; border: 1px solid #2a3140;
    border-radius: 10px; padding: 12px 14px; min-height: 78px; }
  .player.right { flex-direction: row-reverse; text-align: right; }
  .avatar { width: 54px; height: 54px; border-radius: 8px; object-fit: cover; background: #2a3140; }
  .avatar.placeholder { background: #2a3140; }
  .nick { font-weight: 700; font-size: 18px; }
  .lvl { color: #9aa3b2; font-size: 13px; margin-top: 2px; }
  .team-name { color: #ffb088; font-weight: 700; font-size: 15px; letter-spacing: 0.06em; margin-bottom: 4px; }
  .col.right .team-name { text-align: right; }
  .match-id { position: absolute; bottom: 16px; left: 0; right: 0; text-align: center; color: #4a5568; font-size: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="col left">
      <div class="team-name">${escapeHtml(lobby.left.name || "TEAM A")}</div>
      ${leftPlayers}
    </div>
    <div class="center">
      <div class="brand">FACEIT</div>
      <div class="comp">${escapeHtml(lobby.competition || "FACEIT")}</div>
      <div class="score">${escapeHtml(leftScore)} : ${escapeHtml(rightScore)}</div>
      <div class="map">${escapeHtml(mapLabel)}</div>
      <div class="watch">WATCH DEMO</div>
      <div class="cta">BACK TO MATCHMAKING</div>
    </div>
    <div class="col right">
      <div class="team-name">${escapeHtml(lobby.right.name || "TEAM B")}</div>
      ${rightPlayers}
    </div>
  </div>
  <div class="match-id">${escapeHtml(lobby.matchId || "")}</div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Screenshot a local FACEIT-like lobby HTML built from match roster data.
 * @param {object} match
 * @param {string} outPath
 */
export async function captureSyntheticLobbyScreenshot(match, outPath) {
  const lobby = extractLobbyTeams(match);
  const html = buildLobbyHtml(lobby);
  const path = resolve(outPath);
  await mkdir(dirname(path), { recursive: true });

  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const local =
      process.env.LOCALAPPDATA || process.env.HOME || process.env.USERPROFILE || "";
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
    });
    await page.setContent(html, { waitUntil: "load" });
    // Wait for remote avatars if any.
    await page.waitForTimeout(1_200);
    const buffer = await page.screenshot({ type: "jpeg", quality: 92, fullPage: false });
    await writeFile(path, buffer);
    return { path, url: "synthetic://faceit-lobby", matchId: lobby.matchId, lobby };
  } finally {
    await browser.close();
  }
}

/**
 * @deprecated Prefer generateFaceitLobbyScreenshot.
 * @param {object} match
 * @param {string} outPath
 */
export async function renderLobbyScreenshot(match, outPath) {
  return captureSyntheticLobbyScreenshot(match, outPath);
}

/**
 * Fetch match metadata + capture real webpage screenshot of the lobby.
 * Falls back to a local FACEIT-styled lobby when the website returns Match Not Found.
 * @param {string} apiKey
 * @param {string} matchId
 * @param {string} outPath
 */
export async function generateFaceitLobbyScreenshot(apiKey, matchId, outPath) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    throw new Error("matchId is required");
  }

  let match = null;
  let apiUrl = null;
  let game = "cs2";
  try {
    match = await getMatch(apiKey, id);
    apiUrl = normalizeFaceitUrl(match?.faceit_url) || null;
    if (match?.game) {
      game = String(match.game);
    }
  } catch {
    // Continue with constructed URLs / optional synthetic fallback.
  }

  try {
    const result = await captureFaceitRoomScreenshot(id, outPath, {
      url: apiUrl || faceitMatchRoomUrl(id),
      game,
    });
    return { path: result.path, url: result.url, matchId: result.matchId, source: "web" };
  } catch (webErr) {
    if (!match) {
      throw webErr;
    }
    // Website often shows Match Not Found to headless browsers — use API roster fallback.
    const fallback = await captureSyntheticLobbyScreenshot(match, outPath);
    return {
      path: fallback.path,
      url: fallback.url,
      matchId: id,
      source: "synthetic",
      webError: webErr instanceof Error ? webErr.message : String(webErr),
    };
  }
}
