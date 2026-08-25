import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ensureSteamRunning } from "./steam.js";

/**
 * Quote one argument for logging / cmd.exe fallback.
 * @param {unknown} value
 */
export function quoteWindowsCmdArg(value) {
  const s = String(value);
  if (!/[\s"]/u.test(s)) {
    return s;
  }
  return `"${s.replace(/(\\*)"/g, "$1$1\\\"")}"`;
}

/**
 * @typedef {{ command: string, prefixArgs: string[], env: Record<string, string>, label: string }} CsdmLaunch
 */

function installRoots() {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return [
    join(local, "Programs", "cs-demo-manager"),
    join(local, "Programs", "CS Demo Manager"),
  ];
}

/**
 * Prefer launching Electron as Node (same as csdm.cmd) so argv keeps spaces.
 * `csdm.cmd` uses `%*` which drops quotes → "syntaxe du nom de fichier incorrecte".
 * @returns {CsdmLaunch}
 */
export function resolveCsdmLaunch() {
  if (process.env.CSDM_PATH && existsSync(process.env.CSDM_PATH)) {
    const custom = process.env.CSDM_PATH;
    if (/\.cmd$/i.test(custom)) {
      return resolveFromCmdWrapper(custom);
    }
    return { command: custom, prefixArgs: [], env: {}, label: custom };
  }

  for (const root of installRoots()) {
    const launch = tryElectronLaunch(root);
    if (launch) {
      return launch;
    }
  }

  for (const root of installRoots()) {
    const cmd = join(root, "csdm.cmd");
    if (existsSync(cmd)) {
      return { command: cmd, prefixArgs: [], env: {}, label: cmd };
    }
  }

  return { command: "csdm.cmd", prefixArgs: [], env: {}, label: "csdm.cmd" };
}

/**
 * @param {string} root
 * @returns {CsdmLaunch | null}
 */
function tryElectronLaunch(root) {
  const exe = join(root, "cs-demo-manager.exe");
  const asar = join(root, "resources", "app.asar");
  // cli.js lives inside the asar — existsSync(asar/cli.js) is false outside Electron.
  if (existsSync(exe) && existsSync(asar)) {
    return {
      command: exe,
      prefixArgs: [join(asar, "cli.js")],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      label: join(root, "csdm.cmd"),
    };
  }
  return null;
}

/** @param {string} cmdPath */
function resolveFromCmdWrapper(cmdPath) {
  const root = dirname(cmdPath);
  return tryElectronLaunch(root) ?? {
    command: cmdPath,
    prefixArgs: [],
    env: {},
    label: cmdPath,
  };
}

/** @deprecated use resolveCsdmLaunch */
export function resolveCsdmExecutable() {
  return resolveCsdmLaunch().label;
}

/**
 * Human-readable hint for common Windows / CSDM exit codes.
 * @param {number | null | undefined} code
 */
export function explainCsdmExitCode(code) {
  const n = Number(code);
  // STATUS_CONTROL_C_EXIT (0xC000013A) — process interrupted / killed.
  if (n === -1073741510 || n === 3221226038) {
    return (
      "Recording was interrupted (exit 0xC000013A / Ctrl+C). " +
        "Do not click CS2, close the window, or press Ctrl+C until HLAE finishes. " +
        "Keep Steam open and retry one round."
    );
  }
  if (n === -1073741819 || n === 3221225477) {
    return "CS2/HLAE crashed (access violation). Update HLAE via CSDM, verify CS2 files, retry one round.";
  }
  if (n === 1) {
    return 'If the log says "Steam is not running", open Steam and retry.';
  }
  return `csdm exited with code ${code}. Check the log above; retry with a single round.`;
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
  csdmPath,
  extraArgs = [],
  onLog = (line) => process.stderr.write(line),
}) {
  return new Promise(async (resolve, reject) => {
    try {
      const launch = csdmPath
        ? resolveFromCmdWrapper(csdmPath)
        : resolveCsdmLaunch();

      if (analyze && demoPath) {
        const analyzeCode = await spawnLogged(
          launch,
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

      // CSDM refuses to start CS2 when Steam is not running.
      await ensureSteamRunning({ onLog });

      const videoArgs = ["video", "--config-file", configFilePath, ...extraArgs];
      if (focusPlayerSteamId) {
        videoArgs.push("--focus-player", String(focusPlayerSteamId));
      }
      // HUD / demoui / POV lock live in sequence.cfg (avoid fragile CLI --cfg quoting).

      const code = await spawnLogged(launch, videoArgs, onLog);
      if (code !== 0) {
        onLog(`\n${explainCsdmExitCode(code)}\n`);
      }
      resolve(code);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 */
export function buildWindowsCmdLine(command, args) {
  const quotedArgs = args.map(quoteWindowsCmdArg);
  return `"${command}" ${quotedArgs.join(" ")}`.trimEnd();
}

/**
 * @param {CsdmLaunch} launch
 * @param {string[]} args
 * @param {(line: string) => void} onLog
 */
function spawnLogged(launch, args, onLog) {
  return new Promise((resolve, reject) => {
    const fullArgs = [...launch.prefixArgs, ...args];
    const display = `${launch.label} ${args.map(quoteWindowsCmdArg).join(" ")}`;
    onLog(`\n> ${display}\n`);

    const isCmd = /\.cmd$/i.test(String(launch.command));
    /** @type {import("node:child_process").ChildProcess} */
    let child;

    if (isCmd && process.platform === "win32") {
      // Last-resort fallback — .cmd %* still breaks spaces; prefer Electron path above.
      const comspec = process.env.ComSpec || "cmd.exe";
      const cmdLine = buildWindowsCmdLine(launch.command, fullArgs);
      child = spawn(comspec, ["/d", "/s", "/c", cmdLine], {
        shell: false,
        windowsHide: false,
        windowsVerbatimArguments: true,
        stdin: "ignore",
        // New process group so console Ctrl+C on the Node parent does not abort HLAE mid-record.
        detached: true,
        env: { ...process.env, ...launch.env },
      });
    } else {
      // Direct Electron-as-Node: argv array keeps spaces (no cmd / %*).
      child = spawn(launch.command, fullArgs, {
        shell: false,
        windowsHide: false,
        stdin: "ignore",
        detached: true,
        env: { ...process.env, ...launch.env },
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
