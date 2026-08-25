/**
 * Build a CSDM `csdm video --config-file` JSON object from demo-parser output.
 * One sequence per selected round, POV camera + team-only voices for THAT round.
 *
 * CS2 camera focus (CSDM createCs2VideoJsonFile):
 *   spec_mode 1
 *   spec_player <slot>
 * where slot = user_id + 1 (same as CSDM DB players.index).
 * Without Postgres analyze, CSDM cannot resolve playerCameras → we inject cfg ourselves.
 */

/** Bitmask helpers matching CSDM generatePlayerVoicesValues (userId = slot - 1). */
export function generatePlayerVoicesValues(userIds) {
  let valueLow = 0;
  let valueHigh = 0;
  for (const userId of userIds) {
    const id = Number(userId);
    if (!Number.isFinite(id) || id < 0) {
      continue;
    }
    if (id < 32) {
      valueLow |= 1 << id;
    } else if (id < 64) {
      valueHigh |= 1 << (id - 32);
    }
  }
  return { valueLow: valueLow >>> 0, valueHigh: valueHigh >>> 0 };
}

/**
 * Start recording after skipping early freeze / buy time.
 * Default (skipSeconds < 0): start at freeze_end — skip round warmup/buy entirely.
 *
 * @param {{ round_start_tick: number, freeze_end_tick?: number }} row
 * @param {number} tickrate
 * @param {number} [skipSeconds=-1]
 */
export function clipStartTick(row, tickrate, skipSeconds = -1) {
  const roundStart = Number(row.round_start_tick);
  const freezeEnd = Math.max(roundStart, Number(row.freeze_end_tick ?? roundStart));
  const skip = Number(skipSeconds);

  // Default: skip freeze/buy ("warmup") — begin when the round goes live.
  if (!Number.isFinite(skip) || skip < 0) {
    return freezeEnd;
  }
  if (skip === 0) {
    return roundStart;
  }

  const rate = Math.max(1, Math.round(Number(tickrate) || 64));
  const skipTicks = Math.round(skip * rate);
  return Math.min(roundStart + skipTicks, freezeEnd);
}

/**
 * Build CFG that locks first-person POV on one player for the whole clip
 * and keeps in-game HUD (radar / killfeed / crosshair) without demo UI.
 *
 * Keep mirv_cmd count low — hundreds of scheduled cmds can hang/crash HLAE/CS2.
 *
 * @param {{
 *   slot: number,
 *   steamId: string,
 *   cameraTick: number,
 *   endTick: number,
 *   tickrate: number,
 *   voiceLow: number,
 *   voiceHigh: number,
 *   trueView?: boolean,
 * }} opts
 */
export function buildPovSequenceCfg(opts) {
  const slot = Number(opts.slot);
  const cameraTick = Math.max(96, Number(opts.cameraTick) || 96);
  const endTick = Math.max(cameraTick + 1, Number(opts.endTick) || cameraTick + 1);
  const tickrate = Math.max(1, Math.round(Number(opts.tickrate) || 64));
  // 2 = force TrueView even when demo client version mismatches (Valve Nov 2025).
  const demoPredict = opts.trueView === false ? 0 : 2;

  /** @type {string[]} */
  const cfgLines = [
    "sv_cheats 1",
    // TrueView: client-side prediction POV (must override CSDM settings.video.trueView=false).
    `cl_demo_predict ${demoPredict}`,
    // First-person POV on the target player (slot = user_id + 1).
    "spec_autodirector 0",
    "spec_mode 1",
    `spec_player ${slot}`,
    // Full in-game HUD: radar, HP, ammo, money, killfeed, crosshair, viewmodel.
    "cl_drawhud 1",
    "cl_draw_only_deathnotices 0",
    "r_drawviewmodel 1",
    "crosshair 1",
    "hud_showtargetid 1",
    "cl_radar_always_centered 0",
    "spec_show_xray 0",
    "cl_radar_square_always 0",
    "cl_radar_square_when_spectating 0",
    "cl_radar_square_with_scoreboard 0",
    // Hide CS2 demo playback chrome (bottom player / Shift+F2) — keep game HUD.
    "demo_ui_mode 0",
    "cl_showfps 0",
    "net_graph 0",
    "developer 0",
    "gameinstructor_enable 0",
    // Hide TrueView status text only (feature stays on via cl_demo_predict).
    "cl_trueview_show_status 0",
    "r_show_build_info 0",
    "mirv_endofmatch enabled 1",
    "mirv_panorama panelStyle panelId=trueview_row opacity=0",
    // Best-effort hide of remaining demo chrome panels (ignored if id missing).
    "mirv_panorama panelStyle panelId=HudDemoPlayback opacity=0",
    "mirv_panorama panelStyle panelId=DemoPlayback opacity=0",
    `tv_listen_voice_indices ${opts.voiceLow >>> 0}`,
    `tv_listen_voice_indices_h ${opts.voiceHigh >>> 0}`,
    "mirv_cmd clear",
  ];

  // Strategic re-locks only (start, +0.25s, +1s, then every ~3s) — avoids HLAE overload.
  const reinforceTicks = new Set([
    cameraTick,
    cameraTick + Math.max(8, Math.round(tickrate / 4)),
    cameraTick + tickrate,
  ]);
  const step = Math.max(64, tickrate * 3);
  for (let tick = cameraTick + step; tick < endTick; tick += step) {
    reinforceTicks.add(tick);
  }
  // Cap scheduled commands so long rounds stay safe.
  const sorted = [...reinforceTicks].filter((t) => t < endTick).sort((a, b) => a - b).slice(0, 16);

  for (const tick of sorted) {
    cfgLines.push(`mirv_cmd addAtTick ${tick} "spec_autodirector 0"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "spec_mode 1"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "spec_player ${slot}"`);
  }

  // Re-assert TrueView + hide demoui + keep HUD a few times during the clip.
  for (const tick of [sorted[0], sorted[1], sorted[Math.floor(sorted.length / 2)]].filter(Boolean)) {
    cfgLines.push(`mirv_cmd addAtTick ${tick} "cl_demo_predict ${demoPredict}"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "demo_ui_mode 0"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "cl_drawhud 1"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "cl_draw_only_deathnotices 0"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "crosshair 1"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "r_drawviewmodel 1"`);
    cfgLines.push(`mirv_cmd addAtTick ${tick} "cl_trueview_show_status 0"`);
  }

  return cfgLines.join("\n");
}

/**
 * @param {import('./types.js').ParseLike} parsed
 * @param {import('./types.js').BuildOptions} options
 */
export function buildCsdmVideoConfig(parsed, options) {
  const steamId = String(options.steamId);
  const player = parsed.players.find((entry) => entry.steam_id === steamId);
  if (!player) {
    throw new Error(`Player ${steamId} not found in parse result`);
  }
  if (player.slot == null || player.user_id == null) {
    throw new Error(
      `Player ${steamId} has no spectator slot/user_id from demo parse — re-run the parser.`,
    );
  }

  let rounds = parsed.player_rounds.filter((row) => row.steam_id === steamId);
  if (options.rounds?.length) {
    const wanted = new Set(options.rounds.map(Number));
    rounds = rounds.filter((row) => wanted.has(row.round_number));
  }
  if (rounds.length === 0) {
    throw new Error(`No player_rounds for ${steamId} (check --rounds filter)`);
  }

  const tickrate = Math.round(Number(parsed.tickrate) || 64);
  const matchStartTick = Math.max(0, Number(parsed.match_start_tick) || 0);
  // Default -1: start at freeze_end (skip buy / round warmup).
  const skipFreezeSeconds =
    options.skipFreezeSeconds === undefined ? -1 : Number(options.skipFreezeSeconds);
  // Hold a few seconds after death or round end (default 3s).
  const endPaddingSeconds = Number(options.endPaddingSeconds ?? 3);
  const endPadding =
    options.endPaddingTicks != null
      ? Number(options.endPaddingTicks)
      : Math.round(Math.max(0, endPaddingSeconds) * tickrate);

  const width = options.width ?? 3840;
  const height = options.height ?? 2160;
  const framerate = options.framerate ?? 60;
  const showXRay = options.showXRay ?? false;
  // YouTube POV: full player HUD (radar, health, killfeed, crosshair) — not death-notices-only.
  const showOnlyDeathNotices = options.showOnlyDeathNotices ?? false;
  const trueView = options.trueView ?? true;
  const videoCodec = options.videoCodec ?? "libx264";
  const constantRateFactor = options.constantRateFactor ?? 23;
  const mapSlug = (parsed.map ?? "map").replace(/[^\w-]+/g, "_");

  const nameBySteamId = new Map(parsed.players.map((entry) => [entry.steam_id, entry.name]));
  const slotBySteamId = new Map(
    parsed.players
      .filter((entry) => entry.slot != null)
      .map((entry) => [entry.steam_id, { slot: entry.slot, user_id: entry.user_id }]),
  );

  const sequences = rounds.map((row, index) => {
    const teamSet = new Set(row.team_steam_ids.map(String));
    let startTick = clipStartTick(row, tickrate, skipFreezeSeconds);
    // Never record warmup: floor at match start when known.
    if (matchStartTick > 0) {
      startTick = Math.max(startTick, matchStartTick);
    }
    const roundEnd = Number(row.round_end_tick ?? row.clip_end_tick);
    const paddedEnd = Number(row.clip_end_tick) + endPadding;
    const maxEnd = roundEnd + endPadding;
    const endTick = Math.max(startTick + 1, Math.min(paddedEnd, maxEnd));
    // Spec after freezetime when possible — after demo_gototick setup (CSDM issue #1238).
    const cameraTick = Math.max(
      startTick + 1,
      Number(row.freeze_end_tick ?? startTick) + 1,
      // CSDM also avoids the first ~96 ticks after a skip.
      96,
    );

    // Prefer per-round spectator slot when the parser provided it.
    const roundSlot =
      row.spectator_slot != null
        ? Number(row.spectator_slot)
        : player.slot;
    const roundUserId =
      row.user_id != null ? Number(row.user_id) : player.user_id;

    const optionSteamIds = new Set([
      ...parsed.players.map((entry) => entry.steam_id),
      ...row.team_steam_ids.map(String),
    ]);

    const playersOptions = [...optionSteamIds].map((id) => ({
      steamId: id,
      playerName: nameBySteamId.get(id) ?? id,
      showKill: true,
      highlightKill: id === steamId,
      isVoiceEnabled: teamSet.has(id),
    }));

    const voiceUserIds = [...teamSet]
      .map((id) => {
        if (id === steamId && roundUserId != null) {
          return roundUserId;
        }
        return slotBySteamId.get(id)?.user_id;
      })
      .filter((id) => id != null);
    const { valueLow, valueHigh } = generatePlayerVoicesValues(voiceUserIds);

    const cfg = buildPovSequenceCfg({
      slot: roundSlot,
      steamId,
      cameraTick,
      endTick,
      tickrate,
      voiceLow: valueLow,
      voiceHigh: valueHigh,
      trueView,
    });

    // A few camera keys help when CSDM DB resolves playerCameras (analyze + Postgres).
    // Keep count low — CSDM emits one spec_player action per entry.
    /** @type {{ tick: number, playerSteamId: string, playerName: string }[]} */
    const playerCameras = [];
    const cameraStep = Math.max(128, Math.round(tickrate * 5));
    for (let tick = cameraTick; tick < endTick; tick += cameraStep) {
      playerCameras.push({
        tick,
        playerSteamId: steamId,
        playerName: player.name,
      });
      if (playerCameras.length >= 8) {
        break;
      }
    }
    if (playerCameras.length === 0) {
      playerCameras.push({
        tick: cameraTick,
        playerSteamId: steamId,
        playerName: player.name,
      });
    }

    return {
      number: index + 1,
      startTick,
      endTick,
      showOnlyDeathNotices,
      deathNoticesDuration: 5,
      showXRay,
      showAssists: true,
      playerVoicesEnabled: true,
      recordAudio: true,
      cfg,
      playersOptions,
      playerCameras,
      cameras: [],
      _meta: {
        roundNumber: row.round_number,
        playerSide: row.player_side,
        survived: row.survived,
        deathTick: row.player_death_tick,
        teamSteamIds: row.team_steam_ids,
        startTick,
        endTick,
        slot: roundSlot,
        userId: roundUserId,
      },
    };
  });

  return {
    demoPath: parsed.demo_path,
    outputFolderPath: options.outputFolderPath,
    outputFileName: options.outputFileName ?? `pov-${mapSlug}-${player.name}-r{sequence}`,
    recordingSystem: "HLAE",
    recordingOutput: "video",
    encoderSoftware: "FFmpeg",
    width,
    height,
    framerate,
    closeGameAfterRecording: options.closeGameAfterRecording ?? true,
    concatenateSequences: false,
    trueView,
    ffmpegSettings: buildFfmpegSettings(videoCodec, constantRateFactor),
    sequences,
  };
}

/**
 * @param {string} videoCodec
 * @param {number} crf
 */
function buildFfmpegSettings(videoCodec, crf) {
  const codec = String(videoCodec);
  const isGpu =
    codec === "hevc_nvenc" ||
    codec === "h264_nvenc" ||
    codec === "hevc_amf" ||
    codec === "h264_amf";

  /** @type {string} */
  let outputParameters = "";
  if (codec === "hevc_nvenc" || codec === "h264_nvenc") {
    outputParameters = `-pix_fmt yuv420p -preset p4 -rc vbr -cq ${crf} -b:v 0`;
    if (codec === "hevc_nvenc") {
      outputParameters += " -tag:v hvc1";
    }
  } else if (codec === "hevc_amf" || codec === "h264_amf") {
    outputParameters = `-pix_fmt yuv420p -quality balanced -rc cqp -qp_i ${crf} -qp_p ${crf}`;
    if (codec === "hevc_amf") {
      outputParameters += " -tag:v hvc1";
    }
  } else if (codec === "libx265") {
    outputParameters = `-pix_fmt yuv420p -crf ${crf} -preset medium -tag:v hvc1`;
  }

  return {
    audioBitrate: 256,
    constantRateFactor: crf,
    customLocationEnabled: false,
    customExecutableLocation: "",
    videoContainer: "mp4",
    videoCodec: codec,
    audioCodec: "aac",
    inputParameters: "",
    // GPU encoders: avoid CSDM's default -crf which NVENC/AMF reject or ignore poorly.
    outputParameters: isGpu || codec === "libx265" ? outputParameters : "",
  };
}

/** Strip internal `_meta` before handing the file to CSDM. */
export function toCsdmConfigFile(config) {
  return {
    ...config,
    sequences: config.sequences.map(({ _meta, ...sequence }) => sequence),
  };
}

/**
 * Split a multi-sequence config into one config file payload per sequence
 * (safer for retries / cache per round).
 */
export function splitConfigPerSequence(config) {
  return config.sequences.map((sequence) => {
    const meta = sequence._meta ?? {};
    const roundNumber = meta.roundNumber ?? sequence.number;
    return {
      roundNumber,
      config: toCsdmConfigFile({
        ...config,
        outputFileName:
          typeof config.outputFileName === "string"
            ? config.outputFileName
                .replace("{sequence}", String(sequence.number))
                .replace("{round}", String(roundNumber))
            : `pov-round-${roundNumber}`,
        sequences: [{ ...sequence, number: 1 }],
      }),
    };
  });
}
