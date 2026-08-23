import { parseEvent, parseEvents, parseHeader, parsePlayerInfo, parseTicks } from "@laihoe/demoparser2";
import { resolve } from "node:path";
import {
  buildOfficialRounds,
  countPlayerStats,
  computeHltvRating1,
  firstDeathTick,
  inferMatchStartTick,
  inferTickrate,
  killsInTickWindow,
  normalizeSteamId,
  sideFromTeamNum,
} from "./rounds.js";
import {
  detectMatchKind,
  dominantClanForSide,
  formatMatchup,
  inferEventName,
} from "./match-meta.js";
import { analyzeRoundHighlight, formatRoundChapterLabel } from "./highlights.js";

const EVENT_NAMES = [
  "begin_new_match",
  "round_announce_match_start",
  "round_start",
  "round_freeze_end",
  "round_end",
  "round_officially_ended",
  "player_death",
];

function asEventList(parsed, fallbackName) {
  if (!parsed) {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.map((event) => ({
      event_name: event.event_name ?? event.eventName ?? fallbackName,
      ...event,
    }));
  }
  return [];
}

function collectEvents(demoPath) {
  let parsed;
  try {
    parsed = parseEvents(demoPath, EVENT_NAMES);
  } catch {
    parsed = null;
  }

  if (Array.isArray(parsed) && parsed.length > 0) {
    return asEventList(parsed);
  }

  const events = [];
  for (const name of EVENT_NAMES) {
    try {
      events.push(...asEventList(parseEvent(demoPath, name), name));
    } catch {
      // Event absent from this demo.
    }
  }
  return events;
}

function steamIdFromPlayerInfo(player) {
  return (
    normalizeSteamId(player.steamid) ??
    normalizeSteamId(player.steam_id) ??
    normalizeSteamId(player.steamId) ??
    normalizeSteamId(typeof player.steamid64 === "string" ? player.steamid64 : null)
  );
}

function sampleSidesAtTicks(demoPath, ticks) {
  if (ticks.length === 0) {
    return [];
  }
  const rows =
    parseTicks(
      demoPath,
      ["team_num", "team_name", "team_clan_name", "clan_name", "health", "name", "user_id", "entity_id"],
      ticks,
    ) ?? [];
  return Array.isArray(rows) ? rows : [];
}

/** CSDM maps DB `players.index` as slot and `userId = slot - 1`. demoparser `user_id` matches that userId. */
function samplePlayerSlots(demoPath, ticks) {
  const rows = sampleSidesAtTicks(demoPath, ticks);
  const bySteam = new Map();
  for (const row of rows) {
    const steamId = rowSteamId(row);
    if (!steamId || row.user_id == null || Number.isNaN(Number(row.user_id))) {
      continue;
    }
    const userId = Number(row.user_id);
    bySteam.set(steamId, {
      user_id: userId,
      // CSDM: slot = userId + 1 (used by `spec_player <slot>`)
      slot: userId + 1,
      entity_id: row.entity_id != null ? Number(row.entity_id) : null,
    });
  }
  return bySteam;
}

function groupTickRowsByTick(rows) {
  const byTick = new Map();
  for (const row of rows) {
    const tick = Number(row.tick);
    if (!byTick.has(tick)) {
      byTick.set(tick, []);
    }
    byTick.get(tick).push(row);
  }
  return byTick;
}

function rowSteamId(row) {
  return (
    normalizeSteamId(typeof row.steamid === "string" ? row.steamid : null) ??
    normalizeSteamId(row.steamid64) ??
    normalizeSteamId(typeof row.steam_id === "string" ? row.steam_id : null)
  );
}

function playersAliveOnSide(rows, side) {
  return rows
    .filter((row) => sideFromTeamNum(row.team_num) === side)
    .map((row) => rowSteamId(row))
    .filter(Boolean);
}

/**
 * Parse a CS2 demo into players + per-player per-round clip windows.
 */
export function parseDemo(demoPath, options = {}) {
  const absolutePath = resolve(demoPath);
  const header = parseHeader(absolutePath) ?? {};
  const playerInfo = parsePlayerInfo(absolutePath) ?? [];
  const events = collectEvents(absolutePath);
  const deaths = events.filter((event) => event.event_name === "player_death");
  const matchStartTick = inferMatchStartTick(events);
  const officialDeaths = deaths.filter((event) => Number(event.tick) >= matchStartTick);
  const rounds = buildOfficialRounds(events, { matchStartTick });
  const tickrate = Number(header.tickrate) > 0 ? Number(header.tickrate) : inferTickrate(rounds);

  const sampleTicks = [...new Set(rounds.map((round) => round.freeze_end_tick))];
  const tickRows = sampleSidesAtTicks(absolutePath, sampleTicks);
  const rowsByTick = groupTickRowsByTick(tickRows);
  const slotsBySteam = samplePlayerSlots(absolutePath, sampleTicks);

  const roster = [];
  const seen = new Set();
  for (const player of playerInfo) {
    const steamId = steamIdFromPlayerInfo(player);
    if (!steamId || seen.has(steamId)) {
      continue;
    }
    seen.add(steamId);
    roster.push({
      steam_id: steamId,
      name: player.name ?? player.player_name ?? "unknown",
    });
  }

  // Tick samples sometimes expose SteamIDs missing from player_info.
  for (const row of tickRows) {
    const steamId = rowSteamId(row);
    if (!steamId || seen.has(steamId)) {
      continue;
    }
    seen.add(steamId);
    roster.push({
      steam_id: steamId,
      name: row.name ?? "unknown",
    });
  }

  const players = roster.map((player) => {
    const stats = countPlayerStats(officialDeaths, player.steam_id);
    const slotInfo = slotsBySteam.get(player.steam_id) ?? {};
    const roundKillCounts = rounds.map((round) =>
      killsInTickWindow(officialDeaths, player.steam_id, round.start_tick, round.end_tick),
    );
    const hltvRating = computeHltvRating1({
      kills: stats.kills,
      deaths: stats.deaths,
      rounds: rounds.length,
      roundKillCounts,
    });
    return {
      ...player,
      user_id: slotInfo.user_id ?? null,
      slot: slotInfo.slot ?? null,
      entity_id: slotInfo.entity_id ?? null,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      hltv_rating: hltvRating,
    };
  });

  const playerRounds = [];
  const skipped = [];

  for (const player of players) {
    for (const round of rounds) {
      const sampleRows = rowsByTick.get(round.freeze_end_tick) ?? rowsByTick.get(round.start_tick) ?? [];
      const selfRow = sampleRows.find((row) => rowSteamId(row) === player.steam_id);
      const side = selfRow ? sideFromTeamNum(selfRow.team_num) : null;
      if (!side) {
        skipped.push({
          steam_id: player.steam_id,
          name: player.name,
          round_number: round.round_number,
          reason: selfRow
            ? `player not on T/CT (team_num=${selfRow.team_num})`
            : "player absent from tick sample (backup / disconnect)",
        });
        continue;
      }

      const teamSteamIds = playersAliveOnSide(sampleRows, side);
      const deathTick = firstDeathTick(officialDeaths, player.steam_id, round.start_tick, round.end_tick);
      const clipEndTick = deathTick ?? round.end_tick;
      const estimatedSeconds =
        tickrate > 0 ? Number(((clipEndTick - round.start_tick) / tickrate).toFixed(2)) : null;
      const survived = deathTick === null;
      const highlight = analyzeRoundHighlight({
        deaths: officialDeaths,
        steamId: player.steam_id,
        startTick: round.start_tick,
        endTick: round.end_tick,
        teamSteamIds,
        survived,
        playerSide: side,
        winner: round.winner,
      });
      const chapterLabel = formatRoundChapterLabel(round.round_number, highlight);

      playerRounds.push({
        steam_id: player.steam_id,
        player_name: player.name,
        round_number: round.round_number,
        round_start_tick: round.start_tick,
        freeze_end_tick: round.freeze_end_tick,
        player_death_tick: deathTick,
        round_end_tick: round.end_tick,
        clip_end_tick: clipEndTick,
        player_side: side,
        team_steam_ids: teamSteamIds,
        survived,
        winner: round.winner,
        estimated_clip_seconds: estimatedSeconds,
        kills_in_round: highlight.kills,
        highlight_weapon: highlight.weapon,
        clutch: highlight.clutch,
        chapter_label: chapterLabel,
      });
    }
  }

  const selectedSteamId = options.steamId ? normalizeSteamId(options.steamId) : null;
  const filteredRounds = selectedSteamId
    ? playerRounds.filter((row) => row.steam_id === selectedSteamId)
    : playerRounds;
  const filteredSkipped = selectedSteamId
    ? skipped.filter((row) => row.steam_id === selectedSteamId)
    : skipped;

  if (selectedSteamId && !players.some((player) => player.steam_id === selectedSteamId)) {
    throw new Error(`Player ${selectedSteamId} not found in demo roster`);
  }

  const serverName = header.server_name ?? header.servername ?? null;
  const matchKind = detectMatchKind(serverName, absolutePath);
  const teamT = dominantClanForSide(tickRows, 2);
  const teamCt = dominantClanForSide(tickRows, 3);
  const eventName = matchKind === "tournament" ? inferEventName(absolutePath, serverName) : null;

  // Prefer first official round side of selected player for "A vs B" order.
  let playerSide = null;
  if (selectedSteamId) {
    const firstRound = filteredRounds[0];
    playerSide = firstRound?.player_side ?? null;
  }

  return {
    demo_path: absolutePath,
    map: header.map_name ?? header.mapname ?? null,
    tickrate,
    server_name: serverName,
    match_kind: matchKind,
    event_name: eventName,
    team_ct: teamCt,
    team_t: teamT,
    matchup: matchKind === "tournament" ? formatMatchup({ teamCt, teamT, playerSide }) : null,
    match_start_tick: matchStartTick,
    players: selectedSteamId ? players.filter((player) => player.steam_id === selectedSteamId) : players,
    rounds: rounds.map((round) => ({
      round_number: round.round_number,
      round_start_tick: round.start_tick,
      freeze_end_tick: round.freeze_end_tick,
      round_end_tick: round.end_tick,
      official_end_tick: round.official_end_tick,
      winner: round.winner,
    })),
    player_rounds: filteredRounds,
    skipped_rounds: filteredSkipped,
  };
}
