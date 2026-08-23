use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

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

pub fn workspace_root() -> PathBuf {
    let relative = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    relative
        .canonicalize()
        .map(to_node_path)
        .unwrap_or(relative)
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
    pub stderr: String,
}

pub fn run_node_cli(cli_relative: &str, args: &[OsString]) -> Result<NodeOutput, String> {
    let node = resolve_node()?;
    let cli = package_cli(cli_relative)?;
    let mut cmd_args = vec![cli.as_os_str().to_os_string()];
    cmd_args.extend_from_slice(args);

    let output = Command::new(&node)
        .args(&cmd_args)
        .output()
        .map_err(|err| format!("Failed to spawn {}: {err}", cli.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "{} failed (exit {:?}):\n{stderr}\n{stdout}",
            cli.display(),
            output.status.code()
        ));
    }

    Ok(NodeOutput { stdout, stderr })
}
