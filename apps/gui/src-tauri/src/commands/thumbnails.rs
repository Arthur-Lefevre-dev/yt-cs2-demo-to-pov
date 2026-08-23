use super::sidecar::{run_node_cli, to_node_path, workspace_root};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRequest {
    pub player_photo_path: String,
    pub team_logo_path: Option<String>,
    pub player_name: String,
    pub map_name: String,
    pub kills: Option<u32>,
    pub deaths: Option<u32>,
    pub rounds: Option<u32>,
    pub rating: Option<f64>,
    pub score: Option<String>,
    pub out_dir: Option<String>,
    pub work_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResult {
    pub title: String,
    pub score: String,
    pub map_label: String,
    pub out_dir: String,
    pub variants: Value,
}

#[tauri::command]
pub fn generate_thumbnails(request: ThumbnailRequest) -> Result<ThumbnailResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("This app only supports Windows.".into());
    }

    let photo = to_node_path(PathBuf::from(&request.player_photo_path));
    if !photo.is_file() {
        return Err(format!("Player photo not found: {}", request.player_photo_path));
    }

    let root = workspace_root();
    let out_dir = to_node_path(match (&request.out_dir, &request.work_dir) {
        (Some(path), _) => PathBuf::from(path),
        (None, Some(work)) => PathBuf::from(work).join("thumbnails"),
        (None, None) => root.join("fixtures/output/thumbnails"),
    });
    fs::create_dir_all(&out_dir).map_err(|err| format!("Cannot create thumbnails dir: {err}"))?;

    let maps_root = to_node_path(root.join("fixtures/thumbnails/maps"));

    let mut args = vec![
        OsString::from("--player-photo"),
        photo.as_os_str().to_os_string(),
        OsString::from("--name"),
        OsString::from(request.player_name.trim()),
        OsString::from("--map"),
        OsString::from(request.map_name.trim()),
        OsString::from("--out-dir"),
        out_dir.as_os_str().to_os_string(),
        OsString::from("--maps-root"),
        maps_root.as_os_str().to_os_string(),
    ];
    if let Some(kills) = request.kills {
        args.push(OsString::from("--kills"));
        args.push(OsString::from(kills.to_string()));
    }
    if let Some(deaths) = request.deaths {
        args.push(OsString::from("--deaths"));
        args.push(OsString::from(deaths.to_string()));
    }
    if let Some(rounds) = request.rounds {
        args.push(OsString::from("--rounds"));
        args.push(OsString::from(rounds.to_string()));
    }
    if let Some(rating) = request.rating {
        args.push(OsString::from("--rating"));
        args.push(OsString::from(rating.to_string()));
    }
    if let Some(score) = &request.score {
        if !score.trim().is_empty() {
            args.push(OsString::from("--score"));
            args.push(OsString::from(score.trim()));
        }
    }
    if let Some(team_logo) = &request.team_logo_path {
        let logo = to_node_path(PathBuf::from(team_logo));
        if !logo.is_file() {
            return Err(format!("Team logo not found: {team_logo}"));
        }
        args.push(OsString::from("--team-logo"));
        args.push(logo.as_os_str().to_os_string());
    }

    let output = run_node_cli("packages/thumbnail-generator/src/cli.js", &args)?;
    let parsed: Value = serde_json::from_str(output.stdout.trim()).map_err(|err| {
        format!(
            "Failed to parse thumbnail JSON: {err}\n{}",
            output.stdout.chars().take(400).collect::<String>()
        )
    })?;

    Ok(ThumbnailResult {
        title: parsed
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        score: parsed
            .get("score")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        map_label: parsed
            .get("mapLabel")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        out_dir: parsed
            .get("outDir")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| to_node_path(&out_dir).display().to_string()),
        variants: parsed
            .get("variants")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![])),
    })
}
