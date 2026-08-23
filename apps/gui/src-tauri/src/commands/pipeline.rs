use super::sidecar::{job_work_dir, run_node_cli_streaming, to_node_path};
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
    /// Optional commercial / sponsor clip inserted after Round 1 in the final video.
    pub commercial_path: Option<String>,
    pub commercial_label: Option<String>,
    /// Duration in seconds when commercial is a still image (ignored for video).
    pub commercial_seconds: Option<f64>,
    /// FFmpeg video codec for HLAE + assemble (CPU / NVENC / AMF)
    pub video_codec: Option<String>,
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

fn estimated_chapters(
    parse: &Value,
    steam_id: &str,
    rounds: &[u32],
    intro_seconds: f64,
    commercial_after_r1: bool,
    commercial_seconds: f64,
    commercial_label: &str,
) -> String {
    let mut lines = Vec::new();
    let mut cursor = 0.0_f64;
    lines.push(format!("{} Lobby", format_ts(cursor)));
    cursor += intro_seconds;

    let player_rounds = parse
        .get("player_rounds")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for (index, round_number) in rounds.iter().enumerate() {
        let row = player_rounds.iter().find(|entry| {
            entry.get("steam_id").and_then(|v| v.as_str()) == Some(steam_id)
                && entry.get("round_number").and_then(|v| v.as_u64()) == Some(u64::from(*round_number))
        });
        let duration = row
            .and_then(|entry| entry.get("estimated_clip_seconds"))
            .and_then(|v| v.as_f64())
            .unwrap_or(30.0);
        lines.push(format!(
            "{} {}",
            format_ts(cursor),
            row.and_then(|entry| entry.get("chapter_label"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Round {round_number}"))
        ));
        cursor += duration;

        if commercial_after_r1 && index == 0 {
            lines.push(format!("{} {commercial_label}", format_ts(cursor)));
            cursor += commercial_seconds.max(1.0);
        }
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
        None => job_work_dir(&format!("{safe_player}-{map}")),
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
    let video_codec = request
        .video_codec
        .as_deref()
        .unwrap_or("libx264")
        .to_string();
    config_args.push(OsString::from("--video-codec"));
    config_args.push(OsString::from(&video_codec));
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
    let commercial_label = request
        .commercial_label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Sponsors")
        .to_string();
    let commercial_seconds = request.commercial_seconds.unwrap_or(5.0).max(1.0);
    let commercial_path = request.commercial_path.as_ref().and_then(|path| {
        let p = PathBuf::from(path);
        if p.is_file() {
            Some(to_node_path(p))
        } else {
            None
        }
    });
    if let Some(path) = &request.commercial_path {
        if commercial_path.is_none() {
            emit_log(
                &app,
                &mut logs,
                format!("Commercial clip not found (ignored): {path}"),
            );
        }
    }
    let has_commercial = commercial_path.is_some();
    let commercial_is_image = commercial_path
        .as_ref()
        .and_then(|p| p.extension())
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif"
            )
        })
        .unwrap_or(false);
    // Dry-run chapter estimate: exact for stills; placeholder for video duration.
    let estimated_ad_seconds = if commercial_is_image {
        commercial_seconds
    } else {
        15.0
    };
    let mut chapters_text = estimated_chapters(
        &request.parse_result,
        &request.steam_id,
        &request.rounds,
        intro_seconds,
        has_commercial,
        estimated_ad_seconds,
        &commercial_label,
    );
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
            OsString::from("--fade-seconds"),
            OsString::from("0.5"),
            OsString::from("--video-codec"),
            OsString::from(&video_codec),
        ];
        emit_log(
            &app,
            &mut logs,
            format!("Assemble / HLAE video codec: {video_codec}"),
        );
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
        if let Some(commercial) = &commercial_path {
            assemble_args.push(OsString::from("--commercial"));
            assemble_args.push(commercial.as_os_str().to_os_string());
            assemble_args.push(OsString::from("--commercial-label"));
            assemble_args.push(OsString::from(&commercial_label));
            assemble_args.push(OsString::from("--commercial-seconds"));
            assemble_args.push(OsString::from(commercial_seconds.to_string()));
            emit_log(
                &app,
                &mut logs,
                format!(
                    "Commercial placement after Round 1: {} ({}, {}s if image)",
                    commercial.display(),
                    commercial_label,
                    commercial_seconds
                ),
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
        let round_labels: Vec<String> = request
            .rounds
            .iter()
            .map(|round_number| {
                let player_rounds = request
                    .parse_result
                    .get("player_rounds")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                player_rounds
                    .iter()
                    .find(|entry| {
                        entry.get("steam_id").and_then(|v| v.as_str()) == Some(request.steam_id.as_str())
                            && entry.get("round_number").and_then(|v| v.as_u64())
                                == Some(u64::from(*round_number))
                    })
                    .and_then(|entry| entry.get("chapter_label"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("Round {round_number}"))
            })
            .collect();
        let labels_joined = round_labels.join("|");
        let mut chapter_args = vec![
            OsString::from("--assemble-json"),
            result_json.as_os_str().to_os_string(),
            OsString::from("--out"),
            chapters_file.as_os_str().to_os_string(),
        ];
        if !labels_joined.is_empty() {
            chapter_args.push(OsString::from("--round-labels"));
            chapter_args.push(OsString::from(&labels_joined));
        }
        let chapters_out = stream_cli(
            &app,
            &mut logs,
            "packages/chapters/src/cli.js",
            &chapter_args,
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
