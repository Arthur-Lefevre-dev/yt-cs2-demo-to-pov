/**
 * @typedef {object} BridgePlayer
 * @property {string} steam_id
 * @property {string} name
 */

/**
 * @typedef {object} BridgePlayerRound
 * @property {string} steam_id
 * @property {string} player_name
 * @property {number} round_number
 * @property {number} round_start_tick
 * @property {number} freeze_end_tick
 * @property {number|null} player_death_tick
 * @property {number} round_end_tick
 * @property {number} clip_end_tick
 * @property {string} player_side
 * @property {string[]} team_steam_ids
 * @property {boolean} survived
 */

/**
 * @typedef {object} ParseLike
 * @property {string} demo_path
 * @property {string|null} [map]
 * @property {number|null} [tickrate]
 * @property {BridgePlayer[]} players
 * @property {BridgePlayerRound[]} player_rounds
 */

/**
 * @typedef {object} BuildOptions
 * @property {string} steamId
 * @property {string} outputFolderPath
 * @property {number[]} [rounds] round numbers to include (default: all for player)
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [framerate]
 * @property {boolean} [showXRay]
 * @property {boolean} [closeGameAfterRecording]
 * @property {string} [outputFileName]
 * @property {number} [endPaddingTicks] extra ticks after clip_end (default 0)
 * @property {boolean} [voicePlanB] inject bitmask cfg (needs userIds — unused in MVP)
 */

export {};
