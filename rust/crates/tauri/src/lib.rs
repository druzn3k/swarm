//! Swarm Simulator's desktop shell: a Tauri 2 window around the built web app
//! (`app/dist`, with the engine compiled to wasm running in the webview), plus
//! two commands that keep the save in the app data directory instead of the
//! webview's localStorage:
//!
//! * `load_save() -> string | null`
//! * `store_save(text: string) -> void` (atomic write, previous save kept as
//!   `save.prev.txt`)
//!
//! The save lives at `<app data dir>/save.txt`, i.e.
//! `$XDG_DATA_HOME/com.swarmsim.desktop/save.txt`
//! (default `~/.local/share/com.swarmsim.desktop/save.txt`).

pub mod store;

use std::path::PathBuf;
use tauri::Manager;

/// File name of the save inside the app data directory.
pub const SAVE_FILE: &str = "save.txt";

fn save_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    Ok(dir.join(SAVE_FILE))
}

/// The current save, or `None` if there isn't one yet.
#[tauri::command]
fn load_save(app: tauri::AppHandle) -> Result<Option<String>, String> {
    store::read_opt(&save_path(&app)?)
}

/// Replaces the save (the previous one becomes `save.prev.txt`).
#[tauri::command]
fn store_save(app: tauri::AppHandle, text: String) -> Result<(), String> {
    store::write_save(&save_path(&app)?, &text)
}

/// Builds and runs the app; returns when the last window closes.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![load_save, store_save])
        .run(tauri::generate_context!())
        .expect("error while running Swarm Simulator");
}
