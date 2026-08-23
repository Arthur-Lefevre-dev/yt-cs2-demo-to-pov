import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assembleVideo, makeIntroClip } from "../src/assemble.js";
import { resolveBinary, runProcess } from "../src/ffmpeg.js";
import { chaptersFromAssembleResult } from "../../chapters/src/chapters.js";

async function makeColorClip(outputPath, { color = "blue", seconds = 1, ffmpeg }) {
  await runProcess(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=1280x720:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=" + seconds,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ]);
}

describe("video-assembler integration", () => {
  it("builds intro + concat and matching YouTube chapters", async () => {
    const ffmpeg = resolveBinary("ffmpeg");
    const dir = await mkdtemp(join(tmpdir(), "cs2-assemble-"));
    try {
      const lobby = join(dir, "lobby.png");
      // 1x1 png via ffmpeg
      await runProcess(ffmpeg, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=orange:s=320x180:d=0.1",
        "-frames:v",
        "1",
        lobby,
      ]);

      const round1 = join(dir, "round1-src.mp4");
      const round2 = join(dir, "round2-src.mp4");
      await makeColorClip(round1, { color: "red", seconds: 1.2, ffmpeg });
      await makeColorClip(round2, { color: "green", seconds: 1.5, ffmpeg });

      const intro = await makeIntroClip({
        imagePath: lobby,
        outputPath: join(dir, "intro-only.mp4"),
        durationSeconds: 2,
        width: 1280,
        height: 720,
        framerate: 30,
        ffmpegPath: ffmpeg,
      });
      assert.ok(intro.endsWith("intro-only.mp4"));

      const assembled = await assembleVideo({
        lobbyImagePath: lobby,
        introSeconds: 2,
        roundClipPaths: [round1, round2],
        outputPath: join(dir, "final.mp4"),
        workDir: join(dir, "work"),
        width: 1280,
        height: 720,
        framerate: 30,
        ffmpegPath: ffmpeg,
      });

      assert.equal(assembled.clipPaths.length, 3);
      assert.equal(assembled.introIncluded, true);
      assert.deepEqual(assembled.clipKinds, ["intro", "round", "round"]);

      const chapters = await chaptersFromAssembleResult(assembled);
      assert.match(chapters.text, /^0:00 Lobby\n/);
      assert.match(chapters.text, /Round 1/);
      assert.match(chapters.text, /Round 2/);
      assert.ok(chapters.totalSeconds >= 4);

      const ad = join(dir, "ad-src.mp4");
      await makeColorClip(ad, { color: "yellow", seconds: 0.8, ffmpeg });
      const withAd = await assembleVideo({
        lobbyImagePath: lobby,
        introSeconds: 1,
        roundClipPaths: [round1, round2],
        commercialPath: ad,
        commercialLabel: "Sponsors",
        outputPath: join(dir, "final-ad.mp4"),
        workDir: join(dir, "work-ad"),
        width: 1280,
        height: 720,
        framerate: 30,
        ffmpegPath: ffmpeg,
      });
      assert.deepEqual(withAd.clipKinds, ["intro", "round", "commercial", "round"]);
      assert.equal(withAd.commercialIncluded, true);
      const adChapters = await chaptersFromAssembleResult(withAd);
      assert.match(adChapters.text, /Sponsors/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
