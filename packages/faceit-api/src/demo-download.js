/**
 * Resolve + download FACEIT demos.
 *
 * Data API returns private demos.faceit.com URLs (ENOTFOUND in public DNS).
 * Some scraped CDN hosts (e.g. demos-us-east.backblaze.faceit-cdn.net) also fail DNS.
 * Most reliable path: open the match room in Chromium and save the Watch Demo download.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { chromium } from "playwright";
import { faceitMatchRoomUrl, sanitizeFaceitMatchId } from "./client.js";

const DOWNLOAD_API = "https://open.faceit.com/download/v2/demos/download";

function ensurePlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return;
  }
  const local =
    process.env.LOCALAPPDATA || process.env.HOME || process.env.USERPROFILE || "";
  if (local) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = `${local.replace(/\\/g, "/")}/ms-playwright`;
  }
}

/**
 * Hosts that look like FACEIT CDN but never resolve in public DNS
 * (often scraped incorrectly from the match room JS).
 * @param {string} hostname
 */
export function isBrokenFaceitDemoHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) {
    return true;
  }
  // Private resource host from Data API
  if (h === "demos.faceit.com") {
    return true;
  }
  // Malformed scrape e.g. demos-us-east.backblaze.faceit-cdn.net
  if (/\.backblaze\.faceit-cdn\.net$/i.test(h)) {
    return true;
  }
  return false;
}

/**
 * @param {string} url
 */
export function isDirectDemoDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (isBrokenFaceitDemoHost(u.hostname)) {
      return false;
    }
    if (/X-Amz-|Signature=|Expires=/i.test(u.search)) {
      return true;
    }
    if (
      /faceit-cdn\.net|amazonaws\.com|backblazeb2\.com|googleapis\.com/i.test(u.hostname)
    ) {
      return true;
    }
    return /\.dem(\.gz|\.zst)?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Reject hosts that do not resolve (common FACEIT scrape garbage).
 * @param {string} url
 */
export async function hostnameResolves(url) {
  try {
    const { hostname } = new URL(url);
    if (isBrokenFaceitDemoHost(hostname)) {
      return false;
    }
    await lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} apiKey
 * @param {string} resourceUrl
 * @returns {Promise<string | null>}
 */
export async function signDemoUrlViaDownloadsApi(apiKey, resourceUrl) {
  if (!apiKey?.trim() || !resourceUrl?.trim()) {
    return null;
  }
  try {
    const response = await fetch(DOWNLOAD_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resource_url: resourceUrl.trim() }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const signed =
      json?.payload?.download_url ||
      json?.download_url ||
      json?.payload?.url ||
      null;
    if (typeof signed !== "string" || !signed.startsWith("http")) {
      return null;
    }
    if (!(await hostnameResolves(signed))) {
      return null;
    }
    return signed;
  } catch {
    return null;
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    "#onetrust-accept-btn-handler",
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 700 })) {
        await btn.click({ timeout: 1500 });
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Room URL candidates for a match.
 * @param {string} matchId
 */
function roomCandidates(matchId) {
  const id = sanitizeFaceitMatchId(matchId);
  return [
    faceitMatchRoomUrl(id, "en"),
    `https://www.faceit.com/en/csgo/room/${id}`,
    `https://www.faceit.com/en/cs2/room/${id}`,
  ].filter(Boolean);
}

/**
 * Download demo by clicking Watch Demo in Chromium (uses browser network/DNS).
 * @param {string} matchId
 * @param {string} outPath final .dem path
 */
export async function downloadDemoViaBrowserClick(matchId, outPath) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    throw new Error("matchId is required for browser demo download");
  }
  ensurePlaywrightBrowsersPath();

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });

  const tmpDir = join(dirname(resolve(outPath)), `.demo-dl-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1400, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    const page = await context.newPage();

    /** @type {{ url: string, body: Buffer }[]} */
    const demoBodies = [];
    page.on("response", (response) => {
      const u = response.url();
      if (!/\.dem(\.gz|\.zst)?(\?|$)/i.test(u) && !/\/demo[s]?\/.*\.(gz|zst)/i.test(u)) {
        return;
      }
      // Capture bytes from Chromium (avoids Node DNS ENOTFOUND on bad scraped hosts).
      void response
        .body()
        .then((body) => {
          if (body && body.length > 1024) {
            demoBodies.push({ url: u, body: Buffer.from(body) });
          }
        })
        .catch(() => {});
    });

    let loaded = false;
    for (const url of roomCandidates(id)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await dismissOverlays(page);
      await page.waitForTimeout(2_000);
      const body = ((await page.locator("body").innerText().catch(() => "")) || "").toLowerCase();
      if (/match not found|does not exist|target lost/.test(body)) {
        continue;
      }
      loaded = true;
      break;
    }
    if (!loaded) {
      throw new Error("FACEIT match room not available in browser (Match Not Found)");
    }

    const clickSelectors = [
      'button:has-text("Watch Demo")',
      'a:has-text("Watch Demo")',
      'button:has-text("WATCH DEMO")',
      'a:has-text("WATCH DEMO")',
      'button:has-text("Download demo")',
      'a:has-text("Download demo")',
      'button:has-text("View Demo")',
      'a:has-text("View Demo")',
    ];

    /** @type {import('playwright').Download | null} */
    let download = null;
    for (const sel of clickSelectors) {
      try {
        const el = page.locator(sel).first();
        if (!(await el.isVisible({ timeout: 1_500 }))) {
          continue;
        }
        const waitDownload = page.waitForEvent("download", { timeout: 90_000 });
        await el.click({ timeout: 3_000 });
        try {
          download = await waitDownload;
        } catch {
          // May stream in-page instead of a download event.
        }
        if (download) {
          break;
        }
        // Give response listener time to capture demo bytes.
        await page.waitForTimeout(8_000);
        if (demoBodies.length > 0) {
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (download) {
      const suggested = download.suggestedFilename() || "faceit-demo.dem.gz";
      const tempFile = join(tmpDir, suggested);
      await download.saveAs(tempFile);
      await materializeDemFile(tempFile, outPath);
      return { path: resolve(outPath), downloadUrl: download.url(), source: "browser-click" };
    }

    if (demoBodies.length > 0) {
      const best = demoBodies.sort((a, b) => b.body.length - a.body.length)[0];
      const ext = /\.zst/i.test(best.url)
        ? ".dem.zst"
        : /\.gz/i.test(best.url)
          ? ".dem.gz"
          : ".dem";
      const tempFile = join(tmpDir, `captured${ext}`);
      await writeFile(tempFile, best.body);
      await materializeDemFile(tempFile, outPath);
      return { path: resolve(outPath), downloadUrl: best.url, source: "browser-response" };
    }

    throw new Error('Could not trigger FACEIT "Watch Demo" download in browser');
  } finally {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Turn a downloaded archive/file into a .dem at outPath.
 * @param {string} downloadedPath
 * @param {string} outPath
 */
async function materializeDemFile(downloadedPath, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  const lower = downloadedPath.toLowerCase();
  const target = resolve(outPath);

  if (lower.endsWith(".zst") || lower.includes(".dem.zst")) {
    throw new Error(
      "Demo is .zst compressed. Extract manually (zstd) or use FACEIT site download, then import the .dem.",
    );
  }

  if (lower.endsWith(".gz") || lower.includes(".dem.gz")) {
    const raw = await readFile(downloadedPath);
    // Gunzip via zlib stream from buffer
    const { Readable: NodeReadable } = await import("node:stream");
    await pipeline(NodeReadable.from(raw), createGunzip(), createWriteStream(target));
    return;
  }

  // Already a .dem (or unknown) — copy/rename.
  await rename(downloadedPath, target).catch(async () => {
    await writeFile(target, await readFile(downloadedPath));
  });
}

/**
 * Open room and collect candidate demo URLs (for Node fetch fallback).
 * @param {string} matchId
 * @returns {Promise<string[]>}
 */
export async function resolveDemoUrlsViaBrowser(matchId) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    return [];
  }
  ensurePlaywrightBrowsersPath();

  /** @type {string[]} */
  const found = [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    page.on("response", (response) => {
      const u = response.url();
      if (/\.dem(\.gz|\.zst)?(\?|$)/i.test(u) || /demo.*\.(gz|zst)/i.test(u)) {
        found.push(u);
      }
    });

    for (const url of roomCandidates(id)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await dismissOverlays(page);
      await page.waitForTimeout(1_500);
      const body = ((await page.locator("body").innerText().catch(() => "")) || "").toLowerCase();
      if (/match not found|does not exist/.test(body)) {
        continue;
      }
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")].map((a) => a.href).filter(Boolean),
      );
      found.push(...hrefs.filter((h) => /\.dem(\.gz|\.zst)?/i.test(h)));
      break;
    }

    const unique = [...new Set(found)].filter((u) => /^https?:\/\//i.test(u));
    /** @type {string[]} */
    const resolvable = [];
    for (const u of unique) {
      try {
        if (isBrokenFaceitDemoHost(new URL(u).hostname)) {
          continue;
        }
      } catch {
        continue;
      }
      if (await hostnameResolves(u)) {
        resolvable.push(u);
      }
    }
    return resolvable;
  } finally {
    await browser.close();
  }
}

/** @deprecated use resolveDemoUrlsViaBrowser */
export async function resolveDemoUrlViaBrowser(matchId) {
  const urls = await resolveDemoUrlsViaBrowser(matchId);
  return urls[0] || null;
}

/**
 * @param {{ apiKey?: string, resourceUrl: string, matchId?: string | null }} input
 */
export async function resolveDemoDownloadUrl(input) {
  const resourceUrl = String(input.resourceUrl || "").trim();
  if (!resourceUrl) {
    throw new Error("Demo resource URL is empty");
  }

  if (
    isDirectDemoDownloadUrl(resourceUrl) &&
    !/demos\.faceit\.com/i.test(resourceUrl) &&
    (await hostnameResolves(resourceUrl))
  ) {
    return resourceUrl;
  }

  const signed = await signDemoUrlViaDownloadsApi(input.apiKey || "", resourceUrl);
  if (signed) {
    return signed;
  }

  const matchId = sanitizeFaceitMatchId(input.matchId) || sanitizeFaceitMatchId(resourceUrl);
  if (matchId) {
    const fromBrowser = await resolveDemoUrlsViaBrowser(matchId);
    if (fromBrowser[0]) {
      return fromBrowser[0];
    }
  }

  throw new Error(
    "Cannot resolve a reachable demo download URL (DNS ENOTFOUND on FACEIT CDN hosts).",
  );
}

/**
 * Fetch bytes with Node fetch (only for hosts that resolve).
 * @param {string} downloadUrl
 * @param {string} outPath
 */
async function downloadWithNodeFetch(downloadUrl, outPath) {
  const response = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(180_000),
    headers: {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Download failed HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Download response has no body");
  }

  const body = Readable.fromWeb(response.body);
  const urlLower = downloadUrl.toLowerCase();
  if (/\.zst(\?|$)/i.test(downloadUrl)) {
    throw new Error("Demo is .zst compressed — extract manually then import the .dem.");
  }
  const isGz = urlLower.includes(".dem.gz") || urlLower.includes(".gz?");
  if (isGz && outPath.toLowerCase().endsWith(".dem")) {
    await pipeline(body, createGunzip(), createWriteStream(outPath));
  } else {
    await pipeline(body, createWriteStream(outPath));
  }
  return { path: outPath, downloadUrl, source: "node-fetch" };
}

/**
 * Download (and gunzip if needed) a FACEIT demo to outPath (.dem).
 * Prefers Chromium "Watch Demo" click — avoids broken CDN DNS hostnames.
 * @param {{ apiKey?: string, url: string, matchId?: string | null, outPath: string }} input
 */
export async function downloadFaceitDemo(input) {
  const outPath = resolve(input.outPath);
  await mkdir(dirname(outPath), { recursive: true });
  const matchId = sanitizeFaceitMatchId(input.matchId) || sanitizeFaceitMatchId(input.url);

  /** @type {string | null} */
  let browserError = null;

  // 1) Most reliable: browser triggers the real download (Watch Demo).
  // Avoids scraped hosts like demos-us-east.backblaze.faceit-cdn.net (ENOTFOUND).
  if (matchId) {
    try {
      return await downloadDemoViaBrowserClick(matchId, outPath);
    } catch (browserErr) {
      browserError = browserErr instanceof Error ? browserErr.message : String(browserErr);
    }
  }

  // 2) Resolve a DNS-reachable URL then Node fetch.
  try {
    const downloadUrl = await resolveDemoDownloadUrl({
      apiKey: input.apiKey,
      resourceUrl: input.url,
      matchId,
    });
    if (!(await hostnameResolves(downloadUrl))) {
      throw new Error(`CDN host does not resolve: ${new URL(downloadUrl).hostname}`);
    }
    return await downloadWithNodeFetch(downloadUrl, outPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Demo download failed.\n` +
        (browserError ? `Browser: ${browserError}\n` : "") +
        `Fetch: ${detail}\n` +
        `Tip: open the match on faceit.com → Watch Demo, then Import the .dem manually.`,
    );
  }
}
