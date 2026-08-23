import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeRoundHighlight,
  formatRoundChapterLabel,
  shortWeaponName,
} from "../src/highlights.js";

describe("shortWeaponName", () => {
  it("maps common CS2 weapons", () => {
    assert.equal(shortWeaponName("usp_silencer"), "USP");
    assert.equal(shortWeaponName("ak47"), "AK");
    assert.equal(shortWeaponName("knife_karambit"), "Knife");
  });
});

describe("formatRoundChapterLabel", () => {
  it("returns plain Round N when nothing notable", () => {
    assert.equal(formatRoundChapterLabel(4, { kills: 1, weapon: "AK", clutch: false, ace: false }), "Round 4");
    assert.equal(formatRoundChapterLabel(2, null), "Round 2");
  });

  it("formats multi-kill + weapon", () => {
    assert.equal(
      formatRoundChapterLabel(2, { kills: 3, weapon: "USP", clutch: false, ace: false }),
      "Round 2 3K USP",
    );
  });

  it("formats clutch and ace", () => {
    assert.equal(
      formatRoundChapterLabel(1, { kills: 2, weapon: "AK", clutch: true, ace: false }),
      "Round 1 Clutch",
    );
    assert.equal(
      formatRoundChapterLabel(8, { kills: 5, weapon: "AK", clutch: false, ace: true }),
      "Round 8 Ace AK",
    );
  });
});

describe("analyzeRoundHighlight", () => {
  it("detects clutch when teammates died before first kill", () => {
    const deaths = [
      { tick: 100, user_steamid: "mate1", attacker_steamid: "enemy" },
      { tick: 110, user_steamid: "mate2", attacker_steamid: "enemy" },
      { tick: 200, user_steamid: "enemy1", attacker_steamid: "me", weapon: "usp_silencer" },
      { tick: 250, user_steamid: "enemy2", attacker_steamid: "me", weapon: "usp_silencer" },
      { tick: 300, user_steamid: "enemy3", attacker_steamid: "me", weapon: "usp_silencer" },
    ];
    const highlight = analyzeRoundHighlight({
      deaths,
      steamId: "me",
      startTick: 0,
      endTick: 500,
      teamSteamIds: ["me", "mate1", "mate2"],
      survived: true,
      playerSide: "CT",
      winner: "CT",
    });
    assert.equal(highlight.kills, 3);
    assert.equal(highlight.weapon, "USP");
    assert.equal(highlight.clutch, true);
    assert.equal(formatRoundChapterLabel(1, highlight), "Round 1 Clutch 3K USP");
  });
});
