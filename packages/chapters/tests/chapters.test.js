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
