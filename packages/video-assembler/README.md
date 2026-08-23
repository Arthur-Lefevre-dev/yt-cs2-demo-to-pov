# video-assembler

Assemble une vidéo finale avec FFmpeg :

1. intro fixe depuis le screenshot lobby (`-loop 1 -t N`)
2. normalisation de chaque clip round (même résolution / fps / codec)
3. optionnel : clip **commercial** (vidéo **ou** image fixe) inséré juste après le Round 1
4. **fondu au noir** (0,5 s) sur intro + commercial
5. concat demuxer → un seul `.mp4`

Codecs : `--video-codec libx264|libx265|hevc_nvenc|h264_nvenc` (même profil pour tous les segments).

## CLI (PowerShell)

```powershell
node packages/video-assembler/src/cli.js --out fixtures/output/final.mp4 --lobby fixtures/lobby-screenshot.png --intro-seconds 4 --clips fixtures/output/round1.mp4,fixtures/output/round2.mp4 --commercial fixtures/ads/sponsor.png --commercial-seconds 5 --video-codec hevc_nvenc --work-dir fixtures/output/_assemble
```
