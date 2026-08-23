#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateThumbnails } from "./generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

function printHelp() {
  console.log(`Usage: node src/cli.js --player-photo <path> --name <player> --map <de_nuke> --out-dir <dir> [options]

Required:
  --player-photo <path>  Cutout / photo of the player (png with transparency preferred)
  --name <string>        Display name on thumbnail + YouTube title
  --map <string>         Map key (de_nuke, de_mirage, …)
  --out-dir <path>       Output folder for 3 variants

Options:
  --kills <n>            Kills (default 0)
  --deaths <n>           Deaths (default 0)
  --rounds <n>           Official rounds (for HLTV rating estimate)
  --rating <n>           Override HLTV rating (e.g. 1.46)
  --score <text>         Override score text (e.g. 16-18)
  --team-logo <path>     Optional team logo PNG (watermark behind player)
  --brand-logo <path>    Override fixed 4K logo (default: fixtures/thumbnails/brand/4k-logo.*)
  --brand-root <path>    Folder containing 4k-logo.png (default: sibling of maps-root)
  --no-4k-logo           Hide the fixed 4K badge
  --background <path>    Custom screenshot background (repeat up to 3×)
  --match-kind <kind>    faceit | premier | tournament
  --event <name>         Event name for tournament titles (BLAST.tv, IEM Rio, …)
  --matchup <text>       "Vitality vs Spirit" for tournament titles
  --maps-root <path>     Default: fixtures/thumbnails/maps
  --help
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "player-photo": { type: "string" },
      name: { type: "string" },
      map: { type: "string" },
      "out-dir": { type: "string" },
      kills: { type: "string" },
      deaths: { type: "string" },
      rounds: { type: "string" },
      rating: { type: "string" },
      score: { type: "string" },
      "team-logo": { type: "string" },
      "brand-logo": { type: "string" },
      "brand-root": { type: "string" },
      "no-4k-logo": { type: "boolean", default: false },
      background: { type: "string", multiple: true },
      "match-kind": { type: "string" },
      event: { type: "string" },
      matchup: { type: "string" },
      "maps-root": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (
    values.help ||
    !values["player-photo"] ||
    !values.name ||
    !values.map ||
    !values["out-dir"]
  ) {
    printHelp();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const outDir = resolve(values["out-dir"]);
  await mkdir(outDir, { recursive: true });

  const mapsRoot = values["maps-root"]
    ? resolve(values["maps-root"])
    : resolve(repoRoot, "fixtures/thumbnails/maps");

  const result = await generateThumbnails({
    playerPhotoPath: resolve(values["player-photo"]),
    teamLogoPath: values["team-logo"] ? resolve(values["team-logo"]) : undefined,
    brandLogoPath: values["brand-logo"] ? resolve(values["brand-logo"]) : undefined,
    brandRoot: values["brand-root"]
      ? resolve(values["brand-root"])
      : resolve(repoRoot, "fixtures/thumbnails/brand"),
    showBrandLogo: !values["no-4k-logo"],
    playerName: values.name,
    mapName: values.map,
    kills: values.kills ? Number(values.kills) : 0,
    deaths: values.deaths ? Number(values.deaths) : 0,
    rounds: values.rounds ? Number(values.rounds) : undefined,
    rating: values.rating ? Number(values.rating) : undefined,
    score: values.score,
    matchKind: values["match-kind"],
    eventName: values.event,
    matchup: values.matchup,
    backgroundPaths: values.background?.map((path) => resolve(path)),
    mapsRoot,
    outDir,
  });

  console.log(JSON.stringify(result, null, 2));
  console.error(`Wrote ${result.variants.length} thumbnails → ${result.outDir}`);
  console.error(`Title: ${result.title}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
