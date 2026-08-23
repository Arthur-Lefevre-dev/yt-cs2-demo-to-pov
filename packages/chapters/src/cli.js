#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildChapters, chaptersFromAssembleResult } from "./chapters.js";

function printHelp() {
  console.log(`Usage:
  node src/cli.js --clips Lobby=intro.mp4,Round 1=r1.mp4 [--out chapters.txt]
  node src/cli.js --assemble-json assemble-result.json [--out chapters.txt]

Options:
  --clips <label=path,...>   Ordered chapter clips
  --assemble-json <path>     JSON from video-assembler CLI stdout
  --out <path>               Write chapter text to file
  --help
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      clips: { type: "string" },
      "assemble-json": { type: "string" },
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
    result = await chaptersFromAssembleResult(assembleResult);
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
