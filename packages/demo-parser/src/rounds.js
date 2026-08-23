/**
 * Pure helpers that turn raw demo events into official-round boundaries.
 * Kept side-effect free so unit tests do not need a .dem file.
 */

const TEAM_T = 2;
const TEAM_CT = 3;

export function normalizeSteamId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    // SteamID64 exceeds Number.MAX_SAFE_INTEGER. Prefer an already-string field.
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  return String(value);
}

export function sideFromTeamNum(teamNum) {
  if (teamNum === TEAM_T || teamNum === "T" || teamNum === "t") {
    return "T";
  }
  if (teamNum === TEAM_CT || teamNum === "CT" || teamNum === "ct") {
    return "CT";
  }
  return null;
}

export function eventTick(event) {
  const tick = event?.tick ?? event?.Tick;
  return typeof tick === "number" ? tick : Number(tick);
}

export function dedupeAscendingTicks(ticks, minGap = 64) {
  const sorted = [...new Set(ticks.filter((tick) => Number.isFinite(tick)))].sort((a, b) => a - b);
  const unique = [];
  for (const tick of sorted) {
    if (unique.length === 0 || tick - unique[unique.length - 1] >= minGap) {
      unique.push(tick);
    }
  }
  return unique;
}

export function inferMatchStartTick(events) {
  const beginMatch = events.filter((event) => event.event_name === "begin_new_match");
  if (beginMatch.length > 0) {
    return eventTick(beginMatch[beginMatch.length - 1]);
  }
  const announce = events.filter((event) => event.event_name === "round_announce_match_start");
  if (announce.length > 0) {
    return eventTick(announce[announce.length - 1]);
  }
  return 0;
}

/**
 * FACEIT/GOTV often fire begin_new_match a few ticks AFTER the first official
 * round_start. Keep that in-progress round so we do not drop pistol round 1.
 */
export function firstOfficialRoundStart(startTicks, matchStartTick, endTicks = []) {
  const lastStartBeforeMatch = [...startTicks].reverse().find((tick) => tick < matchStartTick);
  if (lastStartBeforeMatch === undefined) {
    return matchStartTick;
  }
  const endedBeforeMatch = endTicks.some((tick) => tick > lastStartBeforeMatch && tick < matchStartTick);
  return endedBeforeMatch ? matchStartTick : lastStartBeforeMatch;
}

export function inferTickrate(rounds) {
  const freezeGaps = rounds
    .map((round) => round.freeze_end_tick - round.start_tick)
    .filter((gap) => gap >= 800 && gap <= 1100);
  if (freezeGaps.length === 0) {
    return 64;
  }
  const typical = freezeGaps.sort((a, b) => a - b)[Math.floor(freezeGaps.length / 2)];
  return Math.round(typical / 15);
}

/**
 * Pair round_start / freeze_end / round_end / round_officially_ended after match start.
 */
export function buildOfficialRounds(events, options = {}) {
  const minGap = options.minGap ?? 64;
  const matchStartTick = options.matchStartTick ?? inferMatchStartTick(events);
  const allStarts = dedupeAscendingTicks(
    events.filter((event) => event.event_name === "round_start").map(eventTick),
    minGap,
  );
  const allEnds = events.filter((event) => event.event_name === "round_end").map(eventTick);
  const windowStart = firstOfficialRoundStart(allStarts, matchStartTick, allEnds);

  const starts = allStarts.filter((tick) => tick >= windowStart);
  const freezeEnds = events
    .filter((event) => event.event_name === "round_freeze_end")
    .map(eventTick)
    .filter((tick) => tick >= windowStart)
    .sort((a, b) => a - b);
  const ends = events
    .filter((event) => event.event_name === "round_end")
    .map(eventTick)
    .filter((tick) => tick >= windowStart)
    .sort((a, b) => a - b);
  const officialEnds = events
    .filter((event) => event.event_name === "round_officially_ended")
    .map(eventTick)
    .filter((tick) => tick >= windowStart)
    .sort((a, b) => a - b);

  const endEvents = events
    .filter((event) => event.event_name === "round_end")
    .filter((event) => eventTick(event) >= windowStart);

  const rounds = [];
  for (let index = 0; index < starts.length; index += 1) {
    const startTick = starts[index];
    const nextStart = starts[index + 1] ?? Number.POSITIVE_INFINITY;
    const freezeEndTick = freezeEnds.find((tick) => tick > startTick && tick < nextStart) ?? startTick;
    const endTick = ends.find((tick) => tick > startTick && tick < nextStart);
    if (endTick === undefined) {
      continue;
    }
    const officialEndTick =
      officialEnds.find((tick) => tick >= endTick && tick < (starts[index + 1] ?? Number.POSITIVE_INFINITY) + minGap) ??
      endTick;
    const endEvent = endEvents.find((event) => eventTick(event) === endTick);
    rounds.push({
      round_number: index + 1,
      start_tick: startTick,
      freeze_end_tick: freezeEndTick,
      end_tick: endTick,
      official_end_tick: officialEndTick,
      winner: winnerFromRoundEnd(endEvent),
      end_reason: endEvent?.reason ?? endEvent?.winner_reason ?? null,
    });
  }
  return rounds;
}

export function winnerFromRoundEnd(event) {
  if (!event) {
    return null;
  }
  const raw = event.winner ?? event.winner_team ?? event.team;
  if (raw === 2 || raw === "2" || raw === "T" || raw === "t" || raw === "Terrorist" || raw === "terrorists") {
    return "T";
  }
  if (raw === 3 || raw === "3" || raw === "CT" || raw === "ct" || raw === "CTWin" || raw === "counterterrorists") {
    return "CT";
  }
  return raw == null ? null : String(raw);
}

export function firstDeathTick(deaths, steamId, startTick, endTick) {
  const match = deaths
    .filter((death) => {
      const victim = normalizeSteamId(death.user_steamid ?? death.victim_steamid ?? death.steamid);
      const tick = eventTick(death);
      return victim === steamId && tick >= startTick && tick <= endTick;
    })
    .sort((a, b) => eventTick(a) - eventTick(b));
  return match.length > 0 ? eventTick(match[0]) : null;
}

export function countPlayerStats(deaths, steamId) {
  let kills = 0;
  let deathsCount = 0;
  let assists = 0;
  for (const death of deaths) {
    const attacker = normalizeSteamId(death.attacker_steamid);
    const victim = normalizeSteamId(death.user_steamid ?? death.victim_steamid ?? death.steamid);
    const assister = normalizeSteamId(death.assister_steamid);
    if (attacker === steamId && victim !== steamId) {
      kills += 1;
    }
    if (victim === steamId) {
      deathsCount += 1;
    }
    if (assister === steamId) {
      assists += 1;
    }
  }
  return { kills, deaths: deathsCount, assists };
}
