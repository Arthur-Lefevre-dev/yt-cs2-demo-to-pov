use super::sidecar::{run_node_cli_streaming, to_node_path, workspace_root};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRequest {
    pub parse_result: Value,
    pub steam_id: String,
    pub player_name: String,
    pub rounds: Vec<u32>,
    pub lobby_path: Option<String>,
    pub intro_seconds: Option<f64>,
    pub work_dir: Option<String>,
    /// dry_run = configs + estimated chapters only (no CSDM / no ffmpeg assemble)
    pub dry_run: bool,
    /// When not dry_run, also call `csdm video --run` (heavy).
    pub run_csdm: bool,
    /// Optional existing round clip paths (same order as selected rounds) for assemble.
    pub round_clip_paths: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineResult {
    pub work_dir: String,
    pub config_paths: Vec<String>,
    pub chapters_text: String,
    pub chapters_path: Option<String>,
    pub video_path: Option<String>,
    pub dry_run: bool,
    pub mode: String,
    pub logs: Vec<String>,
}

fn emit_log(app: &AppHandle, logs: &mut Vec<String>, line: impl Into<String>) {
    let line = line.into();
    if line.trim().is_empty() {
        return;
    }
    logs.push(line.clone());
    let _ = app.emit("pipeline-log", line);
}

fn format_ts(total_seconds: f64) -> String {
    let seconds = total_seconds.max(0.0).floor() as u64;
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

fn estimated_chapters(parse: &Value, steam_id: &str, rounds: &[u32], intro_seconds: f64) -> String {
    let mut lines = Vec::new();
    let mut cursor = 0.0_f64;
    lines.push(format!("{} Lobby", format_ts(cursor)));
    cursor += intro_seconds;

    let player_rounds = parse
        .get("player_rounds")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for round_number in rounds {
        let row = player_rounds.iter().find(|entry| {
            entry.get("steam_id").and_then(|v| v.as_str()) == Some(steam_id)
                && entry.get("round_number").and_then(|v| v.as_u64()) == Some(u64::from(*round_number))
        });
        let duration = row
            .and_then(|entry| entry.get("estimated_clip_seconds"))
            .and_then(|v| v.as_f64())
            .unwrap_or(30.0);
        lines.push(format!("{} Round {round_number}", format_ts(cursor)));
        cursor += duration;
    }
    lines.join("\n")
}

/// Find CSDM-generated mp4s for each selected round (by start/end tick in the JSON config).
fn discover_csdm_clips(config_dir: &PathBuf, rounds: &[u32]) -> Vec<String> {
    let mut found = Vec::new();
    for round in rounds {
        let config_path = config_dir.join(format!("csdm-round-{:02}.json", round));
        let Ok(text) = fs::read_to_string(&config_path) else {
            return Vec::new();
        };
        let Ok(json) = serde_json::from_str::<Value>(&text) else {
            return Vec::new();
        };
        let Some(seq) = json
            .get("sequences")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
        else {
            return Vec::new();
        };
        let Some(start) = seq.get("startTick").and_then(|v| v.as_u64()) else {
            return Vec::new();
        };
        let Some(end) = seq.get("endTick").and_then(|v| v.as_u64()) else {
            return Vec::new();
        };

        let tick_suffix = format!("tick-{start}-to-{end}.mp4");
        let mut match_path: Option<PathBuf> = None;
        if let Ok(entries) = fs::read_dir(config_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(&tick_suffix) {
                    match_path = Some(entry.path());
                    break;
                }
            }
        }
        if match_path.is_none() {
            if let Some(name) = json.get("outputFileName").and_then(|v| v.as_str()) {
                let candidate = config_dir.join(format!("{name}.mp4"));
                if candidate.is_file() {
                    match_path = Some(candidate);
                }
            }
        }

        match match_path {
            Some(path) => found.push(to_node_path(&path).display().to_string()),
            None => return Vec::new(),
        }
    }
    found
}

fn stream_cli(
    app: &AppHandle,
    logs: &mut Vec<String>,
    cli_relative: &str,
    args: &[OsString],
) -> Result<super::sidecar::NodeOutput, String> {
    let app_log = app.clone();
    let mut streamed = Vec::new();
    let output = run_node_cli_streaming(cli_relative, args, |line| {
        streamed.push(line.to_string());
        let _ = app_log.emit("pipeline-log", line.to_string());
    })?;
    logs.extend(streamed);
    Ok(output)
}

/// Blocking pipeline body. Must not run on the UI / IPC thread.
fn run_pipeline_inner(app: AppHandle, request: PipelineRequest) -> Result<PipelineResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("This app only supports Windows.".into());
    }
    if request.rounds.is_empty() {
        return Err("Select at least one round.".into());
    }

    let mut logs = Vec::new();
    let root = workspace_root();
    let map = request
        .parse_result
        .get("map")
        .and_then(|v| v.as_str())
        .unwrap_or("map");
    let safe_player = request
        .player_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();

    let work_dir = to_node_path(match &request.work_dir {
        Some(path) => PathBuf::from(path),
        None => root.join(format!("fixtures/output/jobs/{safe_player}-{map}")),
    });
    fs::create_dir_all(&work_dir).map_err(|err| format!("Cannot create work dir: {err}"))?;
    emit_log(&app, &mut logs, format!("Work dir: {}", work_dir.display()));

    let parsed_path = work_dir.join("parsed.json");
    fs::write(
        &parsed_path,
        serde_json::to_string_pretty(&request.parse_result)
            .map_err(|err| format!("serialize parse result: {err}"))?,
    )
    .map_err(|err| format!("write parsed.json: {err}"))?;

    let config_dir = work_dir.join("csdm");
    fs::create_dir_all(&config_dir).map_err(|err| format!("csdm dir: {err}"))?;

    let rounds_csv = request
        .rounds
        .iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");

    emit_log(
        &app,
        &mut logs,
        format!(
            "Generating CSDM configs for rounds {rounds_csv} (player {})…",
            request.steam_id
        ),
    );

    let mut config_args = vec![
        OsString::from("--parse"),
        parsed_path.as_os_str().to_os_string(),
        OsString::from("--player"),
        OsString::from(&request.steam_id),
        OsString::from("--rounds"),
        OsString::from(&rounds_csv),
        OsString::from("--out-dir"),
        config_dir.as_os_str().to_os_string(),
        OsString::from("--split"),
        OsString::from("--width"),
        OsString::from("3840"),
        OsString::from("--height"),
        OsString::from("2160"),
        OsString::from("--framerate"),
        OsString::from("60"),
    ];
    if request.run_csdm && !request.dry_run {
        config_args.push(OsString::from("--run"));
        emit_log(
            &app,
            &mut logs,
            format!(
                "WARNING: launching CSDM/HLAE for {} round(s) — UI stays responsive; do not use mouse/keyboard in CS2.",
                request.rounds.len()
            ),
        );
    }

    stream_cli(
        &app,
        &mut logs,
        "packages/csdm-bridge/src/cli.js",
        &config_args,
    )?;

    let mut config_paths = Vec::new();
    for round in &request.rounds {
        let path = config_dir.join(format!("csdm-round-{:02}.json", round));
        if path.is_file() {
            config_paths.push(to_node_path(&path).display().to_string());
        }
    }
    emit_log(
        &app,
        &mut logs,
        format!("Wrote {} CSDM config(s)", config_paths.len()),
    );

    let intro_seconds = request.intro_seconds.unwrap_or(4.0);
    let mut chapters_text =
        estimated_chapters(&request.parse_result, &request.steam_id, &request.rounds, intro_seconds);
    let mut video_path: Option<String> = None;
    let chapters_path: Option<String>;
    let mut mode = if request.dry_run {
        "dry-run".to_string()
    } else if request.run_csdm {
        "csdm-record".to_string()
    } else {
        "configs-only".to_string()
    };

    let mut clip_paths = request.round_clip_paths.unwrap_or_default();
    if clip_paths.is_empty() && !request.dry_run {
        clip_paths = discover_csdm_clips(&config_dir, &request.rounds);
        if !clip_paths.is_empty() {
            emit_log(
                &app,
                &mut logs,
                format!("Discovered {} CSDM clip(s) for assembly.", clip_paths.len()),
            );
            for path in &clip_paths {
                emit_log(&app, &mut logs, format!("  clip: {path}"));
            }
        }
    }

    let clips_ready = !request.dry_run
        && clip_paths.len() == request.rounds.len()
        && clip_paths.iter().all(|path| PathBuf::from(path).is_file());

    if clips_ready {
        mode = "assemble".to_string();
        emit_log(&app, &mut logs, "Assembling intro + round clips with ffmpeg…");
        let assemble_dir = work_dir.join("assemble");
        let final_video = work_dir.join("final.mp4");
        let result_json = work_dir.join("assemble-result.json");
        let clips_csv = clip_paths.join(",");

        let mut assemble_args = vec![
            OsString::from("--out"),
            final_video.as_os_str().to_os_string(),
            OsString::from("--clips"),
            OsString::from(&clips_csv),
            OsString::from("--work-dir"),
            assemble_dir.as_os_str().to_os_string(),
            OsString::from("--result-json"),
            result_json.as_os_str().to_os_string(),
            OsString::from("--intro-seconds"),
            OsString::from(intro_seconds.to_string()),
            OsString::from("--width"),
            OsString::from("3840"),
            OsString::from("--height"),
            OsString::from("2160"),
            OsString::from("--framerate"),
            OsString::from("60"),
        ];
        if let Some(lobby) = &request.lobby_path {
            if PathBuf::from(lobby).is_file() {
                assemble_args.push(OsString::from("--lobby"));
                assemble_args.push(OsString::from(lobby));
            } else {
                emit_log(
                    &app,
                    &mut logs,
                    "No lobby screenshot provided — assembling rounds only (no intro).",
                );
            }
        } else {
            emit_log(
                &app,
                &mut logs,
                "No lobby screenshot provided — assembling rounds only (no intro).",
            );
        }

        stream_cli(
            &app,
            &mut logs,
            "packages/video-assembler/src/cli.js",
            &assemble_args,
        )?;
        video_path = Some(to_node_path(&final_video).display().to_string());

        let chapters_file = work_dir.join("chapters.txt");
        let chapters_out = stream_cli(
            &app,
            &mut logs,
            "packages/chapters/src/cli.js",
            &[
                OsString::from("--assemble-json"),
                result_json.as_os_str().to_os_string(),
                OsString::from("--out"),
                chapters_file.as_os_str().to_os_string(),
            ],
        )?;
        if !chapters_out.stdout.trim().is_empty() {
            chapters_text = chapters_out.stdout.trim().to_string();
        }
        chapters_path = Some(to_node_path(&chapters_file).display().to_string());
        emit_log(&app, &mut logs, format!("Assembly done: {}", final_video.display()));
    } else {
        let chapters_file = work_dir.join("chapters-estimated.txt");
        fs::write(&chapters_file, format!("{chapters_text}\n"))
            .map_err(|err| format!("write chapters: {err}"))?;
        chapters_path = Some(to_node_path(&chapters_file).display().to_string());
        if request.run_csdm && !request.dry_run {
            emit_log(
                &app,
                &mut logs,
                "CSDM finished but round mp4s were not found for assembly (expected sequence-*-tick-*-to-*.mp4).",
            );
        } else {
            emit_log(
                &app,
                &mut logs,
                "Dry-run / no clips: wrote estimated YouTube chapters (not ffprobe).",
            );
        }
    }

    let state = serde_json::json!({
        "steamId": request.steam_id,
        "playerName": request.player_name,
        "rounds": request.rounds,
        "configPaths": config_paths,
        "chaptersPath": chapters_path,
        "videoPath": video_path,
        "dryRun": request.dry_run,
        "mode": mode,
        "updatedAt": SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    fs::write(
        work_dir.join("job-state.json"),
        serde_json::to_string_pretty(&state).unwrap_or_default(),
    )
    .ok();

    Ok(PipelineResult {
        work_dir: to_node_path(&work_dir).display().to_string(),
        config_paths,
        chapters_text,
        chapters_path,
        video_path,
        dry_run: request.dry_run,
        mode,
        logs,
    })
}

#[tauri::command]
pub async fn run_pipeline(
    app: AppHandle,
    request: PipelineRequest,
) -> Result<PipelineResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_pipeline_inner(app, request))
        .await
        .map_err(|err| format!("Pipeline task failed: {err}"))?
}
