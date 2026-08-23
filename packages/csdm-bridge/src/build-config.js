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

  const endPadding = Number(options.endPaddingTicks ?? 0);
  const width = options.width ?? 3840;
  const height = options.height ?? 2160;
  const framerate = options.framerate ?? 60;
  const showXRay = options.showXRay ?? false;
  // YouTube POV: full player HUD (radar, health, alive teammates) — not death-notices-only.
  const showOnlyDeathNotices = options.showOnlyDeathNotices ?? false;
  const trueView = options.trueView ?? true;
  const videoCodec = options.videoCodec ?? "libx264";
  const constantRateFactor = options.constantRateFactor ?? 23;
  const mapSlug = (parsed.map ?? "map").replace(/[^\w-]+/g, "_");
  const tickrate = Math.round(Number(parsed.tickrate) || 64);

  const nameBySteamId = new Map(parsed.players.map((entry) => [entry.steam_id, entry.name]));
  const slotBySteamId = new Map(
    parsed.players
      .filter((entry) => entry.slot != null)
      .map((entry) => [entry.steam_id, { slot: entry.slot, user_id: entry.user_id }]),
  );

  const sequences = rounds.map((row, index) => {
    const teamSet = new Set(row.team_steam_ids.map(String));
    const startTick = row.round_start_tick;
    const endTick = Math.max(startTick + 1, row.clip_end_tick + endPadding);
    // Spec after freezetime when possible — after demo_gototick setup (CSDM issue #1238).
    const cameraTick = Math.max(
      startTick + 1,
      Number(row.freeze_end_tick ?? startTick) + 1,
      // CSDM also avoids the first ~96 ticks after a skip.
      96,
    );

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
      .map((id) => slotBySteamId.get(id)?.user_id)
      .filter((id) => id != null);
    const { valueLow, valueHigh } = generatePlayerVoicesValues(voiceUserIds);

    // CS2 first-person POV: live-player HUD (radar / HP / money / ammo / killfeed).
    // Hide CS2 demo playback UI (timeline / demoui) — not the game HUD.
    const cfgLines = [
      "spec_mode 1",
      `spec_player ${player.slot}`,
      // Full in-game HUD like when the player is alive in-match.
      "cl_drawhud 1",
      "cl_draw_only_deathnotices 0",
      "r_drawviewmodel 1",
      "hud_showtargetid 1",
      "cl_radar_always_centered 0",
      "spec_show_xray 0",
      // Hide demo navigation / demoui (Shift+F2 panel, timeline).
      "demo_ui_mode 0",
      // Clean debug overlays.
      "cl_showfps 0",
      "net_graph 0",
      "developer 0",
      // Hide end-of-match / TrueView telemetry chrome when present.
      "mirv_endofmatch enabled 1",
      "mirv_panorama panelStyle panelId=trueview_row opacity=0",
      `tv_listen_voice_indices ${valueLow}`,
      `tv_listen_voice_indices_h ${valueHigh}`,
      // Re-apply focus + HUD / hide demoui after freezetime (gototick can drop early cmds).
      `mirv_cmd clear`,
      `mirv_cmd addAtTick ${cameraTick} "spec_mode 1"`,
      `mirv_cmd addAtTick ${cameraTick} "spec_player ${player.slot}"`,
      `mirv_cmd addAtTick ${cameraTick + Math.max(8, Math.round(tickrate / 4))} "spec_player ${player.slot}"`,
      `mirv_cmd addAtTick ${cameraTick} "cl_drawhud 1"`,
      `mirv_cmd addAtTick ${cameraTick} "cl_draw_only_deathnotices 0"`,
      `mirv_cmd addAtTick ${cameraTick} "r_drawviewmodel 1"`,
      `mirv_cmd addAtTick ${cameraTick} "demo_ui_mode 0"`,
      `mirv_cmd addAtTick ${cameraTick} "mirv_panorama panelStyle panelId=trueview_row opacity=0"`,
    ];

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
      cfg: cfgLines.join("\n"),
      playersOptions,
      playerCameras: [
        {
          tick: cameraTick,
          playerSteamId: steamId,
          playerName: player.name,
        },
      ],
      cameras: [],
      _meta: {
        roundNumber: row.round_number,
        playerSide: row.player_side,
        survived: row.survived,
        deathTick: row.player_death_tick,
        teamSteamIds: row.team_steam_ids,
        startTick,
        endTick,
        slot: player.slot,
        userId: player.user_id,
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
