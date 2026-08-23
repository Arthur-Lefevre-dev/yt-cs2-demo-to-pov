import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVideoFilters, clampFadeSeconds } from "../src/assemble.js";
import { resolveVideoCodec, videoEncoderArgs } from "../src/encoder.js";

describe("fade helpers", () => {
  it("clamps fade on short clips", () => {
    assert.equal(clampFadeSeconds(1, 0.5), 1 / 3);
    assert.equal(clampFadeSeconds(10, 0.5), 0.5);
    assert.equal(clampFadeSeconds(4, 0), 0);
  });

  it("builds fade to black filter for intro/commercial", () => {
    const vf = buildVideoFilters({
      width: 1280,
      height: 720,
      durationSeconds: 4,
      fadeSeconds: 0.5,
    });
    assert.match(vf, /fade=t=in:st=0:d=0\.5:color=black/);
    assert.match(vf, /fade=t=out:st=3\.5:d=0\.5:color=black/);
  });
});

describe("encoder profiles", () => {
  it("resolves aliases", () => {
    assert.equal(resolveVideoCodec("h265-nvenc"), "hevc_nvenc");
    assert.equal(resolveVideoCodec("libx265"), "libx265");
  });

  it("emits nvenc args without crf", () => {
    const args = videoEncoderArgs("hevc_nvenc");
    assert.equal(args[0], "hevc_nvenc");
    assert.ok(args.includes("-cq"));
    assert.ok(!args.includes("-crf"));
  });
});
