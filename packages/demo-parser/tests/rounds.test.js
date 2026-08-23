import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOfficialRounds,
  computeHltvRating1,
  countPlayerStats,
  firstDeathTick,
  inferMatchStartTick,
  normalizeSteamId,
  sideFromTeamNum,
} from "../src/rounds.js";

describe("normalizeSteamId", () => {
  it("keeps string SteamID64 intact", () => {
    assert.equal(normalizeSteamId("76561198000697560"), "76561198000697560");
  });

  it("rejects unsafe numbers instead of corrupting SteamID64", () => {
    assert.equal(normalizeSteamId(76561198000697560), null);
  });
});

describe("sideFromTeamNum", () => {
  it("maps CS2 team numbers", () => {
    assert.equal(sideFromTeamNum(2), "T");
    assert.equal(sideFromTeamNum(3), "CT");
    assert.equal(sideFromTeamNum(1), null);
  });
});

describe("buildOfficialRounds", () => {
  it("skips warmup events before begin_new_match and pairs start/end", () => {
    const events = [
      { event_name: "round_start", tick: 100 },
      { event_name: "round_end", tick: 400 },
      { event_name: "begin_new_match", tick: 1000 },
      { event_name: "round_start", tick: 1100 },
      { event_name: "round_freeze_end", tick: 1800 },
      { event_name: "round_end", tick: 4000, winner: 2 },
      { event_name: "round_officially_ended", tick: 4200 },
      { event_name: "round_start", tick: 4300 },
      { event_name: "round_freeze_end", tick: 5000 },
      { event_name: "round_end", tick: 8000, winner: "CT" },
      { event_name: "round_officially_ended", tick: 8200 },
    ];

    const rounds = buildOfficialRounds(events);
    assert.equal(inferMatchStartTick(events), 1000);
    assert.equal(rounds.length, 2);
    assert.deepEqual(rounds[0], {
      round_number: 1,
      start_tick: 1100,
      freeze_end_tick: 1800,
      end_tick: 4000,
      official_end_tick: 4200,
      winner: "T",
      end_reason: null,
    });
    assert.equal(rounds[1].winner, "CT");
    assert.equal(rounds[1].start_tick, 4300);
  });

  it("keeps the pistol round whose start tick is a few ticks before begin_new_match", () => {
    const events = [
      { event_name: "round_start", tick: 6085 },
      { event_name: "begin_new_match", tick: 6088 },
      { event_name: "round_freeze_end", tick: 7461 },
      { event_name: "round_end", tick: 11616, winner: "CT" },
      { event_name: "round_start", tick: 12064 },
      { event_name: "round_freeze_end", tick: 13024 },
      { event_name: "round_end", tick: 18310, winner: "T" },
    ];
    const rounds = buildOfficialRounds(events);
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0].start_tick, 6085);
    assert.equal(rounds[0].end_tick, 11616);
    assert.equal(rounds[1].start_tick, 12064);
  });

  it("drops a trailing unfinished round with no round_end", () => {
    const events = [
      { event_name: "round_start", tick: 100 },
      { event_name: "round_end", tick: 500, winner: 3 },
      { event_name: "round_start", tick: 600 },
    ];
    const rounds = buildOfficialRounds(events, { matchStartTick: 0 });
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].end_tick, 500);
  });
});

describe("firstDeathTick / countPlayerStats", () => {
  const deaths = [
    { tick: 1200, user_steamid: "A", attacker_steamid: "B" },
    { tick: 1500, user_steamid: "B", attacker_steamid: "A", assister_steamid: "C" },
    { tick: 9000, user_steamid: "A", attacker_steamid: "B" },
  ];

  it("returns the first death inside the round window", () => {
    assert.equal(firstDeathTick(deaths, "A", 1000, 4000), 1200);
    assert.equal(firstDeathTick(deaths, "A", 2000, 4000), null);
  });

  it("counts K/D/A", () => {
    assert.deepEqual(countPlayerStats(deaths, "A"), { kills: 1, deaths: 2, assists: 0 });
    assert.deepEqual(countPlayerStats(deaths, "C"), { kills: 0, deaths: 0, assists: 1 });
  });
});

describe("computeHltvRating1", () => {
  it("returns near 1.0 for average-ish stats", () => {
    // 16 kills / 24 rounds ≈ 0.67 KPR, 8 survivals → around 0.8–1.0 on Rating 1.0
    const rating = computeHltvRating1({
      kills: 16,
      deaths: 16,
      rounds: 24,
      roundKillCounts: Array.from({ length: 24 }, (_, i) => (i < 16 ? 1 : 0)),
    });
    assert.ok(rating > 0.75 && rating < 1.05, `got ${rating}`);
  });

  it("rates high KPR multi-kill games above 1.3", () => {
    const rating = computeHltvRating1({
      kills: 30,
      deaths: 12,
      rounds: 24,
      roundKillCounts: [
        ...Array.from({ length: 6 }, () => 3),
        ...Array.from({ length: 6 }, () => 2),
        ...Array.from({ length: 12 }, () => 0),
      ],
    });
    assert.ok(rating >= 1.3, `got ${rating}`);
  });
});
