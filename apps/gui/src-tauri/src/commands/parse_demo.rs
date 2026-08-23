use super::sidecar::{run_node_cli, to_node_path};
use serde_json::Value;
use std::ffi::OsString;
use std::path::PathBuf;

#[tauri::command]
pub fn parse_demo(demo_path: String, player: Option<String>) -> Result<Value, String> {
    if !cfg!(target_os = "windows") {
        return Err("This app only supports Windows.".into());
    }

    let demo = to_node_path(PathBuf::from(&demo_path));
    if !demo.is_file() {
        return Err(format!("Demo file not found: {demo_path}"));
    }
    if demo
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("dem"))
        != Some(true)
    {
        return Err("Expected a .dem file.".into());
    }

    let mut args = vec![
        OsString::from("--demo"),
        demo.as_os_str().to_os_string(),
    ];
    if let Some(steam_id) = player {
        if !steam_id.trim().is_empty() {
            args.push(OsString::from("--player"));
            args.push(OsString::from(steam_id.trim()));
        }
    }

    let output = run_node_cli("packages/demo-parser/src/cli.js", &args)?;
    serde_json::from_str(output.stdout.trim()).map_err(|err| {
        format!(
            "Failed to parse demo-parser JSON: {err}\nStdout (first 500 chars): {}",
            output.stdout.chars().take(500).collect::<String>()
        )
    })
}
