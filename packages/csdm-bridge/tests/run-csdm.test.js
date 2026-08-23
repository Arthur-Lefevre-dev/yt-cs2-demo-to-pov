import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildWindowsCmdLine,
  quoteWindowsCmdArg,
  resolveCsdmLaunch,
} from "../src/run-csdm.js";

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
    assert.match(line, /--config-file "/);
    assert.ok(!line.includes('\\"'));
  });
});

describe("resolveCsdmLaunch", () => {
  it("uses Electron-as-Node when CSDM is installed", () => {
    const launch = resolveCsdmLaunch();
    if (!existsSync(join(process.env.LOCALAPPDATA ?? "", "Programs", "cs-demo-manager", "cs-demo-manager.exe"))) {
      return;
    }
    assert.match(launch.command, /cs-demo-manager\.exe$/i);
    assert.equal(launch.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(launch.prefixArgs.length, 1);
    assert.match(launch.prefixArgs[0], /cli\.js$/i);
  });
});
