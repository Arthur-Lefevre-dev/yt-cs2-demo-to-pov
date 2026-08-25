use super::sidecar::{
    faceit_api_key_path, read_faceit_api_key, run_node_cli, to_node_path, tracked_players_store_path,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTrackedPlayerRequest {
    pub steam_id: String,
    pub nickname: Option<String>,
    pub display_name: Option<String>,
    pub photo_path: Option<String>,
    pub team_logo_path: Option<String>,
    pub faceit_player_id: Option<String>,
    #[allow(dead_code)]
    pub id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestMatchesRequest {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub per_player: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFaceitDemoRequest {
    pub url: String,
    pub out_path: Option<String>,
    pub match_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyScreenshotRequest {
    pub match_id: String,
    pub out_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceitSettings {
    pub has_api_key: bool,
    pub store_path: String,
    pub api_key_path: String,
}

fn store_os() -> OsString {
    tracked_players_store_path().as_os_str().to_os_string()
}

#[tauri::command]
pub fn get_faceit_settings() -> Result<FaceitSettings, String> {
    Ok(FaceitSettings {
        has_api_key: read_faceit_api_key().is_some(),
        store_path: to_node_path(tracked_players_store_path())
            .display()
            .to_string(),
        api_key_path: to_node_path(faceit_api_key_path()).display().to_string(),
    })
}

#[tauri::command]
pub fn save_faceit_api_key(api_key: String) -> Result<FaceitSettings, String> {
    let path = faceit_api_key_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Cannot create key dir: {err}"))?;
    }
    fs::write(&path, api_key.trim())
        .map_err(|err| format!("Cannot write FACEIT API key: {err}"))?;
    get_faceit_settings()
}

#[tauri::command]
pub fn list_tracked_players() -> Result<Value, String> {
    let output = run_node_cli(
        "packages/faceit-api/src/cli.js",
        &[
            OsString::from("list-tracked"),
            OsString::from("--store"),
            store_os(),
        ],
    )?;
    serde_json::from_str(output.stdout.trim()).map_err(|err| {
        format!(
            "Failed to parse tracked players JSON: {err}\n{}",
            output.stdout.chars().take(400).collect::<String>()
        )
    })
}

#[tauri::command]
pub fn upsert_tracked_player(request: UpsertTrackedPlayerRequest) -> Result<Value, String> {
    let mut args = vec![
        OsString::from("upsert-tracked"),
        OsString::from("--store"),
        store_os(),
        OsString::from("--steam-id"),
        OsString::from(request.steam_id.trim()),
    ];
    if let Some(nickname) = request.nickname {
        if !nickname.trim().is_empty() {
            args.push(OsString::from("--nickname"));
            args.push(OsString::from(nickname.trim()));
        }
    }
    if let Some(name) = request.display_name {
        if !name.trim().is_empty() {
            args.push(OsString::from("--display-name"));
            args.push(OsString::from(name.trim()));
        }
    }
    if let Some(photo) = request.photo_path {
        let path = to_node_path(PathBuf::from(&photo));
        if path.is_file() {
            args.push(OsString::from("--photo"));
            args.push(path.as_os_str().to_os_string());
        }
    }
    if let Some(logo) = request.team_logo_path {
        let path = to_node_path(PathBuf::from(&logo));
        if path.is_file() {
            args.push(OsString::from("--team-logo"));
            args.push(path.as_os_str().to_os_string());
        }
    }
    if let Some(faceit_id) = request.faceit_player_id {
        if !faceit_id.trim().is_empty() {
            args.push(OsString::from("--faceit-id"));
            args.push(OsString::from(faceit_id.trim()));
        }
    }
    let output = run_node_cli("packages/faceit-api/src/cli.js", &args)?;
    serde_json::from_str(output.stdout.trim())
        .map_err(|err| format!("Failed to upsert tracked player: {err}"))
}

#[tauri::command]
pub fn remove_tracked_player(id: String) -> Result<Value, String> {
    let output = run_node_cli(
        "packages/faceit-api/src/cli.js",
        &[
            OsString::from("remove-tracked"),
            OsString::from("--store"),
            store_os(),
            OsString::from("--id"),
            OsString::from(id.trim()),
        ],
    )?;
    serde_json::from_str(output.stdout.trim())
        .map_err(|err| format!("Failed to remove tracked player: {err}"))
}

#[tauri::command]
pub fn list_faceit_best_matches(request: BestMatchesRequest) -> Result<Value, String> {
    let key = read_faceit_api_key().ok_or_else(|| {
        format!(
            "FACEIT API key missing. Save it to {} or set FACEIT_API_KEY.",
            faceit_api_key_path().display()
        )
    })?;
    let mut args = vec![
        OsString::from("best-matches"),
        OsString::from("--store"),
        store_os(),
        OsString::from("--api-key"),
        OsString::from(key),
        OsString::from("--page"),
        OsString::from(request.page.unwrap_or(1).to_string()),
        OsString::from("--page-size"),
        OsString::from(request.page_size.unwrap_or(10).to_string()),
        OsString::from("--per-player"),
        OsString::from(request.per_player.unwrap_or(15).to_string()),
    ];
    let _ = &mut args;
    let output = run_node_cli("packages/faceit-api/src/cli.js", &args)?;
    serde_json::from_str(output.stdout.trim()).map_err(|err| {
        format!(
            "Failed to parse FACEIT matches JSON: {err}\n{}",
            output.stdout.chars().take(500).collect::<String>()
        )
    })
}

#[tauri::command]
pub fn download_faceit_demo(request: DownloadFaceitDemoRequest) -> Result<Value, String> {
    let url = request.url.trim();
    if url.is_empty() {
        return Err("Demo URL is empty".into());
    }
    let out = to_node_path(match &request.out_path {
        Some(path) => PathBuf::from(path),
        None => {
            let name = request
                .match_id
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("faceit-match");
            super::sidecar::user_app_root()
                .join("demos")
                .join(format!("{name}.dem"))
        }
    });
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Cannot create demos dir: {err}"))?;
    }
    let output = run_node_cli(
        "packages/faceit-api/src/cli.js",
        &[
            OsString::from("download-demo"),
            OsString::from("--url"),
            OsString::from(url),
            OsString::from("--out"),
            out.as_os_str().to_os_string(),
        ],
    )?;
    serde_json::from_str(output.stdout.trim())
        .map_err(|err| format!("Failed to download demo: {err}\n{}", output.stdout))
}

#[tauri::command]
pub fn generate_faceit_lobby_screenshot(
    request: LobbyScreenshotRequest,
) -> Result<Value, String> {
    let key = read_faceit_api_key().ok_or_else(|| {
        format!(
            "FACEIT API key missing. Save it to {} or set FACEIT_API_KEY.",
            faceit_api_key_path().display()
        )
    })?;
    let match_id = request.match_id.trim();
    if match_id.is_empty() {
        return Err("match_id is required".into());
    }
    let out = to_node_path(match &request.out_path {
        Some(path) => PathBuf::from(path),
        None => super::sidecar::user_app_root()
            .join("lobbies")
            .join(format!("{match_id}-lobby.jpg")),
    });
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Cannot create lobbies dir: {err}"))?;
    }
    let output = run_node_cli(
        "packages/faceit-api/src/cli.js",
        &[
            OsString::from("lobby-screenshot"),
            OsString::from("--match-id"),
            OsString::from(match_id),
            OsString::from("--out"),
            out.as_os_str().to_os_string(),
            OsString::from("--api-key"),
            OsString::from(key),
        ],
    )?;
    serde_json::from_str(output.stdout.trim()).map_err(|err| {
        format!(
            "Failed to generate lobby screenshot: {err}\n{}",
            output.stdout.chars().take(500).collect::<String>()
        )
    })
}
