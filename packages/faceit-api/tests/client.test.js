import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractDemoUrls,
  extractFaceitElo,
  extractPlayerKd,
  normalizeFaceitUrl,
} from "../src/client.js";

describe("normalizeFaceitUrl", () => {
  it("replaces {lang} placeholder", () => {
    assert.equal(
      normalizeFaceitUrl("https://www.faceit.com/{lang}/cs2/room/1-abc"),
      "https://www.faceit.com/en/cs2/room/1-abc",
    );
    assert.equal(
      normalizeFaceitUrl("https://www.faceit.com/%7Blang%7D/cs2/room/1-abc", "fr"),
      "https://www.faceit.com/fr/cs2/room/1-abc",
    );
  });
});

describe("extractFaceitElo", () => {
  it("reads cs2 faceit_elo", () => {
    assert.equal(extractFaceitElo({ games: { cs2: { faceit_elo: 2847 } } }), 2847);
  });
});

describe("extractPlayerKd", () => {
  it("sums kills/deaths and computes rating", () => {
    const payload = {
      rounds: [
        {
          round_stats: { Map: "de_mirage", Score: "13 / 11" },
          teams: [
            {
              team_stats: { "Team Win": "1" },
              players: [
                {
                  player_id: "abc",
                  player_stats: { Kills: "18", Deaths: "12", Assists: "3" },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = extractPlayerKd(payload, "abc", { faceitElo: 3000 });
    assert.equal(result.kills, 18);
    assert.equal(result.deaths, 12);
    assert.equal(result.kd, 1.5);
    assert.equal(result.rounds, 24);
    assert.ok(result.rating > 0);
    assert.equal(result.faceit_elo, 3000);
    assert.equal(result.map, "de_mirage");
    assert.equal(result.result, "win");
  });
});

describe("extractDemoUrls", () => {
  it("reads string or array demo_url", () => {
    assert.deepEqual(extractDemoUrls({ demo_url: "https://x/a.dem.gz" }), ["https://x/a.dem.gz"]);
    assert.deepEqual(extractDemoUrls({ demo_url: ["https://a", "https://b"] }), [
      "https://a",
      "https://b",
    ]);
  });
});
