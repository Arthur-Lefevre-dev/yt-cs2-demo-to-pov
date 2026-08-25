import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findSteamExe, steamExeCandidates } from "../src/steam.js";

describe("steamExeCandidates", () => {
  it("includes default Program Files (x86) Steam path", () => {
    const list = steamExeCandidates();
    assert.ok(list.some((p) => /Steam[\\/]steam\.exe$/i.test(p)));
  });
});

describe("findSteamExe", () => {
  it("returns a path or null without throwing", () => {
    const exe = findSteamExe();
    assert.ok(exe === null || /steam\.exe$/i.test(exe));
  });
});
