// No console window on Windows release builds (harmless on Linux, the only target).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    swarm_tauri::run()
}
