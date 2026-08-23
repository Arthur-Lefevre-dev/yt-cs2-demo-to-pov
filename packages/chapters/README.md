# chapters

Génère le texte de chapitrage YouTube à partir des durées réelles (`ffprobe`).

```text
0:00 Lobby
0:04 Round 1
0:32 Round 2
```

## CLI (PowerShell)

```powershell
node packages/chapters/src/cli.js --clips "Lobby=fixtures/output/_assemble/00-intro.mp4,Round 1=fixtures/output/_assemble/01-round.mp4" --out fixtures/output/chapters.txt
```

Ou depuis le JSON stdout de `video-assembler` :

```powershell
node packages/chapters/src/cli.js --assemble-json fixtures/output/assemble-result.json --out fixtures/output/chapters.txt
```
