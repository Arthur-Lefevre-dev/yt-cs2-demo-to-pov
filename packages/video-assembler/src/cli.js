#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { assembleVideo } from "./assemble.js";

function printHelp() {
  console.log(`Usage: node src/cli.js --out <final.mp4> --clips <a.mp4,b.mp4,...> [options]

Options:
  --out <path>           Final assembled mp4 (required)
  --clips <paths>        Comma-separated round clips (required)
  --lobby <image>        FACEIT lobby screenshot for intro
  --intro-seconds <n>    Intro duration (default 4)
  --commercial <path>    Optional ad after Round 1 (video mp4/mov OR image png/jpg)
  --commercial-label <t> Chapter label (default Sponsors)
  --commercial-seconds <n> Duration when commercial is an image (default 5)
  --work-dir <path>      Temp/normalized clips folder
  --result-json <path>   Also write assemble result JSON here
  --width <n>            Default 3840 (4K)
  --height <n>           Default 2160 (4K)
  --framerate <n>        Default 60
  --help
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      clips: { type: "string" },
      lobby: { type: "string" },
      "intro-seconds": { type: "string" },
      commercial: { type: "string" },
      "commercial-label": { type: "string" },
      "commercial-seconds": { type: "string" },
      "work-dir": { type: "string" },
      "result-json": { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      framerate: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || !values.out || !values.clips) {
    printHelp();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const roundClipPaths = values.clips.split(",").map((part) => resolve(part.trim())).filter(Boolean);
  const missing = roundClipPaths.filter((clip) => !existsSync(clip));
  if (missing.length > 0) {
    throw new Error(
      `Clip(s) introuvable(s):\n${missing.map((path) => `  - ${path}`).join("\n")}\n` +
        "Utilise le chemin complet, ex. fixtures/output/synth/r1.mp4",
    );
  }
  if (values.lobby && !existsSync(resolve(values.lobby))) {
    throw new Error(`Lobby image not found: ${resolve(values.lobby)}`);
  }
  if (values.commercial && !existsSync(resolve(values.commercial))) {
    throw new Error(`Commercial clip not found: ${resolve(values.commercial)}`);
  }

  const outputPath = resolve(values.out);
  await mkdir(resolve(values["work-dir"] ?? `${outputPath}.work`), { recursive: true });

  const result = await assembleVideo({
    lobbyImagePath: values.lobby ? resolve(values.lobby) : undefined,
    introSeconds: values["intro-seconds"] ? Number(values["intro-seconds"]) : 4,
    roundClipPaths,
    commercialPath: values.commercial ? resolve(values.commercial) : undefined,
    commercialLabel: values["commercial-label"] || "Sponsors",
    commercialSeconds: values["commercial-seconds"]
      ? Number(values["commercial-seconds"])
      : 5,
    outputPath,
    workDir: values["work-dir"] ? resolve(values["work-dir"]) : undefined,
    width: values.width ? Number(values.width) : 3840,
    height: values.height ? Number(values.height) : 2160,
    framerate: values.framerate ? Number(values.framerate) : 60,
    onLog: (line) => process.stderr.write(line),
  });

  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values["result-json"]) {
    await writeFile(resolve(values["result-json"]), json, "utf8");
    console.error(`Wrote ${resolve(values["result-json"])}`);
  }
  process.stdout.write(json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
