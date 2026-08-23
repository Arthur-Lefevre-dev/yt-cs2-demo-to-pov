/**
 * Match source / tournament metadata helpers (pure, testable).
 */

/** Known pro events — must win over the word "Premier" inside "BLAST.tv Premier …". */
const TOURNAMENT_MARKERS = [
  /\bblast\.?\s*tv\b/i,
  /\bblast\b/i,
  /\biem\b/i,
  /\besl\b/i,
  /\bpgl\b/i,
  /\bdreamhack\b/i,
  /\bcct\b/i,
  /\brmr\b/i,
  /\bmajor\b/i,
  /\bkatowice\b/i,
  /\bcologne\b/i,
  /\bhltv\b/i,
  /\bgotv\b/i,
];

/**
 * @param {string | null | undefined} serverName
 * @param {string | null | undefined} demoPath
 * @returns {"faceit" | "premier" | "tournament"}
 */
export function detectMatchKind(serverName, demoPath = "") {
  const haystack = `${serverName ?? ""} ${demoPath ?? ""}`.toLowerCase();
  if (/\bfaceit\b/.test(haystack)) {
    return "faceit";
  }
  // Pro broadcast / event servers first (e.g. "BLAST.tv Premier CS2 Server").
  if (TOURNAMENT_MARKERS.some((re) => re.test(haystack))) {
    return "tournament";
  }
  // Valve Premier / CS Rating queue — avoid bare "premier" when paired with event brands above.
  if (
    /\bcs2\s+premier\b/.test(haystack) ||
    /\bvalve\s+premier\b/.test(haystack) ||
    /\bpremier\s+(match|queue|mode|mm)\b/.test(haystack) ||
    (/\bpremier\b/.test(haystack) && !/\bserver\b/.test(haystack))
  ) {
    return "premier";
  }
  if (/\bvalve\b/.test(haystack) && /\bmatchmaking\b|\bcompetitive\b/.test(haystack)) {
    return "premier";
  }
  return "tournament";
}

/**
 * Clean clan / team labels from demos (FACEIT "team_Foo", pro "Vitality").
 * @param {string | null | undefined} raw
 */
export function cleanTeamName(raw) {
  if (!raw) {
    return null;
  }
  let name = String(raw).trim();
  if (!name) {
    return null;
  }
  // FACEIT-style lobby clans: team_PlayerName / Team_Something
  name = name.replace(/^team[_:\-\s]+/i, "").trim();
  if (!name || /^(ct|t|counter-?terrorists?|terrorists?)$/i.test(name)) {
    return null;
  }
  return name;
}

/**
 * Pick the most common non-empty clan label from tick rows for one side.
 * @param {Array<{ team_num?: number, clan_name?: string, team_clan_name?: string }>} rows
 * @param {2 | 3} teamNum
 */
export function dominantClanForSide(rows, teamNum) {
  const counts = new Map();
  for (const row of rows) {
    if (Number(row.team_num) !== teamNum) {
      continue;
    }
    const cleaned = cleanTeamName(row.clan_name) ?? cleanTeamName(row.team_clan_name);
    if (!cleaned) {
      continue;
    }
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
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
 * Guess event label from demo filename / path / server name (BLAST, IEM, ESL, …).
 * @param {string | null | undefined} demoPath
 * @param {string | null | undefined} [serverName]
 */
export function inferEventName(demoPath, serverName = null) {
  const haystacks = [];
  if (demoPath) {
    const base = String(demoPath)
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .replace(/\.dem$/i, "");
    haystacks.push(base, String(demoPath));
  }
  if (serverName) {
    haystacks.push(String(serverName));
  }
  if (haystacks.length === 0) {
    return null;
  }

  const patterns = [
    { re: /\bblast\.?\s*tv\b/i, label: "BLAST.tv" },
    { re: /\bblast\b/i, label: "BLAST.tv" },
    {
      re: /\biem[\s_\-]*([a-z0-9]+(?:[\s_\-]+[a-z0-9]+)?)/i,
      label: (m) => `IEM ${capitalizeWords(m[1])}`,
    },
    {
      re: /\besl[\s_\-]*(pro[\s_\-]*league|cologne|katowice)?/i,
      label: (m) => (m[1] ? `ESL ${capitalizeWords(m[1])}` : "ESL"),
    },
    { re: /\bkatowice\b/i, label: "IEM Katowice" },
    { re: /\bcologne\b/i, label: "ESL Cologne" },
    { re: /\bmajors?\b/i, label: "Major" },
    { re: /\bpgl\b/i, label: "PGL" },
    { re: /\bdreamhack\b|\bdh[\s_\-]*masters\b/i, label: "DreamHack" },
    { re: /\bcct\b/i, label: "CCT" },
    { re: /\brmr\b/i, label: "RMR" },
  ];

  for (const hay of haystacks) {
    for (const { re, label } of patterns) {
      const match = hay.match(re);
      if (!match) {
        continue;
      }
      return typeof label === "function" ? label(match) : label;
    }
  }

  return null;
}

function capitalizeWords(value) {
  return String(value)
    .trim()
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Build "TeamA vs TeamB" with player's team first when possible.
 * @param {{ teamCt?: string | null, teamT?: string | null, playerSide?: string | null }} input
 */
export function formatMatchup({ teamCt, teamT, playerSide }) {
  const ct = cleanTeamName(teamCt);
  const t = cleanTeamName(teamT);
  if (!ct && !t) {
    return null;
  }
  if (ct && !t) {
    return ct;
  }
  if (t && !ct) {
    return t;
  }
  if (playerSide === "CT") {
    return `${ct} vs ${t}`;
  }
  if (playerSide === "T") {
    return `${t} vs ${ct}`;
  }
  return `${ct} vs ${t}`;
}
