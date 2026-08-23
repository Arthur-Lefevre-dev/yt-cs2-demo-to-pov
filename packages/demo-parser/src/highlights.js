/**
 * YouTube chapter labels from per-round POV highlights.
 */

import { eventTick, firstDeathTick, normalizeSteamId } from "./rounds.js";

const WEAPON_SHORT = {
  ak47: "AK",
  m4a1: "M4A4",
  m4a1_silencer: "M4A1-S",
  awp: "AWP",
  ssg08: "Scout",
  aug: "AUG",
  sg556: "SG553",
  famas: "FAMAS",
  galilar: "Galil",
  deagle: "Deagle",
  revolver: "R8",
  usp_silencer: "USP",
  glock: "Glock",
  hkp2000: "P2000",
  elite: "Dualies",
  p250: "P250",
  fiveseven: "Five-SeveN",
  tec9: "Tec-9",
  cz75a: "CZ75",
  mp9: "MP9",
  mac10: "MAC-10",
  mp7: "MP7",
  mp5sd: "MP5",
  ump45: "UMP",
  p90: "P90",
  bizon: "Bizon",
  nova: "Nova",
  xm1014: "XM1014",
  mag7: "MAG-7",
  sawedoff: "Sawed-Off",
  m249: "M249",
  negev: "Negev",
  hegrenade: "HE",
  flashbang: "Flash",
  smokegrenade: "Smoke",
  molotov: "Molly",
  inferno: "Molly",
  incgrenade: "Incendiary",
  taser: "Zeus",
};

/**
 * @param {string | null | undefined} weapon
 */
export function shortWeaponName(weapon) {
  if (!weapon) {
    return null;
  }
  const raw = String(weapon).toLowerCase().replace(/^weapon_/, "");
  if (WEAPON_SHORT[raw]) {
    return WEAPON_SHORT[raw];
  }
  if (raw.startsWith("knife")) {
    return "Knife";
  }
  return raw
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

/**
 * Dominant weapon among a list of kill weapon ids.
 * @param {string[]} weapons
 */
export function dominantWeapon(weapons) {
  const counts = new Map();
  for (const weapon of weapons) {
    const short = shortWeaponName(weapon);
    if (!short) {
      continue;
    }
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Analyze one player's round for chapter highlight text.
 * @param {object} input
 */
export function analyzeRoundHighlight(input) {
  const {
    deaths = [],
    steamId,
    startTick,
    endTick,
    teamSteamIds = [],
    survived = false,
    playerSide = null,
    winner = null,
  } = input;

  const sid = normalizeSteamId(steamId);
  const killEvents = deaths
    .filter((death) => {
      const tick = eventTick(death);
      if (!Number.isFinite(tick) || tick < startTick || tick > endTick) {
        return false;
      }
      const attacker = normalizeSteamId(death.attacker_steamid);
      const victim = normalizeSteamId(death.user_steamid ?? death.victim_steamid ?? death.steamid);
      return attacker === sid && victim && victim !== sid;
    })
    .sort((a, b) => eventTick(a) - eventTick(b));

  const kills = killEvents.length;
  const weapons = killEvents.map((death) => death.weapon).filter(Boolean);
  const weapon = dominantWeapon(weapons);
  const won = Boolean(winner && playerSide && String(winner) === String(playerSide));

  const teammates = (teamSteamIds || [])
    .map((id) => normalizeSteamId(id))
    .filter((id) => id && id !== sid);
  let clutch = false;
  if (survived && won && kills >= 1 && teammates.length > 0) {
    const firstKillTick = eventTick(killEvents[0]);
    clutch = teammates.every((mate) => {
      const mateDeathTick = firstDeathTick(deaths, mate, startTick, endTick);
      return mateDeathTick != null && mateDeathTick < firstKillTick;
    });
  }

  return {
    kills,
    weapon,
    weapons,
    clutch,
    ace: kills >= 5,
    won,
  };
}

/**
 * Build "Round N …" label. Plain "Round N" when nothing notable.
 * @param {number} roundNumber
 * @param {ReturnType<typeof analyzeRoundHighlight> | null | undefined} highlight
 */
export function formatRoundChapterLabel(roundNumber, highlight) {
  const base = `Round ${roundNumber}`;
  if (!highlight || !highlight.kills) {
    return base;
  }

  const { kills, weapon, clutch, ace } = highlight;
  const parts = [];

  if (ace) {
    parts.push("Ace");
    if (weapon) {
      parts.push(weapon);
    }
  } else if (clutch) {
    parts.push("Clutch");
    if (kills >= 3) {
      parts.push(`${kills}K`);
      if (weapon) {
        parts.push(weapon);
      }
    }
  } else if (kills >= 3) {
    parts.push(`${kills}K`);
    if (weapon) {
      parts.push(weapon);
    }
  } else if (
    kills === 2 &&
    weapon &&
    ["USP", "Deagle", "Glock", "P250", "Five-SeveN", "Tec-9", "CZ75", "AWP", "Scout"].includes(
      weapon,
    )
  ) {
    parts.push("2K");
    parts.push(weapon);
  }

  if (parts.length === 0) {
    return base;
  }

  return `${base} ${parts.join(" ")}`;
}
