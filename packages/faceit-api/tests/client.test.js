import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractDemoUrls,
  extractFaceitElo,
  extractPlayerKd,
  normalizeFaceitUrl,
  parseMatchRating,
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

describe("sanitizeFaceitMatchId + faceitMatchRoomUrl", () => {
  it("strips -lobby filename suffix and builds room URL", async () => {
    const { faceitMatchRoomUrl, sanitizeFaceitMatchId } = await import("../src/client.js");
    assert.equal(
      sanitizeFaceitMatchId("1-b2b4c6c4-2d2b-4382-bc8d-8d778ba2913d-lobby.jpg"),
      "1-b2b4c6c4-2d2b-4382-bc8d-8d778ba2913d",
    );
    assert.equal(
      faceitMatchRoomUrl("1-b2b4c6c4-2d2b-4382-bc8d-8d778ba2913d-lobby"),
      "https://www.faceit.com/en/cs2/room/1-b2b4c6c4-2d2b-4382-bc8d-8d778ba2913d",
    );
  });
});

describe("extractFaceitElo", () => {
  it("reads cs2 faceit_elo", () => {
    assert.equal(extractFaceitElo({ games: { cs2: { faceit_elo: 2847 } } }), 2847);
  });
});

describe("extractPlayerKd", () => {
  it("sums kills/deaths and computes match rating (not Elo)", () => {
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
                  player_stats: { Kills: "18", Deaths: "12", Assists: "3", Rating: "1.44" },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = extractPlayerKd(payload, "abc");
    assert.equal(result.kills, 18);
    assert.equal(result.deaths, 12);
    assert.equal(result.kd, 1.5);
    assert.equal(result.rounds, 24);
    assert.equal(result.rating, 1.44);
    assert.equal(result.faceit_rating, 1.44);
    assert.equal(result.map, "de_mirage");
    assert.equal(result.result, "win");
  });
});

describe("parseMatchRating", () => {
  it("accepts match Rating and rejects Elo-sized numbers", () => {
    assert.equal(parseMatchRating({ Rating: "1.63" }), 1.63);
    assert.equal(parseMatchRating({ Rating: "3906" }), null);
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

describe("isDirectDemoDownloadUrl", () => {
  it("rejects private demos.faceit.com resource hosts", async () => {
    const { isDirectDemoDownloadUrl } = await import("../src/demo-download.js");
    assert.equal(
      isDirectDemoDownloadUrl(
        "https://demos.faceit.com/cs2/1-abc-1-1.dem.gz",
      ),
      false,
    );
    assert.equal(
      isDirectDemoDownloadUrl(
        "https://demos-europe-west2.faceit-cdn.net/cs2/1-abc.dem.gz?X-Amz-Signature=x",
      ),
      true,
    );
  });
});
