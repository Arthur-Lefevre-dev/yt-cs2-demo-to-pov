# yt-cs2-demo-to-pov

App desktop Windows (Tauri) qui transforme une demo CS2 FACEIT en vidéo YouTube
style POV pour un joueur choisi : intro lobby + un clip par round (caméra
spectateur, comms d’équipe uniquement) + chapitrage YouTube.

**État actuel : étapes 1–7 (GUI + miniatures YouTube).** Parser, pipeline CSDM, assemble 4K60, générateur de miniatures A/B. Reste : valider `--run` HLAE POV + psql CSDM optionnel.

## Stack

| Couche | Choix | Pourquoi |
| --- | --- | --- |
| GUI | Tauri 2 + React + TypeScript | Backend Rust pour orchestrer les sidecars, frontend web pour les écrans |
| `demo-parser` | Sidecar **Node** (`@laihoe/demoparser2`) | Pas de parser CS2 haut niveau mature en Rust. `awpy` exige Python `<3.14` (machine actuelle = 3.14). Même cœur Rust que demoparser2 Python. |
| `csdm-bridge` / `video-assembler` / `chapters` | Sidecars Node | Configs CSDM, concat FFmpeg, chapitres YouTube |
| `thumbnail-generator` | Sidecar Node (`sharp`) | 3 miniatures YouTube A/B + titre |

Recherche CSDM (schéma `--config-file`, voix, HLAE streaming) : [`docs/CSDM.md`](docs/CSDM.md).

## Prérequis (plus tard pour le rendu)

- Windows
- [CS2](https://store.steampowered.com/app/730/)
- [CS Demo Manager](https://cs-demo-manager.com/)
- HLAE (CSDM peut l’installer)
- ffmpeg
- Node.js ≥ 20 (parser dès maintenant)
- Rust (pour compiler l’app Tauri)

## Parser (étape 2)

```bash
npm install
npm run fixtures:download
npm run test:parser
npm run parse:fixture -- --pretty --out fixtures/output/parsed.json
```

Filtrer un joueur :

```bash
npm run parse -- --demo fixtures/faceit-1-efdaace4-2fd4-4884-babf-1a5a2c83e344.dem --player 76561198XXXXXXXX --pretty
```

Sortie attendue par joueur/round :

```json
{
  "round_number": 1,
  "round_start_tick": 1100,
  "player_death_tick": 3200,
  "round_end_tick": 4000,
  "player_side": "CT",
  "team_steam_ids": ["7656…", "7656…"]
}
```

Un joueur absent (backup / déco) est **skippé** et listé dans `skipped_rounds`.

## Structure

```
apps/gui/                 # Tauri (React + src-tauri)
packages/demo-parser/     # CLI sidecar Node
packages/csdm-bridge/     # JSON CSDM + option --run
packages/video-assembler/ # intro + concat clips
packages/chapters/        # timestamps YouTube
fixtures/                 # demo FACEIT (téléchargée) + screenshot lobby
docs/CSDM.md              # recherche CLI / JSON / voix
```

## Plan de build

1. ~~Setup repo~~
2. ~~demo-parser CLI + fixture~~
3. ~~GUI écrans 1–3 (setup / import / sélection joueur)~~
4. ~~Recherche CSDM~~ ([`docs/CSDM.md`](docs/CSDM.md))
5. ~~csdm-bridge dry-run (JSON 1 round / tous)~~ — `--run` HLAE à valider sur machine avec CSDM
6. ~~video-assembler + chapters~~
7. ~~GUI écrans 4–6 (aperçu / rendu / résultat)~~ — reprise job-state basique via `job-state.json`

## Assemblage + chapitrage (étape 6)

```powershell
npm run assemble -- --out fixtures/output/synth/final.mp4 --lobby fixtures/lobby-screenshot.png --intro-seconds 4 --clips fixtures/output/synth/r1.mp4,fixtures/output/synth/r2.mp4 --work-dir fixtures/output/synth/_work --result-json fixtures/output/synth/assemble-result.json

npm run chapters -- --assemble-json fixtures/output/synth/assemble-result.json --out fixtures/output/synth/chapters.txt
```

## CSDM bridge (étape 5)

PowerShell (une seule ligne — pas de `\` en fin de ligne) :

```powershell
npm run csdm:config -- --parse fixtures/output/parsed.json --player 76561198157151718 --rounds 1 --out-dir fixtures/output/csdm --split
```

Ajoute `--run` seulement si CSDM + CS2 + HLAE sont prêts (lance `csdm analyze` puis `csdm video`).

## Lancer le GUI

Prérequis : Node ≥ 20, Rust (`rustup`), Windows.

```bash
npm install
npm run fixtures:download   # si la demo de test manque
cd apps/gui
npm run tauri dev
```

Flux UI :

1. **Prérequis** — scan CS2 / CSDM / HLAE / FFmpeg / Node
2. **Import** — choisir un `.dem` (+ screenshot lobby optionnel) → parse via sidecar Node
3. **Joueur** — liste triée par kills, aperçu des rounds
4. **Rounds** — sélection des rounds à inclure
5. **Rendu** — dry-run (configs + chapitres estimés) ou lancement CSDM/HLAE
6. **Résultat** — dossier job, copier le chapitrage YouTube
7. **Miniatures** — photo joueur + 3 variantes A/B + titre YouTube

Fonds de map pour les miniatures : `fixtures/thumbnails/maps/<de_nuke|de_mirage|…>/` (voir le README dedans).

Les jobs écrivent sous `fixtures/output/jobs/<joueur>-<map>/` (`parsed.json`, configs CSDM, `chapters-estimated.txt`, `job-state.json`).
