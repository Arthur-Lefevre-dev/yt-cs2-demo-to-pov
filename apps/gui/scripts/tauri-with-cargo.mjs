#!/usr/bin/env node
/**
 * Ensures ~/.cargo/bin is on PATH before spawning the Tauri CLI.
 * Cursor/VS Code terminals often keep a stale PATH if they were opened
 * before rustup was installed.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createRequire } from "node:module";

const cargoBin = join(homedir(), ".cargo", "bin");
const cargoExe = process.platform === "win32" ? "cargo.exe" : "cargo";

if (!existsSync(join(cargoBin, cargoExe))) {
  console.error(
    `Rust/cargo not found at ${join(cargoBin, cargoExe)}.\n` +
      "Install Rust from https://rustup.rs/ then reopen the terminal.",
  );
  process.exit(1);
}

const pathParts = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
if (!pathParts.some((part) => part.toLowerCase() === cargoBin.toLowerCase())) {
  process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH ?? ""}`;
}

const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);

const child = spawn(process.execPath, [tauriCli, ...args], {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
