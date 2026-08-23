import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanTeamName,
  detectMatchKind,
  formatMatchup,
  inferEventName,
} from "../src/match-meta.js";

describe("detectMatchKind", () => {
  it("detects FACEIT from server name", () => {
    assert.equal(detectMatchKind("FACEIT.com register to play here", "foo.dem"), "faceit");
  });

  it("detects Valve Premier from path/server", () => {
    assert.equal(detectMatchKind("CS2 Premier Match", "match.dem"), "premier");
  });

  it("does not treat BLAST.tv Premier servers as Valve Premier", () => {
    assert.equal(
      detectMatchKind("BLAST.tv Premier CS2 Server", "inferno.dem"),
      "tournament",
    );
  });

  it("defaults to tournament", () => {
    assert.equal(detectMatchKind("GOTV Demo — BLAST", "blast-rio.dem"), "tournament");
  });
});

describe("inferEventName", () => {
  it("parses BLAST / IEM from filename", () => {
    assert.equal(inferEventName("blast-spring-vitality-vs-spirit.dem"), "BLAST.tv");
    assert.equal(inferEventName("iem-rio-2024-m1-nuke.dem"), "IEM Rio 2024");
  });

  it("parses BLAST from server name", () => {
    assert.equal(inferEventName("match.dem", "BLAST.tv Premier CS2 Server"), "BLAST.tv");
  });
});

describe("cleanTeamName / formatMatchup", () => {
  it("strips FACEIT team_ prefixes", () => {
    assert.equal(cleanTeamName("team_Dr_Agorille"), "Dr_Agorille");
    assert.equal(cleanTeamName("Vitality"), "Vitality");
  });

  it("puts player team first", () => {
    assert.equal(
      formatMatchup({ teamCt: "Vitality", teamT: "Spirit", playerSide: "CT" }),
      "Vitality vs Spirit",
    );
    assert.equal(
      formatMatchup({ teamCt: "Vitality", teamT: "Spirit", playerSide: "T" }),
      "Spirit vs Vitality",
    );
  });
});
