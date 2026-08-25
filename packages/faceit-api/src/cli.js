#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listBestRecentMatches } from "./matches.js";
import { generateFaceitLobbyScreenshot } from "./lobby-screenshot.js";
import {
  loadTrackedPlayers,
  removeTrackedPlayer,
  upsertTrackedPlayer,
} from "./tracked-players.js";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

function printHelp() {
  console.log(`Usage: node src/cli.js <command> [options]

Commands:
  list-tracked --store <path>
  upsert-tracked --store <path> --steam-id <id> [--nickname <n>] [--photo <p>] [--team-logo <p>] [--faceit-id <id>]
  remove-tracked --store <path> --id <id>
  best-matches --store <path> [--page 1] [--page-size 10] [--per-player 15] [--api-key <key>]
  download-demo --url <demoUrl> --out <file.dem>
  lobby-screenshot --match-id <id> --out <lobby.jpg> [--api-key <key>]
                   (captures the real FACEIT room webpage via Chromium)

Env:
  FACEIT_API_KEY   Server API key from developers.faceit.com
`);
}

function apiKeyFrom(values) {
  return values["api-key"] || process.env.FACEIT_API_KEY || "";
}

async function downloadDemo(url, outPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}`);
  }
  await mkdir(dirname(outPath), { recursive: true });
  const body = Readable.fromWeb(response.body);
  const isGz = url.includes(".gz") || outPath.endsWith(".gz");
  if (isGz && outPath.endsWith(".dem")) {
    await pipeline(body, createGunzip(), createWriteStream(outPath));
  } else {
    await pipeline(body, createWriteStream(outPath));
  }
  return outPath;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      store: { type: "string" },
      "steam-id": { type: "string" },
      nickname: { type: "string" },
      "display-name": { type: "string" },
      photo: { type: "string" },
      "team-logo": { type: "string" },
      "faceit-id": { type: "string" },
      id: { type: "string" },
      page: { type: "string" },
      "page-size": { type: "string" },
      "per-player": { type: "string" },
      "api-key": { type: "string" },
      url: { type: "string" },
      out: { type: "string" },
      "match-id": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    printHelp();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  if (command === "list-tracked") {
    if (!values.store) {
      throw new Error("--store required");
    }
    const data = await loadTrackedPlayers(resolve(values.store));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "upsert-tracked") {
    if (!values.store || !values["steam-id"]) {
      throw new Error("--store and --steam-id required");
    }
    const row = await upsertTrackedPlayer(resolve(values.store), {
      steam_id: values["steam-id"],
      nickname: values.nickname,
      display_name: values["display-name"],
      photo_path: values.photo ? resolve(values.photo) : null,
      team_logo_path: values["team-logo"] ? resolve(values["team-logo"]) : null,
      faceit_player_id: values["faceit-id"],
    });
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  if (command === "remove-tracked") {
    if (!values.store || !values.id) {
      throw new Error("--store and --id required");
    }
    const result = await removeTrackedPlayer(resolve(values.store), values.id);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "best-matches") {
    if (!values.store) {
      throw new Error("--store required");
    }
    const key = apiKeyFrom(values);
    const { players } = await loadTrackedPlayers(resolve(values.store));
    if (players.length === 0) {
      console.log(JSON.stringify({ page: 1, pageSize: 10, total: 0, totalPages: 1, items: [] }, null, 2));
      return;
    }
    const result = await listBestRecentMatches(key, players, {
      page: values.page ? Number(values.page) : 1,
      pageSize: values["page-size"] ? Number(values["page-size"]) : 10,
      perPlayerLimit: values["per-player"] ? Number(values["per-player"]) : 15,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "download-demo") {
    if (!values.url || !values.out) {
      throw new Error("--url and --out required");
    }
    const path = await downloadDemo(values.url, resolve(values.out));
    console.log(JSON.stringify({ path }, null, 2));
    return;
  }

  if (command === "lobby-screenshot") {
    if (!values["match-id"] || !values.out) {
      throw new Error("--match-id and --out required");
    }
    const key = apiKeyFrom(values);
    const result = await generateFaceitLobbyScreenshot(
      key,
      values["match-id"],
      resolve(values.out),
    );
    console.log(JSON.stringify({ path: result.path, matchId: values["match-id"] }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
