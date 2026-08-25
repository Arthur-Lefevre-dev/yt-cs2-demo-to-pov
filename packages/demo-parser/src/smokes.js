/**
 * Detect smoke grenade throws and map them to chapter ticks
 * (3 seconds before the throw by default).
 */

import { parseEvent } from "@laihoe/demoparser2";
import { eventTick, normalizeSteamId } from "./rounds.js";

const SMOKE_LEAD_SECONDS = 3;

function asList(parsed, fallbackName) {
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

function eventSteamId(event) {
  return (
    normalizeSteamId(event.user_steamid) ??
    normalizeSteamId(event.attacker_steamid) ??
    normalizeSteamId(event.steamid) ??
    normalizeSteamId(event.steam_id) ??
    normalizeSteamId(event.thrower_steamid)
  );
}

function isSmokeWeapon(weapon) {
  if (!weapon) {
    return false;
  }
  const raw = String(weapon).toLowerCase().replace(/^weapon_/, "");
  return raw === "smokegrenade" || raw === "smoke" || raw.includes("smoke");
}

/**
 * Collect all smoke throws in the demo (any player).
 * Prefers `weapon_fire`; falls back to `smokegrenade_detonate`.
 * @param {string} demoPath
 * @param {number} tickrate
 * @returns {Array<{ steam_id: string, throw_tick: number, source: string }>}
 */
export function collectAllSmokeThrows(demoPath, tickrate = 64) {
  const rate = Math.max(1, Math.round(Number(tickrate) || 64));
  /** @type {Map<string, { steam_id: string, throw_tick: number, source: string }>} */
  const byKey = new Map();

  try {
    const fires = asList(parseEvent(demoPath, "weapon_fire"), "weapon_fire");
    for (const event of fires) {
      const sid = eventSteamId(event);
      if (!sid || !isSmokeWeapon(event.weapon)) {
        continue;
      }
      const tick = eventTick(event);
      if (!Number.isFinite(tick)) {
        continue;
      }
      byKey.set(`${sid}:${tick}`, { steam_id: sid, throw_tick: tick, source: "weapon_fire" });
    }
  } catch {
    // Event absent.
  }

  if (byKey.size === 0) {
    try {
      const detonates = asList(parseEvent(demoPath, "smokegrenade_detonate"), "smokegrenade_detonate");
      const flightTicks = Math.round(1.5 * rate);
      for (const event of detonates) {
        const sid = eventSteamId(event);
        if (!sid) {
          continue;
        }
        const detonateTick = eventTick(event);
        if (!Number.isFinite(detonateTick)) {
          continue;
        }
        const throwTick = Math.max(0, detonateTick - flightTicks);
        byKey.set(`${sid}:${throwTick}`, {
          steam_id: sid,
          throw_tick: throwTick,
          source: "smokegrenade_detonate",
        });
      }
    } catch {
      // Event absent.
    }
  }

  return [...byKey.values()].sort((a, b) => a.throw_tick - b.throw_tick);
}

/**
 * Attach smoke throws to official rounds and compute chapter ticks (lead before throw).
 * @param {Array<{ steam_id: string, throw_tick: number, source: string }>} throws
 * @param {Array<{ round_number: number, start_tick: number, end_tick: number }>} rounds
 * @param {number} tickrate
 * @param {number} [leadSeconds=3]
 * @param {string | null} [steamIdFilter]
 */
export function mapSmokesToRounds(
  throws,
  rounds,
  tickrate,
  leadSeconds = SMOKE_LEAD_SECONDS,
  steamIdFilter = null,
) {
  const rate = Math.max(1, Math.round(Number(tickrate) || 64));
  const leadTicks = Math.round(Math.max(0, leadSeconds) * rate);
  const filter = steamIdFilter ? normalizeSteamId(steamIdFilter) : null;
  /** @type {Array<object>} */
  const out = [];
  const indexByPlayer = new Map();

  for (const smoke of throws) {
    if (filter && smoke.steam_id !== filter) {
      continue;
    }
    const round = rounds.find(
      (entry) => smoke.throw_tick >= entry.start_tick && smoke.throw_tick <= entry.end_tick,
    );
    if (!round) {
      continue;
    }
    const next = (indexByPlayer.get(smoke.steam_id) ?? 0) + 1;
    indexByPlayer.set(smoke.steam_id, next);
    const chapterTick = Math.max(round.start_tick, smoke.throw_tick - leadTicks);
    out.push({
      steam_id: smoke.steam_id,
      round_number: round.round_number,
      throw_tick: smoke.throw_tick,
      chapter_tick: chapterTick,
      lead_seconds: leadSeconds,
      source: smoke.source,
      label: `Smoke R${round.round_number}`,
      index: next,
    });
  }
  return out;
}

export { SMOKE_LEAD_SECONDS };
