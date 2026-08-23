import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWindowsCmdLine, quoteWindowsCmdArg } from "../src/run-csdm.js";

describe("quoteWindowsCmdArg", () => {
  it("leaves simple paths unchanged", () => {
    assert.equal(quoteWindowsCmdArg("C:\\jobs\\round-01.json"), "C:\\jobs\\round-01.json");
  });

  it("quotes paths with spaces", () => {
    assert.equal(
      quoteWindowsCmdArg("C:\\Users\\kingd\\Documents\\CS2 POV Generator\\jobs\\x.json"),
      '"C:\\Users\\kingd\\Documents\\CS2 POV Generator\\jobs\\x.json"',
    );
  });

  it("escapes embedded double quotes", () => {
    assert.equal(quoteWindowsCmdArg('say "hi"'), '"say \\"hi\\""');
  });
});

describe("buildWindowsCmdLine", () => {
  it("quotes the .cmd path and spaced config path", () => {
    const line = buildWindowsCmdLine(
      "C:\\Users\\kingd\\AppData\\Local\\Programs\\cs-demo-manager\\csdm.cmd",
      [
        "video",
        "--config-file",
        "C:\\Users\\kingd\\Documents\\CS2 POV Generator\\jobs\\x\\csdm-round-01.json",
        "--focus-player",
        "76561198200982290",
      ],
    );
    assert.equal(
      line,
      '"C:\\Users\\kingd\\AppData\\Local\\Programs\\cs-demo-manager\\csdm.cmd" video --config-file "C:\\Users\\kingd\\Documents\\CS2 POV Generator\\jobs\\x\\csdm-round-01.json" --focus-player 76561198200982290',
    );
    assert.ok(!line.includes('\\"'));
  });
});
