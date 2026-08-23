import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Quote one argument for cmd.exe `/c "batch.cmd" ...` (paths with spaces).
 * @param {unknown} value
 */
export function quoteWindowsCmdArg(value) {
  const s = String(value);
  if (!/[\s"]/u.test(s)) {
    return s;
  }
  return `"${s.replace(/(\\*)"/g, '$1$1\\"')}"`;
}

function candidateCsdmPaths() {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return [
    process.env.CSDM_PATH,
    join(local, "Programs", "cs-demo-manager", "csdm.cmd"),
    join(local, "Programs", "CS Demo Manager", "csdm.cmd"),
    join(local, "Programs", "cs-demo-manager", "csdm.exe"),
    join(local, "Programs", "CS Demo Manager", "csdm.exe"),
    "csdm.cmd",
    "csdm.exe",
    "csdm",
  ].filter(Boolean);
}

export function resolveCsdmExecutable() {
  for (const candidate of candidateCsdmPaths()) {
    if (
      candidate === "csdm" ||
      candidate === "csdm.exe" ||
      candidate === "csdm.cmd"
    ) {
      // Leave bare names to PATH resolution via shell spawn.
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "csdm.cmd";
}

/**
 * Run `csdm analyze` then `csdm video --config-file`.
 * Streams stdout/stderr. Resolves with exit code.
 */
export function runCsdmVideo({
  configFilePath,
  demoPath,
  analyze = true,
  source = "faceit",
  focusPlayerSteamId = null,
  csdmPath = resolveCsdmExecutable(),
  extraArgs = [],
  onLog = (line) => process.stderr.write(line),
}) {
  return new Promise(async (resolve, reject) => {
    try {
      if (analyze && demoPath) {
        const analyzeCode = await spawnLogged(
          csdmPath,
          ["analyze", demoPath, "--source", source, "--force"],
          onLog,
        );
        if (analyzeCode !== 0) {
          onLog(
            `\nWARNING: csdm analyze exited with code ${analyzeCode}. ` +
              `Continuing video with SteamID camera lock (spec_lock_to_accountid). ` +
              `Install PostgreSQL client (psql) for full CSDM DB support.\n`,
          );
        }
      }

      const videoArgs = ["video", "--config-file", configFilePath, ...extraArgs];
      if (focusPlayerSteamId) {
        videoArgs.push("--focus-player", String(focusPlayerSteamId));
      }

      const code = await spawnLogged(csdmPath, videoArgs, onLog);
      resolve(code);
    } catch (error) {
      reject(error);
    }
  });
}

function spawnLogged(command, args, onLog) {
  return new Promise((resolve, reject) => {
    const isCmd = /\.cmd$/i.test(String(command));
    const quotedArgs = args.map(quoteWindowsCmdArg);
    onLog(`\n> ${command} ${quotedArgs.join(" ")}\n`);

    /** @type {import("node:child_process").ChildProcess} */
    let child;
    if (isCmd && process.platform === "win32") {
      // shell:true drops quotes before .cmd batch files see argv — break paths with spaces.
      const comspec = process.env.ComSpec || "cmd.exe";
      const cmdLine = `"${command}" ${quotedArgs.join(" ")}`;
      child = spawn(comspec, ["/d", "/s", "/c", cmdLine], {
        shell: false,
        windowsHide: false,
      });
    } else {
      child = spawn(command, args, {
        shell: isCmd,
        windowsHide: false,
        windowsVerbatimArguments: false,
      });
    }

    child.stdout?.on("data", (chunk) => onLog(String(chunk)));
    child.stderr?.on("data", (chunk) => onLog(String(chunk)));
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "csdm executable not found. Install CS Demo Manager and ensure csdm.cmd is on PATH, or set CSDM_PATH.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
