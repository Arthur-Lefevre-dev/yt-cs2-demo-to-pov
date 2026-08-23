/**
 * Build a CSDM `csdm video --config-file` JSON object from demo-parser output.
 * One sequence per selected round, POV camera + team-only voices for THAT round.
 */

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

  let rounds = parsed.player_rounds.filter((row) => row.steam_id === steamId);
  if (options.rounds?.length) {
    const wanted = new Set(options.rounds.map(Number));
    rounds = rounds.filter((row) => wanted.has(row.round_number));
  }
  if (rounds.length === 0) {
    throw new Error(`No player_rounds for ${steamId} (check --rounds filter)`);
  }

  const endPadding = Number(options.endPaddingTicks ?? 0);
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const framerate = options.framerate ?? 60;
  const showXRay = options.showXRay ?? false;
  const mapSlug = (parsed.map ?? "map").replace(/[^\w-]+/g, "_");

  const nameBySteamId = new Map(parsed.players.map((entry) => [entry.steam_id, entry.name]));

  const sequences = rounds.map((row, index) => {
    const teamSet = new Set(row.team_steam_ids.map(String));
    const startTick = row.round_start_tick;
    const endTick = Math.max(startTick + 1, row.clip_end_tick + endPadding);

    // Include every known player so CSDM can mute non-team voices via isVoiceEnabled.
    // Also include any teammate steam id missing from the global roster.
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

    return {
      number: index + 1,
      startTick,
      endTick,
      showOnlyDeathNotices: true,
      deathNoticesDuration: 5,
      showXRay,
      showAssists: true,
      playerVoicesEnabled: true,
      recordAudio: true,
      playersOptions,
      playerCameras: [
        {
          tick: startTick,
          playerSteamId: steamId,
          playerName: player.name,
        },
      ],
      cameras: [],
      // Metadata for our pipeline (CSDM ignores unknown fields if strict — strip before write)
      _meta: {
        roundNumber: row.round_number,
        playerSide: row.player_side,
        survived: row.survived,
        deathTick: row.player_death_tick,
        teamSteamIds: row.team_steam_ids,
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
    trueView: false,
    ffmpegSettings: {
      audioBitrate: 256,
      constantRateFactor: 23,
      customLocationEnabled: false,
      customExecutableLocation: "",
      videoContainer: "mp4",
      videoCodec: "libx264",
      audioCodec: "aac",
      inputParameters: "",
      outputParameters: "",
    },
    sequences,
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
