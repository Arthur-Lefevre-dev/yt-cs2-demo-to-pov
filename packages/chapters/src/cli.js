#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  buildChapters,
  buildSmokeMarkersFromParse,
  chaptersFromAssembleResult,
} from "./chapters.js";

function printHelp() {
  console.log(`Usage:
  node src/cli.js --clips Lobby=intro.mp4,Round 1=r1.mp4 [--out chapters.txt]
  node src/cli.js --assemble-json assemble-result.json [--round-labels "Round 1 Clutch|Round 2 3K USP"] [--out chapters.txt]

Options:
  --clips <label=path,...>     Ordered chapter clips
  --assemble-json <path>       JSON from video-assembler CLI stdout
  --round-labels <a|b|c>       Labels for round clips (pipe-separated, order = selected rounds)
  --parse-json <path>          demo-parser JSON (for smoke chapter markers)
  --steam-id <id>              POV player SteamID64 (with --parse-json)
  --rounds <n,n,...>           Selected round numbers (with --parse-json)
  --out <path>                 Write chapter text to file
  --help
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      clips: { type: "string" },
      "assemble-json": { type: "string" },
      "round-labels": { type: "string" },
      "parse-json": { type: "string" },
      "steam-id": { type: "string" },
      rounds: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || (!values.clips && !values["assemble-json"])) {
    printHelp();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  let result;
  if (values["assemble-json"]) {
    const { readFile } = await import("node:fs/promises");
    const assembleResult = JSON.parse(await readFile(resolve(values["assemble-json"]), "utf8"));
    const roundLabels = values["round-labels"]
      ? values["round-labels"].split("|").map((part) => part.trim()).filter(Boolean)
      : undefined;

    let smokeMarkers = [];
    if (values["parse-json"] && values["steam-id"] && values.rounds) {
      const parsed = JSON.parse(await readFile(resolve(values["parse-json"]), "utf8"));
      const rounds = values.rounds
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isFinite(n));
      smokeMarkers = buildSmokeMarkersFromParse({
        playerSmokes: parsed.player_smokes ?? [],
        playerRounds: parsed.player_rounds ?? [],
        steamId: values["steam-id"],
        rounds,
        tickrate: parsed.tickrate ?? 64,
      });
    }

    result = await chaptersFromAssembleResult(assembleResult, { roundLabels, smokeMarkers });
  } else {
    const clips = values.clips.split(",").map((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) {
        throw new Error(`Invalid --clips entry "${part}" (expected Label=path.mp4)`);
      }
      return {
        label: part.slice(0, idx).trim(),
        path: resolve(part.slice(idx + 1).trim()),
      };
    });
    result = await buildChapters(clips);
  }

  if (values.out) {
    await writeFile(resolve(values.out), `${result.text}\n`, "utf8");
    console.error(`Wrote ${resolve(values.out)}`);
  }
  process.stdout.write(`${result.text}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
