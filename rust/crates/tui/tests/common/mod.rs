//! Shared fixtures for the TUI tests.
#![allow(dead_code)]

use std::time::Instant;

use ratatui::backend::TestBackend;
use ratatui::Terminal;
use swarm_data::GameData;
use swarm_tui::App;

pub const SESSION_SAVES: &str =
    include_str!("../../../../../engine/test/fixtures/session-saves.json");

/// 2026-11-01, a fixed "now" for loading fixtures.
pub const NOW: i64 = 1_793_534_400_000;

pub fn session_save(name: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(SESSION_SAVES).unwrap();
    v[name].as_str().unwrap().to_owned()
}

/// A fixture loaded with `swarm_save::load` into an app that never saves.
pub fn app(name: &str, t: Instant) -> App {
    let out = swarm_save::load(GameData::embedded(), &session_save(name), NOW, None).unwrap();
    App::new(out.engine, None, t)
}

/// The late-game fixture: every tab open, many upgrades.
pub fn midgame(t: Instant) -> App {
    app("whitespace", t)
}

/// Renders the app into a `w`×`h` buffer and returns its text.
pub fn render(app: &mut App, w: u16, h: u16) -> String {
    let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
    term.draw(|f| swarm_tui::ui::draw(f, app)).unwrap();
    let buf = term.backend().buffer().clone();
    let mut s = String::new();
    for y in 0..h {
        for x in 0..w {
            s.push_str(buf[(x, y)].symbol());
        }
        s.push('\n');
    }
    s
}
