//! The `wasm-bindgen` exports: thin wrappers over [`crate::core`].

use wasm_bindgen::prelude::*;

use crate::core::{self, GameCore};

fn js_err(msg: String) -> JsError {
    JsError::new(&msg)
}

/// Installs the panic hook (feature `panic-hook`) when the module starts.
#[wasm_bindgen(start)]
fn start() {
    #[cfg(feature = "panic-hook")]
    console_error_panic_hook::set_once();
}

/// A running game. Every method that takes or returns structured data uses
/// JSON text; see `engine-wasm/README.md`.
#[wasm_bindgen]
pub struct Game {
    inner: GameCore,
}

#[wasm_bindgen]
impl Game {
    /// A new game at `wall_now_ms` (epoch ms).
    pub fn new_game(wall_now_ms: f64) -> Result<Game, JsError> {
        GameCore::new_game(wall_now_ms)
            .map(|inner| Game { inner })
            .map_err(js_err)
    }

    /// Loads a v1 or v2 save; read `load_report()` for warnings and the
    /// offline report. Throws if the text is not a loadable save.
    pub fn load(
        save_text: &str,
        wall_now_ms: f64,
        heartbeat_ms: Option<f64>,
    ) -> Result<Game, JsError> {
        GameCore::load(save_text, wall_now_ms, heartbeat_ms)
            .map(|inner| Game { inner })
            .map_err(js_err)
    }

    /// `{"format":"v1"|"v2"|"new","warnings":[...],"offline":{...}|null}`.
    pub fn load_report(&self) -> String {
        self.inner.load_report()
    }

    /// `StaticView` JSON.
    pub fn static_view(&self) -> String {
        self.inner.static_view()
    }

    /// `View` JSON for a `ViewRequest` JSON (`""` for the default).
    pub fn view(&mut self, request_json: &str) -> Result<String, JsError> {
        self.inner.view(request_json).map_err(js_err)
    }

    /// Runs a `Command` JSON; the outcome JSON. Throws the engine's error
    /// message on failure.
    pub fn apply(&mut self, command_json: &str) -> Result<String, JsError> {
        self.inner.apply(command_json).map_err(js_err)
    }

    /// Moves the clock forward by `dt_ms` (monotonic; negative is ignored).
    pub fn advance_ms(&mut self, dt_ms: f64) {
        self.inner.advance_ms(dt_ms);
    }

    /// `OfflineReport` JSON if the wall clock jumped ahead (suspend), else
    /// `undefined`. After at least `welcome_back_min_ms` away, the view's
    /// `welcome_back` is set too (until `dismiss_welcome_back`), as after a
    /// load.
    pub fn resync_wall(&mut self, wall_now_ms: f64) -> Result<Option<String>, JsError> {
        self.inner.resync_wall(wall_now_ms).map_err(js_err)
    }

    /// Records that the game was closed (heartbeat, `pagehide`).
    pub fn mark_closed(&mut self, wall_now_ms: f64) -> Result<(), JsError> {
        self.inner.mark_closed(wall_now_ms).map_err(js_err)
    }

    /// The game as a v2 save (`SW2|...`).
    pub fn export_v2(&self, wall_now_ms: f64) -> Result<String, JsError> {
        self.inner.export_v2(wall_now_ms).map_err(js_err)
    }

    /// The game as a v1 save the TS/Coffee game can import.
    #[cfg(feature = "legacy-write")]
    pub fn export_legacy(&self, wall_now_ms: f64) -> Result<String, JsError> {
        self.inner.export_legacy(wall_now_ms).map_err(js_err)
    }

    /// `{"options": {...}, "unknown": {...}}`: the UI's options bag and the
    /// save's unknown top-level keys.
    pub fn ui_state(&self) -> String {
        self.inner.ui_state()
    }

    /// `{"stats", "each_production", "total_production"}` of a unit, visible
    /// or not. Throws for unknown names.
    pub fn unit_stats(&self, unit_name: &str) -> Result<String, JsError> {
        self.inner.unit_stats(unit_name).map_err(js_err)
    }

    /// A welcome-back report computed now (`force`: even after a short
    /// absence), or `undefined`. Not stored in the game.
    pub fn welcome_back(&self, force: bool) -> Option<String> {
        self.inner.welcome_back(force)
    }

    /// Player number input as a `Num` string, or `undefined`.
    pub fn parse_number(
        &self,
        input: &str,
        unit_name: Option<String>,
    ) -> Result<Option<String>, JsError> {
        self.inner
            .parse_number(input, unit_name.as_deref())
            .map_err(js_err)
    }
}

/// The app's short number format (`"1.23M"`) of a `Num` string.
#[wasm_bindgen]
pub fn format_short(num: &str) -> Result<String, JsError> {
    core::format_short_str(num).map_err(js_err)
}

/// The app's long number format (`"1.23456 million"`) of a `Num` string.
#[wasm_bindgen]
pub fn format_long(num: &str) -> Result<String, JsError> {
    core::format_long_str(num).map_err(js_err)
}

/// `"v1"`, `"v2"` or `undefined`.
#[wasm_bindgen]
pub fn detect_save_format(text: &str) -> Option<String> {
    core::detect_save_format(text).map(str::to_owned)
}

/// Re-encodes a save as `to` (`"v1"` or `"v2"`), state unchanged.
#[wasm_bindgen]
pub fn convert_save(text: &str, to: &str) -> Result<String, JsError> {
    core::convert_save(text, to).map_err(js_err)
}
