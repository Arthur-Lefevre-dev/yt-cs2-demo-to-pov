/**
 * Persist tracked FACEIT/Steam players (photo + team logo paths).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * @typedef {object} TrackedPlayer
 * @property {string} id
 * @property {string} steam_id
 * @property {string} [faceit_player_id]
 * @property {string} [nickname]
 * @property {string} [display_name]
 * @property {string | null} [photo_path]
 * @property {string | null} [team_logo_path]
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @param {string} storePath
 * @returns {Promise<{ players: TrackedPlayer[] }>}
 */
export async function loadTrackedPlayers(storePath) {
  const path = resolve(storePath);
  if (!existsSync(path)) {
    return { players: [] };
  }
  const raw = JSON.parse(await readFile(path, "utf8"));
  return { players: Array.isArray(raw.players) ? raw.players : [] };
}

/**
 * @param {string} storePath
 * @param {{ players: TrackedPlayer[] }} data
 */
export async function saveTrackedPlayers(storePath, data) {
  const path = resolve(storePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ players: data.players }, null, 2)}\n`, "utf8");
}

/**
 * @param {string} storePath
 * @param {Omit<TrackedPlayer, "id" | "created_at" | "updated_at"> & { id?: string }} input
 */
export async function upsertTrackedPlayer(storePath, input) {
  const steamId = String(input.steam_id || "").trim();
  if (!/^\d{15,20}$/.test(steamId)) {
    throw new Error("steam_id must be a SteamID64");
  }
  const store = await loadTrackedPlayers(storePath);
  const now = new Date().toISOString();
  const existing = store.players.find(
    (row) => row.steam_id === steamId || (input.id && row.id === input.id),
  );
  if (existing) {
    existing.faceit_player_id = input.faceit_player_id ?? existing.faceit_player_id;
    existing.nickname = input.nickname ?? existing.nickname;
    existing.display_name = input.display_name ?? existing.display_name;
    existing.photo_path = input.photo_path !== undefined ? input.photo_path : existing.photo_path;
    existing.team_logo_path =
      input.team_logo_path !== undefined ? input.team_logo_path : existing.team_logo_path;
    existing.updated_at = now;
    await saveTrackedPlayers(storePath, store);
    return existing;
  }
  /** @type {TrackedPlayer} */
  const created = {
    id: input.id || randomUUID(),
    steam_id: steamId,
    faceit_player_id: input.faceit_player_id || undefined,
    nickname: input.nickname || undefined,
    display_name: input.display_name || input.nickname || steamId,
    photo_path: input.photo_path ?? null,
    team_logo_path: input.team_logo_path ?? null,
    created_at: now,
    updated_at: now,
  };
  store.players.push(created);
  await saveTrackedPlayers(storePath, store);
  return created;
}

/**
 * @param {string} storePath
 * @param {string} id
 */
export async function removeTrackedPlayer(storePath, id) {
  const store = await loadTrackedPlayers(storePath);
  const next = store.players.filter((row) => row.id !== id && row.steam_id !== id);
  await saveTrackedPlayers(storePath, { players: next });
  return { removed: store.players.length - next.length };
}
