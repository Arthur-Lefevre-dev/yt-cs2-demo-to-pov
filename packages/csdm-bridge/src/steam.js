/**
 * Detect / launch Steam — required by CS Demo Manager before `csdm video`.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Common Steam install roots on Windows.
 * @returns {string[]}
 */
export function steamExeCandidates() {
  const roots = [
    process.env.STEAM_PATH,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Steam")
      : null,
    process.env["ProgramFiles(x86)"]
      ? join(process.env["ProgramFiles(x86)"], "Steam")
      : null,
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    "D:\\Steam",
    "E:\\Steam",
  ].filter(Boolean);

  return roots.map((root) => join(String(root), "steam.exe"));
}

/**
 * @returns {string | null}
 */
export function findSteamExe() {
  for (const candidate of steamExeCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * @returns {Promise<boolean>}
 */
export async function isSteamRunning() {
  if (process.platform !== "win32") {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-x", "steam"], {
        windowsHide: true,
      });
      return Boolean(String(stdout).trim());
    } catch {
      return false;
    }
  }

  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", "IMAGENAME eq steam.exe", "/NH"],
      { windowsHide: true },
    );
    return /steam\.exe/i.test(String(stdout));
  } catch {
    return false;
  }
}

/**
 * Start Steam (detached). Does not wait for login.
 * @returns {Promise<boolean>} true if a launch was attempted
 */
export async function launchSteam() {
  const exe = findSteamExe();
  if (exe) {
    const child = spawn(exe, ["-silent"], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return true;
  }

  if (process.platform === "win32") {
    // Protocol fallback when steam.exe path is unknown.
    spawn("cmd.exe", ["/c", "start", "", "steam://open/main"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return true;
  }

  return false;
}

/**
 * Ensure Steam is running before HLAE / CS2 recording.
 * Tries to launch it and waits briefly for the process to appear.
 *
 * @param {{
 *   waitMs?: number,
 *   pollMs?: number,
 *   onLog?: (line: string) => void,
 * }} [options]
 * @returns {Promise<void>}
 */
export async function ensureSteamRunning(options = {}) {
  const waitMs = options.waitMs ?? 90_000;
  const pollMs = options.pollMs ?? 2_000;
  const onLog = options.onLog ?? ((line) => process.stderr.write(line));

  if (await isSteamRunning()) {
    onLog("Steam is running.\n");
    return;
  }

  onLog("Steam is not running — launching Steam…\n");
  const launched = await launchSteam();
  if (!launched) {
    throw new Error(
      "Steam is not running and steam.exe was not found. " +
        "Install / start Steam, then retry recording.",
    );
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (await isSteamRunning()) {
      onLog("Steam process detected. Waiting a few seconds for it to finish starting…\n");
      // Give Steam time to initialize before CS2 launch.
      await new Promise((r) => setTimeout(r, 5_000));
      return;
    }
  }

  throw new Error(
    "Steam did not start in time (csdm video requires Steam). " +
      "Open Steam manually, wait until it is fully logged in, then retry.",
  );
}
