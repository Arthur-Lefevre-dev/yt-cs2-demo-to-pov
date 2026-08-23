use super::sidecar::to_node_path;
use std::path::PathBuf;
use std::process::Command;

/// Open a folder in Explorer, or select a file in its parent folder.
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let path = to_node_path(PathBuf::from(path.trim()));
    if !path.exists() {
        return Err(format!("Path not found: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        let status = if path.is_dir() {
            Command::new("explorer")
                .arg(path.as_os_str())
                .spawn()
                .map_err(|err| format!("Failed to open Explorer: {err}"))?
        } else {
            // /select,<path> highlights the file in its parent folder
            Command::new("explorer")
                .arg(format!("/select,{}", path.display()))
                .spawn()
                .map_err(|err| format!("Failed to open Explorer: {err}"))?
        };
        let _ = status;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("open_in_explorer is only supported on Windows.".into())
    }
}
