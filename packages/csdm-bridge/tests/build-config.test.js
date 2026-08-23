import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCsdmVideoConfig,
  splitConfigPerSequence,
  toCsdmConfigFile,
} from "../src/build-config.js";

const parsed = {
  demo_path: "C:\\demos\\match.dem",
  map: "de_mirage",
  tickrate: 64,
  players: [
    { steam_id: "111", name: "Alpha", user_id: 0, slot: 1 },
    { steam_id: "222", name: "Bravo", user_id: 1, slot: 2 },
    { steam_id: "333", name: "Charlie", user_id: 2, slot: 3 },
    { steam_id: "444", name: "Delta", user_id: 3, slot: 4 },
  ],
  player_rounds: [
    {
      steam_id: "111",
      player_name: "Alpha",
      round_number: 1,
      round_start_tick: 1000,
      freeze_end_tick: 1600,
      player_death_tick: 2500,
      round_end_tick: 3000,
      clip_end_tick: 2500,
      player_side: "T",
      team_steam_ids: ["111", "222"],
      survived: false,
    },
    {
      steam_id: "111",
      player_name: "Alpha",
      round_number: 13,
      round_start_tick: 10000,
      freeze_end_tick: 10600,
      player_death_tick: null,
      round_end_tick: 12000,
      clip_end_tick: 12000,
      player_side: "CT",
      team_steam_ids: ["111", "333"],
      survived: true,
    },
  ],
};

describe("buildCsdmVideoConfig", () => {
  it("builds one sequence per round with team-only voices and POV camera", () => {
    const config = buildCsdmVideoConfig(parsed, {
      steamId: "111",
      outputFolderPath: "C:\\out",
      rounds: [1],
    });

    assert.equal(config.demoPath, "C:\\demos\\match.dem");
    assert.equal(config.recordingSystem, "HLAE");
    assert.equal(config.encoderSoftware, "FFmpeg");
    assert.equal(config.ffmpegSettings.videoCodec, "libx264");
    assert.equal(config.ffmpegSettings.outputParameters, "");

    const nvenc = buildCsdmVideoConfig(parsed, {
      steamId: "111",
      outputFolderPath: "/tmp/out",
      rounds: [1],
      videoCodec: "hevc_nvenc",
    });
    assert.equal(nvenc.ffmpegSettings.videoCodec, "hevc_nvenc");
    assert.match(nvenc.ffmpegSettings.outputParameters, /-cq 23/);
    assert.match(nvenc.ffmpegSettings.outputParameters, /-preset p4/);
    assert.equal(config.concatenateSequences, false);
    assert.equal(config.sequences.length, 1);

    const sequence = config.sequences[0];
    // 10s skip @ 64 tick = 640; freeze ends at 1600 → start at freeze_end.
    assert.equal(sequence.startTick, 1600);
    assert.equal(sequence.endTick, 2692);
    assert.equal(sequence.playerVoicesEnabled, true);
    assert.deepEqual(sequence.playerCameras, [
      { tick: 1601, playerSteamId: "111", playerName: "Alpha" },
    ]);
    assert.equal(sequence.showOnlyDeathNotices, false);
    assert.match(sequence.cfg, /demo_ui_mode 0/);
    assert.match(sequence.cfg, /cl_drawhud 1/);
    assert.match(sequence.cfg, /cl_draw_only_deathnotices 0/);
    assert.match(sequence.cfg, /r_drawviewmodel 1/);
    assert.match(sequence.cfg, /spec_player 1/);

    const voices = Object.fromEntries(
      sequence.playersOptions.map((opt) => [opt.steamId, opt.isVoiceEnabled]),
    );
    assert.equal(voices["111"], true);
    assert.equal(voices["222"], true);
    assert.equal(voices["333"], false);
    assert.equal(voices["444"], false);
  });

  it("can disable freeze skip", () => {
    const config = buildCsdmVideoConfig(parsed, {
      steamId: "111",
      outputFolderPath: "C:\\out",
      rounds: [1],
      skipFreezeSeconds: 0,
    });
    assert.equal(config.sequences[0].startTick, 1000);
  });

  it("follows side switch team roster on later rounds", () => {
    const config = buildCsdmVideoConfig(parsed, {
      steamId: "111",
      outputFolderPath: "C:\\out",
      rounds: [13],
    });
    const voices = Object.fromEntries(
      config.sequences[0].playersOptions.map((opt) => [opt.steamId, opt.isVoiceEnabled]),
    );
    assert.equal(voices["111"], true);
    assert.equal(voices["333"], true);
    assert.equal(voices["222"], false);
    assert.equal(config.sequences[0].endTick, 12192);
  });

  it("strips _meta for the on-disk CSDM file", () => {
    const config = buildCsdmVideoConfig(parsed, {
      steamId: "111",
      outputFolderPath: "C:\\out",
      rounds: [1],
    });
    assert.ok(config.sequences[0]._meta);
    const clean = toCsdmConfigFile(config);
    assert.equal(clean.sequences[0]._meta, undefined);
  });

  it("splits into one config per round", () => {
    const config = buildCsdmVideoConfig(parsed, {
      steamId: "111",
      outputFolderPath: "C:\\out",
    });
    const parts = splitConfigPerSequence(config);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].roundNumber, 1);
    assert.equal(parts[1].roundNumber, 13);
    assert.equal(parts[0].config.sequences.length, 1);
    assert.equal(parts[0].config.sequences[0]._meta, undefined);
  });
});
