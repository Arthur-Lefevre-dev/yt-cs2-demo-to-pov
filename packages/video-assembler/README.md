# video-assembler

Assemble une vidéo finale avec FFmpeg :

1. intro fixe depuis le screenshot lobby (`-loop 1 -t N`)
2. normalisation de chaque clip round (même résolution / fps / codec)
3. optionnel : clip **commercial** inséré juste après le Round 1
4. concat demuxer → un seul `.mp4`

## CLI (PowerShell)

```powershell
node packages/video-assembler/src/cli.js --out fixtures/output/final.mp4 --lobby fixtures/lobby-screenshot.png --intro-seconds 4 --clips fixtures/output/round1.mp4,fixtures/output/round2.mp4 --commercial fixtures/ads/sponsor.mp4 --work-dir fixtures/output/_assemble
```
