#!/usr/bin/env node
/**
 * Downloads the public FACEIT CS2 demo used by awpy tests (figshare).
 * Source room: https://www.faceit.com/en/cs2/room/1-efdaace4-2fd4-4884-babf-1a5a2c83e344
 */
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const ROOT = dirname(fileURLToPath(import.meta.url));
// figshare.com is WAF-blocked; the ndownloader host issues a short-lived S3 redirect.
const DEMO_URL = "https://ndownloader.figshare.com/files/52455215";
const DEMO_NAME = "faceit-1-efdaace4-2fd4-4884-babf-1a5a2c83e344.dem";

async function download(url, dest) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "yt-cs2-demo-to-pov-fixtures" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
  }
  await pipeline(response.body, createWriteStream(dest));
  const info = await stat(dest);
  if (info.size < 1_000_000) {
    throw new Error(`Downloaded file is too small (${info.size} bytes). The host likely returned a WAF challenge.`);
  }
}

async function main() {
  await mkdir(ROOT, { recursive: true });
  const dest = join(ROOT, DEMO_NAME);

  try {
    const info = await stat(dest);
    if (info.size > 1_000_000) {
      console.log(`Fixture already present (${(info.size / 1_048_576).toFixed(1)} MiB): ${dest}`);
      return;
    }
  } catch {
    // File missing — download below.
  }

  console.log(`Downloading FACEIT fixture from figshare…`);
  console.log(DEMO_URL);
  await download(DEMO_URL, dest);
  const info = await stat(dest);
  console.log(`Saved ${(info.size / 1_048_576).toFixed(1)} MiB → ${dest}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
