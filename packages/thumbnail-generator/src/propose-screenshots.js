#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { proposeThumbnailScreenshots } from "./screenshots.js";

function printHelp() {
  console.log(`Usage: node src/propose-screenshots.js --work-dir <jobDir> --out-dir <dir> [options]

Extract 10 gameplay stills from final.mp4 / CSDM round clips for thumbnail backgrounds.

Required:
  --work-dir <path>   Job work directory (contains final.mp4 or csdm/)
  --out-dir <path>    Folder for proposal JPGs

Options:
  --video <path>      Prefer this video (e.g. final.mp4)
  --count <n>         Number of proposals (default 10)
  --help
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "work-dir": { type: "string" },
      "out-dir": { type: "string" },
      video: { type: "string" },
      count: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || !values["work-dir"] || !values["out-dir"]) {
    printHelp();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const outDir = resolve(values["out-dir"]);
  await mkdir(outDir, { recursive: true });

  const result = await proposeThumbnailScreenshots({
    workDir: resolve(values["work-dir"]),
    videoPath: values.video ? resolve(values.video) : undefined,
    outDir,
    count: values.count ? Number(values.count) : 10,
  });

  console.log(JSON.stringify(result, null, 2));
  console.error(`Wrote ${result.count} screenshot proposals → ${result.outDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
