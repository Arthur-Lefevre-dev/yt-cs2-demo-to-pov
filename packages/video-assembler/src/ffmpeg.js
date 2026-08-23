import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";

const DEFAULT_CANDIDATES = {
  ffmpeg: ["ffmpeg", "ffmpeg.exe", String.raw`C:\ffmpeg\bin\ffmpeg.exe`],
  ffprobe: ["ffprobe", "ffprobe.exe", String.raw`C:\ffmpeg\bin\ffprobe.exe`],
};

export function resolveBinary(name, override) {
  if (override && existsSync(override)) {
    return override;
  }
  const candidates = DEFAULT_CANDIDATES[name] ?? [name];
  for (const candidate of candidates) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    const pathEnv = process.env.PATH ?? "";
    for (const dir of pathEnv.split(delimiter)) {
      const full = `${dir}${dir.endsWith("\\") || dir.endsWith("/") ? "" : "\\"}${candidate}`;
      if (existsSync(full)) {
        return full;
      }
      if (process.platform === "win32" && !candidate.endsWith(".exe")) {
        const withExe = `${full}.exe`;
        if (existsSync(withExe)) {
          return withExe;
        }
      }
    }
  }
  return name;
}

export function runProcess(command, args, { onLog } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      onLog?.(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      onLog?.(text);
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} not found. Install FFmpeg and add it to PATH.`));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
    });
  });
}

/**
 * @param {string} inputPath
 * @param {{ ffprobePath?: string }} [options]
 * @returns {Promise<number>}
 */
export async function probeDurationSeconds(inputPath, { ffprobePath } = {}) {
  const ffprobe = resolveBinary("ffprobe", ffprobePath);
  const { stdout } = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const seconds = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not probe duration for ${inputPath}`);
  }
  return seconds;
}
