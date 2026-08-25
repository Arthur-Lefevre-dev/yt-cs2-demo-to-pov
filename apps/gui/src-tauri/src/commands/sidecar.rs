use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;

/// Windows `canonicalize()` often yields `\\?\C:\...`. Node cannot load scripts
/// with that prefix (EISDIR on `C:`). Strip it before spawning.
pub fn to_node_path(path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path.to_path_buf()
}

/// Repo root (dev / same-machine builds). Baked from compile-time manifest dir.
pub fn workspace_root() -> PathBuf {
    let relative = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    relative
        .canonicalize()
        .map(to_node_path)
        .unwrap_or(relative)
}

/// `true` for `tauri dev` / debug builds. Release installs use user Documents.
pub fn is_dev_build() -> bool {
    cfg!(debug_assertions)
}

/// User-facing folder (no spaces — CSDM `.cmd` / batch breaks on `%*`).
/// `%USERPROFILE%\Documents\CS2-POV-Generator`
pub fn user_app_root() -> PathBuf {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    to_node_path(home.join("Documents").join("CS2-POV-Generator"))
}

/// Jobs output root (videos, CSDM clips, chapters).
/// - Dev: `<repo>/fixtures/output/jobs`
/// - Release: `Documents/CS2-POV-Generator/jobs`
pub fn jobs_root() -> PathBuf {
    if let Ok(override_dir) = env::var("CS2_POV_JOBS_DIR") {
        if !override_dir.trim().is_empty() {
            return to_node_path(PathBuf::from(override_dir.trim()));
        }
    }
    if is_dev_build() {
        to_node_path(
            workspace_root()
                .join("fixtures")
                .join("output")
                .join("jobs"),
        )
    } else {
        user_app_root().join("jobs")
    }
}

pub fn job_work_dir(job_slug: &str) -> PathBuf {
    to_node_path(jobs_root().join(job_slug))
}

/// Map backgrounds for thumbnail generator.
pub fn thumbnails_maps_root() -> PathBuf {
    let user_maps = user_app_root()
        .join("assets")
        .join("thumbnails")
        .join("maps");
    if user_maps.is_dir() {
        return to_node_path(user_maps);
    }
    to_node_path(
        workspace_root()
            .join("fixtures")
            .join("thumbnails")
            .join("maps"),
    )
}

/// Fixed 4K badge folder for thumbnails (top-left).
pub fn thumbnails_brand_root() -> PathBuf {
    let user_brand = user_app_root()
        .join("assets")
        .join("thumbnails")
        .join("brand");
    if user_brand.is_dir() {
        return to_node_path(user_brand);
    }
    to_node_path(
        workspace_root()
            .join("fixtures")
            .join("thumbnails")
            .join("brand"),
    )
}

/// JSON store for tracked FACEIT players (SteamID + photo + team logo).
pub fn tracked_players_store_path() -> PathBuf {
    if is_dev_build() {
        return to_node_path(
            workspace_root()
                .join("fixtures")
                .join("tracked-players.json"),
        );
    }
    to_node_path(user_app_root().join("tracked-players.json"))
}

/// Optional FACEIT API key file (plain text). Env FACEIT_API_KEY wins.
pub fn faceit_api_key_path() -> PathBuf {
    if is_dev_build() {
        return to_node_path(workspace_root().join("fixtures").join("faceit-api-key.txt"));
    }
    to_node_path(user_app_root().join("faceit-api-key.txt"))
}

pub fn read_faceit_api_key() -> Option<String> {
    if let Ok(key) = env::var("FACEIT_API_KEY") {
        let trimmed = key.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    let path = faceit_api_key_path();
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Default thumbnails output when no job work_dir is provided.
pub fn default_thumbnails_out_dir() -> PathBuf {
    if is_dev_build() {
        to_node_path(
            workspace_root()
                .join("fixtures")
                .join("output")
                .join("thumbnails"),
        )
    } else {
        user_app_root().join("thumbnails")
    }
}

pub fn resolve_node() -> Result<PathBuf, String> {
    let path_env = env::var_os("PATH").ok_or_else(|| "PATH is empty".to_string())?;
    for dir in env::split_paths(&path_env) {
        let candidate = dir.join("node.exe");
        if candidate.is_file() {
            return Ok(to_node_path(candidate));
        }
        let candidate = dir.join("node");
        if candidate.is_file() {
            return Ok(to_node_path(candidate));
        }
    }
    Err("Node.js not found in PATH. Install Node ≥ 20.".into())
}

pub fn package_cli(relative: &str) -> Result<PathBuf, String> {
    let cli = to_node_path(workspace_root().join(relative));
    if cli.is_file() {
        return Ok(cli);
    }
    Err(format!("CLI not found at {}", cli.display()))
}

pub struct NodeOutput {
    pub stdout: String,
    #[allow(dead_code)]
    pub stderr: String,
}

pub fn run_node_cli(cli_relative: &str, args: &[OsString]) -> Result<NodeOutput, String> {
    run_node_cli_streaming(cli_relative, args, |_| {})
}

/// Run blocking work off the UI thread so the webview stays responsive.
pub async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| format!("Background task failed: {err}"))?
}

/// Spawn a Node CLI and stream each output line to `on_line` as it arrives.
pub fn run_node_cli_streaming(
    cli_relative: &str,
    args: &[OsString],
    mut on_line: impl FnMut(&str) + Send,
) -> Result<NodeOutput, String> {
    let node = resolve_node()?;
    let cli = package_cli(cli_relative)?;
    let mut cmd_args = vec![cli.as_os_str().to_os_string()];
    cmd_args.extend_from_slice(args);

    let mut child = Command::new(&node)
        .args(&cmd_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to spawn {}: {err}", cli.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    let (tx, rx) = mpsc::channel::<(bool, String)>();
    let tx_out = tx.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = tx_out.send((true, line));
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = tx.send((false, line));
        }
    });

    let wait_handle = thread::spawn(move || child.wait());

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();
    for (is_stdout, line) in rx {
        on_line(&line);
        if is_stdout {
            if !stdout_buf.is_empty() {
                stdout_buf.push('\n');
            }
            stdout_buf.push_str(&line);
        } else {
            if !stderr_buf.is_empty() {
                stderr_buf.push('\n');
            }
            stderr_buf.push_str(&line);
        }
    }

    let status = wait_handle
        .join()
        .map_err(|_| "Failed to join process waiter".to_string())?
        .map_err(|err| format!("Failed waiting for {}: {err}", cli.display()))?;

    if !status.success() {
        return Err(format!(
            "{} failed (exit {:?}):\n{}\n{stderr_buf}\n{stdout_buf}",
            cli.display(),
            status.code(),
            explain_windows_exit(status)
        ));
    }

    Ok(NodeOutput {
        stdout: stdout_buf,
        stderr: stderr_buf,
    })
}

/// Map common Windows NTSTATUS exit codes to a short operator hint.
fn explain_windows_exit(status: ExitStatus) -> String {
    match status.code() {
        Some(-1073741510) => {
            "Recording interrupted (Ctrl+C / process killed). Leave CS2 alone until HLAE finishes, then retry one round.".into()
        }
        Some(-1073741819) => {
            "Process crashed (access violation). Update HLAE in CSDM and verify CS2 files.".into()
        }
        _ => String::new(),
    }
}
