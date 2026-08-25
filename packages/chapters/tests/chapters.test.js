import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChapterTimestamp, buildChapters } from "../src/chapters.js";

describe("formatChapterTimestamp", () => {
  it("formats under one hour as M:SS", () => {
    assert.equal(formatChapterTimestamp(0), "0:00");
    assert.equal(formatChapterTimestamp(4), "0:04");
    assert.equal(formatChapterTimestamp(65), "1:05");
    assert.equal(formatChapterTimestamp(600), "10:00");
  });

  it("formats one hour and above as H:MM:SS", () => {
    assert.equal(formatChapterTimestamp(3600), "1:00:00");
    assert.equal(formatChapterTimestamp(3661), "1:01:01");
  });
});

describe("buildChapters", () => {
  it("accumulates durations into YouTube chapter text", async () => {
    const result = await buildChapters([
      { label: "Lobby", durationSeconds: 4 },
      { label: "Round 1", durationSeconds: 28.4 },
      { label: "Round 2", durationSeconds: 30 },
    ]);
    assert.equal(result.text, ["0:00 Lobby", "0:04 Round 1", "0:32 Round 2"].join("\n"));
    assert.equal(result.totalSeconds, 62.4);
  });
});

describe("injectSmokeMarkers", () => {
  it("inserts smoke markers inside round windows", async () => {
    const { injectSmokeMarkers } = await import("../src/chapters.js");
    const base = await buildChapters([
      { label: "Lobby", durationSeconds: 4 },
      { label: "Round 1", durationSeconds: 40 },
      { label: "Round 2", durationSeconds: 30 },
    ]);
    const result = injectSmokeMarkers(base, [1, 2], [
      { roundIndex: 0, offsetSeconds: 10, label: "Smoke R1" },
      { roundIndex: 1, offsetSeconds: 5, label: "Smoke R2" },
    ]);
    assert.equal(
      result.text,
      ["0:00 Lobby", "0:04 Round 1", "0:14 Smoke R1", "0:44 Round 2", "0:49 Smoke R2"].join("\n"),
    );
  });
});
