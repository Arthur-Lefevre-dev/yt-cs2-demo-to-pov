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
 * Drops knife rounds (FACEIT side pick) when death weapons are all knives.
 *
 * @param {object[]} events
 * @param {{ matchStartTick?: number, minGap?: number, deaths?: object[] }} [options]
 */
export function buildOfficialRounds(events, options = {}) {
  const minGap = options.minGap ?? 64;
  const matchStartTick = options.matchStartTick ?? inferMatchStartTick(events);
  const deaths = options.deaths ?? events.filter((event) => event.event_name === "player_death");
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

  /** @type {object[]} */
  const rounds = [];
  for (let index = 0; index < starts.length; index += 1) {
    const startTick = starts[index];
    const nextStart = starts[index + 1] ?? Number.POSITIVE_INFINITY;
    const freezeEndTick = freezeEnds.find((tick) => tick > startTick && tick < nextStart) ?? startTick;
    const endTick = ends.find((tick) => tick > startTick && tick < nextStart);
    if (endTick === undefined) {
      continue;
    }
    // Skip FACEIT knife round (side pick) even if it somehow starts after begin_new_match.
    if (isKnifeRound(deaths, startTick, endTick)) {
      continue;
    }
    const officialEndTick =
      officialEnds.find((tick) => tick >= endTick && tick < (starts[index + 1] ?? Number.POSITIVE_INFINITY) + minGap) ??
      endTick;
    const endEvent = endEvents.find((event) => eventTick(event) === endTick);
    rounds.push({
      round_number: rounds.length + 1,
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

/**
 * @param {string | null | undefined} weapon
 */
export function isKnifeWeapon(weapon) {
  if (!weapon) {
    return false;
  }
  const raw = String(weapon).toLowerCase().replace(/^weapon_/, "");
  return raw === "knife" || raw.startsWith("knife_") || raw === "bayonet";
}

/**
 * True when every death in the window is a knife kill (FACEIT knife round).
 * Empty window → not considered knife (avoid dropping odd empty rounds).
 *
 * @param {object[]} deaths
 * @param {number} startTick
 * @param {number} endTick
 */
export function isKnifeRound(deaths, startTick, endTick) {
  const inRound = (deaths || []).filter((death) => {
    const tick = eventTick(death);
    return Number.isFinite(tick) && tick >= startTick && tick <= endTick;
  });
  if (inRound.length === 0) {
    return false;
  }
  return inRound.every((death) => isKnifeWeapon(death.weapon));
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

/**
 * Kills by a player inside a tick window (excludes team kills / suicide).
 */
export function killsInTickWindow(deaths, steamId, startTick, endTick) {
  let kills = 0;
  for (const death of deaths) {
    const tick = eventTick(death);
    if (tick < startTick || tick > endTick) {
      continue;
    }
    const attacker = normalizeSteamId(death.attacker_steamid);
    const victim = normalizeSteamId(death.user_steamid ?? death.victim_steamid ?? death.steamid);
    if (attacker === steamId && victim !== steamId) {
      kills += 1;
    }
  }
  return kills;
}

/**
 * HLTV Rating 1.0 (public formula from HLTV.org).
 * @param {{ kills: number, deaths: number, rounds: number, roundKillCounts?: number[] }} input
 */
export function computeHltvRating1(input) {
  const rounds = Math.max(0, Number(input.rounds) || 0);
  if (rounds <= 0) {
    return 0;
  }
  const kills = Math.max(0, Number(input.kills) || 0);
  const deaths = Math.max(0, Number(input.deaths) || 0);
  const counts =
    Array.isArray(input.roundKillCounts) && input.roundKillCounts.length === rounds
      ? input.roundKillCounts
      : distributeKillsAcrossRounds(kills, rounds);

  const kpr = kills / rounds;
  const spr = Math.max(0, (rounds - Math.min(deaths, rounds)) / rounds);
  let mkSum = 0;
  for (const k of counts) {
    if (k > 0) {
      mkSum += k * k;
    }
  }
  const killRating = kpr / 0.679;
  const survivalRating = spr / 0.317;
  const multiKillRating = mkSum / rounds / 1.277;
  const rating = (killRating + 0.7 * survivalRating + multiKillRating) / 2.7;
  return Math.round(rating * 100) / 100;
}

/**
 * Spread kills evenly across rounds (fallback when per-round kills unknown).
 */
export function distributeKillsAcrossRounds(kills, rounds) {
  const counts = Array.from({ length: rounds }, () => 0);
  if (rounds <= 0 || kills <= 0) {
    return counts;
  }
  for (let i = 0; i < kills; i++) {
    counts[i % rounds] += 1;
  }
  return counts;
}
