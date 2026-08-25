import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLobbyTeams } from "../src/lobby-screenshot.js";

describe("extractLobbyTeams", () => {
  it("reads faction1 / faction2 rosters and map pick", () => {
    const lobby = extractLobbyTeams({
      match_id: "1-abc",
      competition_name: "CS2 5v5",
      teams: {
        faction1: {
          name: "Team Alpha",
          roster: [{ nickname: "A1", game_skill_level: 10 }],
        },
        faction2: {
          name: "Team Bravo",
          roster: [{ nickname: "B1", game_skill_level: 8 }],
        },
      },
      voting: { map: { pick: ["de_dust2"] } },
      results: { score: { faction1: 13, faction2: 9 } },
    });
    assert.equal(lobby.left.name, "Team Alpha");
    assert.equal(lobby.right.name, "Team Bravo");
    assert.equal(lobby.map, "de_dust2");
    assert.equal(lobby.left.score, 13);
    assert.equal(lobby.right.roster[0].nickname, "B1");
  });
});
