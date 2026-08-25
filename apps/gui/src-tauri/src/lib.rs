mod commands;

use commands::faceit::{
    download_faceit_demo, generate_faceit_lobby_screenshot, get_faceit_settings,
    list_faceit_best_matches, list_tracked_players, remove_tracked_player, save_faceit_api_key,
    upsert_tracked_player,
};
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
            propose_thumbnail_screenshots,
            get_faceit_settings,
            save_faceit_api_key,
            list_tracked_players,
            upsert_tracked_player,
            remove_tracked_player,
            list_faceit_best_matches,
            download_faceit_demo,
            generate_faceit_lobby_screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
