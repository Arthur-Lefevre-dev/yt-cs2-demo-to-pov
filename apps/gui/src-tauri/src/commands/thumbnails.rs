use super::sidecar::{
    default_thumbnails_out_dir, run_blocking, run_node_cli, thumbnails_brand_root,
    thumbnails_maps_root, to_node_path,
};
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
    pub show_brand_logo: Option<bool>,
    pub player_name: String,
    pub map_name: String,
    pub kills: Option<u32>,
    pub deaths: Option<u32>,
    pub rounds: Option<u32>,
    pub rating: Option<f64>,
    pub score: Option<String>,
    pub match_kind: Option<String>,
    pub event_name: Option<String>,
    pub matchup: Option<String>,
    pub background_paths: Option<Vec<String>>,
    pub out_dir: Option<String>,
    pub work_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeScreenshotsRequest {
    pub work_dir: String,
    pub video_path: Option<String>,
    pub out_dir: Option<String>,
    pub count: Option<u32>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeScreenshotsResult {
    pub out_dir: String,
    pub count: u32,
    pub proposals: Value,
}

#[tauri::command]
pub async fn propose_thumbnail_screenshots(
    request: ProposeScreenshotsRequest,
) -> Result<ProposeScreenshotsResult, String> {
    run_blocking(move || {
        if !cfg!(target_os = "windows") {
            return Err("This app only supports Windows.".into());
        }

        let work_dir = to_node_path(PathBuf::from(&request.work_dir));
        if !work_dir.is_dir() {
            return Err(format!("Work dir not found: {}", request.work_dir));
        }

        let out_dir = to_node_path(match &request.out_dir {
            Some(path) => PathBuf::from(path),
            None => work_dir.join("thumbnail-proposals"),
        });
        fs::create_dir_all(&out_dir).map_err(|err| format!("Cannot create proposals dir: {err}"))?;

        let mut args = vec![
            OsString::from("--work-dir"),
            work_dir.as_os_str().to_os_string(),
            OsString::from("--out-dir"),
            out_dir.as_os_str().to_os_string(),
            OsString::from("--count"),
            OsString::from(request.count.unwrap_or(10).to_string()),
        ];
        if let Some(video) = &request.video_path {
            let path = to_node_path(PathBuf::from(video));
            if path.is_file() {
                args.push(OsString::from("--video"));
                args.push(path.as_os_str().to_os_string());
            }
        }

        let output =
            run_node_cli("packages/thumbnail-generator/src/propose-screenshots.js", &args)?;
        let parsed: Value = serde_json::from_str(output.stdout.trim()).map_err(|err| {
            format!(
                "Failed to parse screenshot proposals JSON: {err}\n{}",
                output.stdout.chars().take(400).collect::<String>()
            )
        })?;

        Ok(ProposeScreenshotsResult {
            out_dir: parsed
                .get("outDir")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| to_node_path(&out_dir).display().to_string()),
            count: parsed
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            proposals: parsed
                .get("proposals")
                .cloned()
                .unwrap_or_else(|| Value::Array(vec![])),
        })
    })
    .await
}

#[tauri::command]
pub async fn generate_thumbnails(request: ThumbnailRequest) -> Result<ThumbnailResult, String> {
    run_blocking(move || {
        if !cfg!(target_os = "windows") {
            return Err("This app only supports Windows.".into());
        }

        let photo = to_node_path(PathBuf::from(&request.player_photo_path));
        if !photo.is_file() {
            return Err(format!(
                "Player photo not found: {}",
                request.player_photo_path
            ));
        }

        let out_dir = to_node_path(match (&request.out_dir, &request.work_dir) {
            (Some(path), _) => PathBuf::from(path),
            (None, Some(work)) => PathBuf::from(work).join("thumbnails"),
            (None, None) => default_thumbnails_out_dir(),
        });
        fs::create_dir_all(&out_dir)
            .map_err(|err| format!("Cannot create thumbnails dir: {err}"))?;

        let maps_root = thumbnails_maps_root();
        let brand_root = thumbnails_brand_root();

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
            OsString::from("--brand-root"),
            brand_root.as_os_str().to_os_string(),
        ];
        if request.show_brand_logo == Some(false) {
            args.push(OsString::from("--no-4k-logo"));
        }
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
        if let Some(backgrounds) = &request.background_paths {
            for path in backgrounds.iter().take(3) {
                let bg = to_node_path(PathBuf::from(path));
                if !bg.is_file() {
                    return Err(format!("Screenshot background not found: {path}"));
                }
                args.push(OsString::from("--background"));
                args.push(bg.as_os_str().to_os_string());
            }
        }
        if let Some(kind) = &request.match_kind {
            if !kind.trim().is_empty() {
                args.push(OsString::from("--match-kind"));
                args.push(OsString::from(kind.trim()));
            }
        }
        if let Some(event) = &request.event_name {
            if !event.trim().is_empty() {
                args.push(OsString::from("--event"));
                args.push(OsString::from(event.trim()));
            }
        }
        if let Some(matchup) = &request.matchup {
            if !matchup.trim().is_empty() {
                args.push(OsString::from("--matchup"));
                args.push(OsString::from(matchup.trim()));
            }
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
    })
    .await
}
