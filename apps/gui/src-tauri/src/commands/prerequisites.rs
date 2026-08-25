use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisiteItem {
    pub id: String,
    pub label: String,
    pub required: bool,
    pub found: bool,
    pub path: Option<String>,
    pub install_url: Option<String>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisitesReport {
    pub os_supported: bool,
    pub os_name: String,
    pub cpu_name: Option<String>,
    pub gpu_name: Option<String>,
    pub items: Vec<PrerequisiteItem>,
    pub ready_for_parse: bool,
    pub ready_for_render: bool,
}

fn which(binary: &str) -> Option<PathBuf> {
    let path_env = env::var_os("PATH")?;
    for dir in env::split_paths(&path_env) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            for ext in [".exe", ".cmd", ".bat"] {
                let with_ext = dir.join(format!("{binary}{ext}"));
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn expand_user(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix('~') {
        if let Some(home) = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")) {
            return PathBuf::from(home).join(rest.trim_start_matches(['\\', '/']));
        }
    }
    PathBuf::from(path)
}

fn detect_cs2() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    let steam_roots = [
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        r"D:\Steam",
        r"D:\SteamLibrary",
        r"E:\SteamLibrary",
    ];

    for root in steam_roots {
        candidates.push(
            Path::new(root)
                .join(r"steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"),
        );
    }

    // Library folders from registry-style default Steam path
    if let Ok(steam_path) = env::var("STEAM_PATH") {
        candidates.push(
            Path::new(&steam_path)
                .join(r"steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"),
        );
    }

    first_existing(&candidates)
}

fn detect_csdm() -> Option<PathBuf> {
    if let Some(from_path) = which("csdm") {
        return Some(from_path);
    }

    let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let mut candidates = Vec::new();
    if let Some(local) = local_app_data {
        // Official installer uses cs-demo-manager + csdm.cmd (not csdm.exe)
        candidates.push(local.join(r"Programs\cs-demo-manager\csdm.cmd"));
        candidates.push(local.join(r"Programs\CS Demo Manager\csdm.cmd"));
        candidates.push(local.join(r"Programs\cs-demo-manager\csdm.exe"));
        candidates.push(local.join(r"Programs\CS Demo Manager\csdm.exe"));
    }
    candidates.push(expand_user(
        r"~\AppData\Local\Programs\cs-demo-manager\csdm.cmd",
    ));
    first_existing(&candidates)
}

fn detect_hlae() -> Option<PathBuf> {
    if let Some(from_path) = which("HLAE") {
        return Some(from_path);
    }

    let mut candidates = Vec::new();

    // Standalone installer
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\HLAE\HLAE.exe"));
    candidates.push(PathBuf::from(r"C:\Program Files\HLAE\HLAE.exe"));
    candidates.push(PathBuf::from(r"C:\HLAE\HLAE.exe"));

    // CSDM-managed install (user profile)
    candidates.push(expand_user(r"~\.csdm\hlae\HLAE.exe"));

    if let Some(local) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        candidates.push(local.join(r"cs-demo-manager\hlae\HLAE.exe"));
        candidates.push(local.join(r"CS Demo Manager\hlae\HLAE.exe"));
        candidates.push(local.join(r"Advancedfx\HLAE\HLAE.exe"));
        candidates.push(local.join(r"Programs\HLAE\HLAE.exe"));
    }
    if let Some(roaming) = env::var_os("APPDATA").map(PathBuf::from) {
        candidates.push(roaming.join(r"advancedfx\hlae\HLAE.exe"));
        candidates.push(roaming.join(r"HLAE\HLAE.exe"));
    }

    first_existing(&candidates)
}

fn detect_ffmpeg() -> Option<PathBuf> {
    which("ffmpeg")
}

fn detect_steam_exe() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(steam_path) = env::var("STEAM_PATH") {
        candidates.push(PathBuf::from(steam_path).join("steam.exe"));
    }
    for root in [
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        r"D:\Steam",
        r"E:\Steam",
    ] {
        candidates.push(Path::new(root).join("steam.exe"));
    }
    first_existing(&candidates)
}

/// True when the Steam client process is running (required by CSDM video).
fn is_steam_running() -> bool {
    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
            .output()
            .ok();
        if let Some(out) = output {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            return text.contains("steam.exe");
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn detect_node() -> Option<PathBuf> {
    which("node")
}

fn node_version(node: &Path) -> Option<String> {
    let output = Command::new(node).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run a short PowerShell one-liner and return trimmed stdout (Windows only).
#[cfg(windows)]
fn powershell_stdout(script: &str) -> Option<String> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(not(windows))]
fn powershell_stdout(_script: &str) -> Option<String> {
    None
}

fn detect_cpu_name() -> Option<String> {
    let raw = powershell_stdout("(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)")?;
    let cleaned = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Prefer a discrete AMD/NVIDIA adapter when present; otherwise first adapter.
fn detect_gpu_name() -> Option<String> {
    let raw = powershell_stdout(
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
    )?;
    let names: Vec<String> = raw
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect();
    if names.is_empty() {
        return None;
    }

    let preferred = names.iter().find(|name| {
        let lower = name.to_lowercase();
        (lower.contains("nvidia") || lower.contains("amd") || lower.contains("radeon"))
            && !lower.contains("microsoft")
            && !lower.contains("basic display")
    });
    preferred.or(names.first()).cloned()
}

#[tauri::command]
pub fn check_prerequisites() -> PrerequisitesReport {
    let os_supported = cfg!(target_os = "windows");
    let os_name = env::consts::OS.to_string();
    let cpu_name = detect_cpu_name();
    let gpu_name = detect_gpu_name();

    let node = detect_node();
    let node_path = node.as_ref().map(|p| p.display().to_string());
    let node_hint = node
        .as_ref()
        .and_then(|p| node_version(p))
        .map(|v| format!("Detected {v}"));

    let cs2 = detect_cs2();
    let csdm = detect_csdm();
    let hlae = detect_hlae();
    let ffmpeg = detect_ffmpeg();
    let steam_exe = detect_steam_exe();
    let steam_running = is_steam_running();

    let items = vec![
        PrerequisiteItem {
            id: "windows".into(),
            label: "Windows".into(),
            required: true,
            found: os_supported,
            path: None,
            install_url: None,
            hint: if os_supported {
                Some("CS2 + HLAE require Windows.".into())
            } else {
                Some("This app only runs on Windows (CS2 + HLAE).".into())
            },
        },
        PrerequisiteItem {
            id: "node".into(),
            label: "Node.js (≥ 20)".into(),
            required: true,
            found: node.is_some(),
            path: node_path,
            install_url: Some("https://nodejs.org/".into()),
            hint: node_hint.or(Some(
                "Required to run the demo-parser sidecar.".into(),
            )),
        },
        PrerequisiteItem {
            id: "cs2".into(),
            label: "Counter-Strike 2".into(),
            required: false,
            found: cs2.is_some(),
            path: cs2.as_ref().map(|p| p.display().to_string()),
            install_url: Some("https://store.steampowered.com/app/730/".into()),
            hint: Some("Needed for video recording (step 5+).".into()),
        },
        PrerequisiteItem {
            id: "steam".into(),
            label: "Steam (en cours)".into(),
            required: false,
            found: steam_running,
            path: steam_exe.as_ref().map(|p| p.display().to_string()),
            install_url: Some("https://store.steampowered.com/about/".into()),
            hint: Some(
                if steam_running {
                    "Steam is running — OK for csdm video.".into()
                } else {
                    "Launch Steam and stay logged in before recording (csdm video).".into()
                },
            ),
        },
        PrerequisiteItem {
            id: "csdm".into(),
            label: "CS Demo Manager".into(),
            required: false,
            found: csdm.is_some(),
            path: csdm.as_ref().map(|p| p.display().to_string()),
            install_url: Some("https://cs-demo-manager.com/download".into()),
            hint: Some("Needed for HLAE-driven POV capture.".into()),
        },
        PrerequisiteItem {
            id: "hlae".into(),
            label: "HLAE".into(),
            required: false,
            found: hlae.is_some(),
            path: hlae.as_ref().map(|p| p.display().to_string()),
            install_url: Some("https://github.com/advancedfx/advancedfx/releases".into()),
            hint: Some("CSDM can download HLAE automatically if missing.".into()),
        },
        PrerequisiteItem {
            id: "ffmpeg".into(),
            label: "FFmpeg".into(),
            required: false,
            found: ffmpeg.is_some(),
            path: ffmpeg.as_ref().map(|p| p.display().to_string()),
            install_url: Some("https://ffmpeg.org/download.html".into()),
            hint: Some("Needed to assemble intro + round clips.".into()),
        },
    ];

    let ready_for_parse = os_supported && node.is_some();
    let ready_for_render = ready_for_parse && cs2.is_some() && csdm.is_some() && ffmpeg.is_some();

    PrerequisitesReport {
        os_supported,
        os_name,
        cpu_name,
        gpu_name,
        items,
        ready_for_parse,
        ready_for_render,
    }
}
