#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildCsdmVideoConfig, splitConfigPerSequence, toCsdmConfigFile } from "./build-config.js";
import { explainCsdmExitCode, runCsdmVideo } from "./run-csdm.js";

function printHelp() {
  console.log(`Usage: node src/cli.js --parse <parsed.json> --player <steamid> --out-dir <dir> [options]

Required:
  --parse <path>       JSON from demo-parser
  --player <steamid>   SteamID64 to record
  --out-dir <path>     Folder for generated configs (and CSDM video output)

Options:
  --rounds <n,n,...>   Only these round numbers (e.g. 1 or 1,2,3)
  --width <n>          Default 3840 (4K)
  --height <n>         Default 2160 (4K)
  --framerate <n>      Default 60
  --split              Write one JSON file per round (recommended for retries)
  --run                Actually call \`csdm analyze\` + \`csdm video\` (needs CSDM installed)
  --no-analyze         With --run, skip csdm analyze
  --death-notices-only Hide full HUD (cinematic); default is full POV HUD
  --no-true-view       Disable CS2 demo predict / true-view feel
  --video-codec <name> libx264 | libx265 | hevc_nvenc | h264_nvenc | hevc_amf | h264_amf
  --skip-freeze-seconds <n> Skip freeze/buy: -1 = start at freeze_end (default), 0 = include buy, N = skip N seconds
  --end-padding-seconds <n> Seconds after survive/round-end (default 2); death uses 1s
  --help
`);
}

function parseRoundList(value) {
  if (!value) {
    return undefined;
  }
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
}

async function main() {
  const { values } = parseArgs({
    options: {
      parse: { type: "string" },
      player: { type: "string" },
      "out-dir": { type: "string" },
      rounds: { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      framerate: { type: "string" },
      split: { type: "boolean", default: false },
      run: { type: "boolean", default: false },
      "no-analyze": { type: "boolean", default: false },
      "death-notices-only": { type: "boolean", default: false },
      "no-true-view": { type: "boolean", default: false },
      "video-codec": { type: "string" },
      "skip-freeze-seconds": { type: "string" },
      "end-padding-seconds": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || !values.parse || !values.player || !values["out-dir"]) {
    printHelp();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const parsed = JSON.parse(await readFile(resolve(values.parse), "utf8"));
  const outDir = resolve(values["out-dir"]);
  await mkdir(outDir, { recursive: true });

  const config = buildCsdmVideoConfig(parsed, {
    steamId: values.player,
    outputFolderPath: outDir,
    rounds: parseRoundList(values.rounds),
    width: values.width ? Number(values.width) : undefined,
    height: values.height ? Number(values.height) : undefined,
    framerate: values.framerate ? Number(values.framerate) : undefined,
    showOnlyDeathNotices: values["death-notices-only"] ? true : false,
    trueView: values["no-true-view"] ? false : true,
    videoCodec: values["video-codec"] || "libx264",
    skipFreezeSeconds:
      values["skip-freeze-seconds"] !== undefined
        ? Number(values["skip-freeze-seconds"])
        : -1,
    endPaddingSeconds: values["end-padding-seconds"]
      ? Number(values["end-padding-seconds"])
      : undefined,
  });

  if (values.split || config.sequences.length === 1) {
    const parts = splitConfigPerSequence(config);
    const written = [];
    for (const part of parts) {
      const filePath = resolve(outDir, `csdm-round-${String(part.roundNumber).padStart(2, "0")}.json`);
      await writeFile(filePath, `${JSON.stringify(part.config, null, 2)}\n`, "utf8");
      written.push({ round: part.roundNumber, path: filePath });
      console.error(`Wrote ${filePath}`);
    }

    if (values.run) {
      // One `csdm video` per round (CS2 relaunches). More reliable than multi-sequence
      // for demo_gototick / death cut — CSDM single-session queues often fail to skip.
      let demoPath = parsed.demo_path;
      for (const [index, item] of written.entries()) {
        const partCfg = JSON.parse(await readFile(item.path, "utf8"));
        const seq = partCfg.sequences?.[0];
        console.error(
          `\n--- Recording round ${item.round} (${index + 1}/${written.length}) ` +
            `ticks ${seq?.startTick}→${seq?.endTick} via csdm video ---`,
        );
        const code = await runCsdmVideo({
          configFilePath: item.path,
          demoPath,
          analyze: index === 0 && !values["no-analyze"],
          focusPlayerSteamId: String(values.player),
          trueView: !values["no-true-view"],
        });
        if (code !== 0) {
          throw new Error(
            `csdm video failed for round ${item.round} (exit ${code}). ${explainCsdmExitCode(code)}`,
          );
        }
      }
    } else {
      console.error(
        `Dry-run OK: ${written.length} config(s). Re-run with --run to invoke CSDM (requires analyze + HLAE).`,
      );
    }
    return;
  }

  const filePath = resolve(outDir, "csdm-video.json");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(toCsdmConfigFile(config), null, 2)}\n`, "utf8");
  console.error(`Wrote ${filePath} (${config.sequences.length} sequences)`);

  if (values.run) {
    const code = await runCsdmVideo({
      configFilePath: filePath,
      demoPath: parsed.demo_path,
      analyze: !values["no-analyze"],
      focusPlayerSteamId: String(values.player),
      trueView: !values["no-true-view"],
    });
    if (code !== 0) {
      throw new Error(`csdm video failed (exit ${code}). ${explainCsdmExitCode(code)}`);
    }
  } else {
    console.error("Dry-run OK. Re-run with --run to invoke CSDM.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
