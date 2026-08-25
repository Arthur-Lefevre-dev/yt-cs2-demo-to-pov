/**
 * Resolve a downloadable FACEIT demo URL and save it to disk.
 *
 * Data API `demo_url` values point at demos.faceit.com which does NOT resolve in public DNS.
 * A signed CDN URL is required (Downloads API), with a browser fallback on the match room page.
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { chromium } from "playwright";
import { faceitMatchRoomUrl, sanitizeFaceitMatchId } from "./client.js";

const DOWNLOAD_API = "https://open.faceit.com/download/v2/demos/download";

/**
 * True when the URL is already a signed / CDN download link.
 * @param {string} url
 */
export function isDirectDemoDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (/X-Amz-|Signature=|Expires=/i.test(u.search)) {
      return true;
    }
    if (/faceit-cdn\.net|amazonaws\.com|backblazeb2\.com/i.test(u.hostname)) {
      return true;
    }
    // demos.faceit.com is a private resource hostname (ENOTFOUND publicly).
    if (/^demos\.faceit\.com$/i.test(u.hostname)) {
      return false;
    }
    return /\.dem(\.gz|\.zst)?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Ask FACEIT Downloads API for a signed URL (requires Downloads API scope on the key).
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
    return typeof signed === "string" && signed.startsWith("http") ? signed : null;
  } catch {
    return null;
  }
}

/**
 * Open the public match room and capture a CDN demo URL (network intercept + link scrape).
 * @param {string} matchId
 * @returns {Promise<string | null>}
 */
export async function resolveDemoUrlViaBrowser(matchId) {
  const id = sanitizeFaceitMatchId(matchId);
  if (!id) {
    return null;
  }
  const roomUrl = faceitMatchRoomUrl(id);
  if (!roomUrl) {
    return null;
  }

  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const local =
      process.env.LOCALAPPDATA || process.env.HOME || process.env.USERPROFILE || "";
    if (local) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = `${local.replace(/\\/g, "/")}/ms-playwright`;
    }
  }

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
      if (
        /\.dem(\.gz|\.zst)?(\?|$)/i.test(u) ||
        (/faceit-cdn\.net|backblazeb2\.com|amazonaws\.com/i.test(u) &&
          /demo|\.dem/i.test(u))
      ) {
        found.push(u);
      }
    });

    await page.goto(roomUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2500);

    // Accept cookies if shown.
    for (const sel of [
      'button:has-text("Accept")',
      'button:has-text("Accept all")',
      "#onetrust-accept-btn-handler",
    ]) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 600 })) {
          await btn.click({ timeout: 1500 });
        }
      } catch {
        // ignore
      }
    }

    // Prefer explicit demo anchors / buttons on the room page.
    const hrefs = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll("a[href]")) {
        const href = a.href || "";
        if (/\.dem(\.gz|\.zst)?/i.test(href) || /demo/i.test(href)) {
          out.push(href);
        }
      }
      return out;
    });
    found.push(...hrefs);

    const clickCandidates = [
      'a:has-text("Download demo")',
      'button:has-text("Download demo")',
      'a:has-text("Download")',
      'button:has-text("Download")',
      '[data-testid*="demo"]',
      'a[href*=".dem"]',
    ];
    for (const sel of clickCandidates) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 800 })) {
          await el.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(1500);
          break;
        }
      } catch {
        // ignore
      }
    }

    await page.waitForTimeout(1500);

    const unique = [...new Set(found)].filter((u) => /^https?:\/\//i.test(u));
    // Prefer CDN / signed URLs over demos.faceit.com resource links.
    const preferred =
      unique.find((u) => /faceit-cdn\.net|amazonaws\.com|backblazeb2\.com|X-Amz-/i.test(u)) ||
      unique.find((u) => /\.dem/i.test(u) && !/demos\.faceit\.com/i.test(u)) ||
      unique[0] ||
      null;
    return preferred;
  } finally {
    await browser.close();
  }
}

/**
 * Resolve a working HTTP(S) URL to download the demo bytes.
 * @param {{ apiKey?: string, resourceUrl: string, matchId?: string | null }} input
 */
export async function resolveDemoDownloadUrl(input) {
  const resourceUrl = String(input.resourceUrl || "").trim();
  if (!resourceUrl) {
    throw new Error("Demo resource URL is empty");
  }

  if (isDirectDemoDownloadUrl(resourceUrl) && !/demos\.faceit\.com/i.test(resourceUrl)) {
    return resourceUrl;
  }

  const signed = await signDemoUrlViaDownloadsApi(input.apiKey || "", resourceUrl);
  if (signed) {
    return signed;
  }

  const matchId = sanitizeFaceitMatchId(input.matchId) || sanitizeFaceitMatchId(resourceUrl);
  if (matchId) {
    const fromBrowser = await resolveDemoUrlViaBrowser(matchId);
    if (fromBrowser && !/demos\.faceit\.com/i.test(fromBrowser)) {
      return fromBrowser;
    }
  }

  throw new Error(
    "Cannot resolve a public demo download URL.\n" +
      "`demos.faceit.com` is private (ENOTFOUND). Options:\n" +
      "1) Apply for FACEIT Downloads API access (developers.faceit.com), or\n" +
      "2) Open the match on faceit.com and download the demo manually, then import the .dem.",
  );
}

/**
 * Download (and gunzip if needed) a FACEIT demo to outPath (.dem).
 * @param {{ apiKey?: string, url: string, matchId?: string | null, outPath: string }} input
 */
export async function downloadFaceitDemo(input) {
  const outPath = resolve(input.outPath);
  await mkdir(dirname(outPath), { recursive: true });

  const downloadUrl = await resolveDemoDownloadUrl({
    apiKey: input.apiKey,
    resourceUrl: input.url,
    matchId: input.matchId,
  });

  let lastError = /** @type {unknown} */ (null);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
      const encoding = (response.headers.get("content-encoding") || "").toLowerCase();
      const isGz =
        urlLower.includes(".dem.gz") ||
        urlLower.endsWith(".gz") ||
        encoding === "gzip" ||
        encoding === "x-gzip";

      if (/\.zst(\?|$)/i.test(downloadUrl)) {
        throw new Error(
          "Demo is .zst compressed. Save manually from FACEIT or convert to .dem.gz — zstd not bundled yet.",
        );
      }

      if (isGz && outPath.toLowerCase().endsWith(".dem")) {
        await pipeline(body, createGunzip(), createWriteStream(outPath));
      } else {
        await pipeline(body, createWriteStream(outPath));
      }
      return { path: outPath, downloadUrl };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
    }
  }

  const cause =
    lastError && typeof lastError === "object" && "cause" in lastError
      ? lastError.cause
      : null;
  const detail = [
    cause && typeof cause === "object" && "code" in cause ? cause.code : null,
    cause && typeof cause === "object" && "hostname" in cause ? cause.hostname : null,
    lastError instanceof Error ? lastError.message : String(lastError),
  ]
    .filter(Boolean)
    .join(" · ");
  throw new Error(`Demo download network error: ${detail || "fetch failed"}`);
}
