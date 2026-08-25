import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { injectEarlyDemoCommands } from "../src/hlae-prep.js";

describe("injectEarlyDemoCommands", () => {
  it("prepends TrueView + demoui hide and strips demoui toggles", () => {
    const data = [
      {
        actions: [
          { tick: 200, cmd: "demoui" },
          { tick: 500, cmd: "spec_mode 1" },
        ],
      },
    ];
    assert.equal(injectEarlyDemoCommands(data), true);
    assert.ok(!data[0].actions.some((a) => a.cmd === "demoui"));
    assert.ok(data[0].actions.some((a) => a.tick === 96 && a.cmd === "demo_ui_mode 0"));
    assert.ok(data[0].actions.some((a) => a.tick === 96 && a.cmd === "cl_demo_predict 2"));
    assert.ok(data[0].actions.some((a) => a.cmd === "cl_draw_only_deathnotices 0"));
  });
});
