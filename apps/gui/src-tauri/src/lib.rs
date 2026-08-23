mod commands;

use commands::open_path::open_in_explorer;
use commands::parse_demo::parse_demo;
use commands::pipeline::run_pipeline;
use commands::prerequisites::check_prerequisites;
use commands::thumbnails::{generate_thumbnails, propose_thumbnail_screenshots};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_prerequisites,
            parse_demo,
            run_pipeline,
            open_in_explorer,
            generate_thumbnails,
            propose_thumbnail_screenshots
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
