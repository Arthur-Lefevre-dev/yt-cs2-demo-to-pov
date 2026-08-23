#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDemo } from "./parse-demo.js";

function printHelp() {
  console.log(`Usage: node src/cli.js --demo <path.dem> [options]

Options:
  --demo <path>       Path to a CS2 .dem file (required)
  --player <steamid>  SteamID64 to filter player_rounds
  --out <path>        Write JSON to this file instead of stdout
  --pretty            Pretty-print JSON (default: true when writing a file)
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      demo: { type: "string" },
      player: { type: "string" },
      out: { type: "string" },
      pretty: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const demoPath = values.demo;
  if (!demoPath) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const result = parseDemo(resolve(demoPath), { steamId: values.player });
  const json = JSON.stringify(result, null, values.out || values.pretty ? 2 : 0);

  if (values.out) {
    const outPath = resolve(values.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${json}\n`, "utf8");
    console.error(`Wrote ${outPath}`);
    console.error(
      `${result.players.length} players, ${result.rounds.length} official rounds, ${result.player_rounds.length} player-rounds, ${result.skipped_rounds.length} skipped`,
    );
    return;
  }

  process.stdout.write(`${json}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
