# csdm-bridge

Génère les JSON `--config-file` pour `csdm video`, avec :

- 1 sequence = 1 round (ticks issus de `demo-parser`)
- caméra POV (`playerCameras`) sur le joueur choisi
- voix **équipe du round courant** via `playersOptions[].isVoiceEnabled`
- HLAE + FFmpeg streaming (`recordingOutput: video`) pour éviter les frames raw
- `concatenateSequences: false` (assemblage intro + clips = `video-assembler`)

Voir aussi [`docs/CSDM.md`](../../docs/CSDM.md).

## Dry-run (recommandé d’abord)

PowerShell (une seule ligne) :

```powershell
npm run parse -- --demo path\to\match.dem --pretty --out fixtures/output/parsed.json

npm run csdm:config -- --parse fixtures/output/parsed.json --player 76561198157151718 --rounds 1 --out-dir fixtures/output/csdm --split
```

## Lancer CSDM (nécessite analyse + CS2/HLAE)

```powershell
npm run csdm:config -- --parse fixtures/output/parsed.json --player 76561198157151718 --rounds 1 --out-dir fixtures/output/csdm --split --run
```

Prérequis : `csdm` sur le PATH (ou `CSDM_PATH`), demo déjà analysable (`--run` appelle `csdm analyze --source faceit --force`).
