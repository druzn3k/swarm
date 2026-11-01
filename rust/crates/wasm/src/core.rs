//! The boundary in plain Rust: [`GameCore`] and the free functions take and
//! return JSON text and `Num` strings, and fail with the engine's error
//! message. The `wasm-bindgen` layer ([`crate::Game`], wasm32 only) is a thin
//! shell over this module, so everything here is tested natively.

use core::time::Duration;

use serde::{Deserialize, Serialize};
use swarm_data::{GameData, UnitId};
use swarm_engine::{
    Command, CommandEvent, CommandOutcome, Engine, OfflineReport, Sections, ViewRequest,
};
use swarm_num::format::{format_long, format_short};
use swarm_num::Num;
use swarm_save::Format;

/// A boundary error: the message the JS exception carries.
pub type Error = String;

fn data() -> &'static GameData {
    GameData::embedded()
}

/// Converts a JS millisecond timestamp or duration. NaN and infinities are
/// refused rather than saturated.
pub fn ms(v: f64, what: &str) -> Result<i64, Error> {
    if v.is_finite() {
        // saturating, truncating toward zero
        Ok(v as i64)
    } else {
        Err(format!("{what} is not a finite number: {v}"))
    }
}

fn to_json<T: Serialize + ?Sized>(v: &T) -> String {
    // the engine's types serialise infallibly (string keys, no maps with
    // non-string keys)
    serde_json::to_string(v).expect("view types serialise to JSON")
}

/// `"v1"` / `"v2"`.
pub fn format_name(f: Format) -> &'static str {
    match f {
        Format::V1 => "v1",
        Format::V2 => "v2",
    }
}

/// The view request at the boundary: the engine's [`ViewRequest`] plus
/// `upgrades_of`, which scopes [`swarm_engine::View::upgrades`] separately
/// from the units. The engine's `only_units` scopes both, but a frontend
/// usually needs every unit's count and only the upgrades of the units on
/// screen, and the upgrades are most of a view's cost (each one's
/// affordability at 100% and 25%, its progress and cost). With
/// `upgrades_of`, `upgrades` lists the upgrades listed with those units
/// and the focused ones; `buy_all` and `buy_cheapest` still cover every
/// upgrade.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct WasmViewRequest {
    /// The engine's request.
    #[serde(flatten)]
    pub view: ViewRequest,
    /// Units (indices) whose upgrades to list; absent: as `view` says.
    #[serde(default)]
    pub upgrades_of: Option<Vec<u16>>,
}

/// What [`GameCore::load`] reports besides the game: `load_report()` in JS.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LoadReport {
    /// `"v1"`, `"v2"`, or `"new"` for [`GameCore::new_game`].
    pub format: &'static str,
    /// Problems repaired while decoding and loading.
    pub warnings: Vec<String>,
    /// Time away since the save was closed (or the heartbeat).
    pub offline: Option<OfflineReport>,
}

/// [`CommandOutcome`] on the wire. Upgrade ids are `u16` indices into
/// `StaticView.upgrades`; numbers are `Num` strings.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OutcomeJson<'a> {
    /// The command events emitted, in order.
    pub commands: Vec<CommandEventJson<'a>>,
    /// Units bought (`buy_unit`, `buy_max_unit`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bought: Option<BoughtJson>,
    /// Levels bought (`buy_upgrade`, `buy_max_upgrade`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub levels: Option<Num>,
    /// Upgrades `buy_all_upgrades` tried, in order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub upgrades: Vec<u16>,
}

/// A [`CommandEvent`] with its unit/upgrade ids added.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CommandEventJson<'a> {
    /// Unit index, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<u16>,
    /// Upgrade index, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upgrade: Option<u16>,
    /// The event as the engine serialises it.
    #[serde(flatten)]
    pub event: &'a CommandEvent,
}

/// [`swarm_engine::Bought`] on the wire.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct BoughtJson {
    /// Purchases made.
    pub num: Num,
    /// Units received.
    pub twinnum: Num,
}

/// The JSON of a [`CommandOutcome`] ([`OutcomeJson`]).
pub fn outcome_json(o: &CommandOutcome) -> String {
    to_json(&OutcomeJson {
        commands: o
            .commands
            .iter()
            .map(|event| CommandEventJson {
                unit: event.unit.map(|u| u.0),
                upgrade: event.upgrade.map(|g| g.0),
                event,
            })
            .collect(),
        bought: o.bought.map(|b| BoughtJson {
            num: b.num,
            twinnum: b.twinnum,
        }),
        levels: o.levels,
        upgrades: o.upgrades.iter().map(|g| g.0).collect(),
    })
}

/// A running game behind the JSON boundary.
#[derive(Debug)]
pub struct GameCore {
    engine: Engine,
    report: LoadReport,
    /// Sub-millisecond remainder of [`GameCore::advance_ms`] (the engine's
    /// clock is whole milliseconds), so 60 Hz frames don't lose time.
    frac_ms: f64,
}

impl GameCore {
    /// A new game at `wall_now_ms`.
    pub fn new_game(wall_now_ms: f64) -> Result<GameCore, Error> {
        let now = ms(wall_now_ms, "wall_now_ms")?;
        Ok(GameCore {
            engine: Engine::new_game(data(), now),
            report: LoadReport {
                format: "new",
                warnings: Vec::new(),
                offline: None,
            },
            frac_ms: 0.0,
        })
    }

    /// Loads a v1 or v2 save ([`swarm_save::load`]: decode, backfill,
    /// offline time).
    pub fn load(
        save_text: &str,
        wall_now_ms: f64,
        heartbeat_ms: Option<f64>,
    ) -> Result<GameCore, Error> {
        let now = ms(wall_now_ms, "wall_now_ms")?;
        let heartbeat = heartbeat_ms.map(|h| ms(h, "heartbeat_ms")).transpose()?;
        let format = swarm_save::detect(save_text)
            .ok_or_else(|| swarm_save::SaveError::Unrecognized.to_string())?;
        let out = swarm_save::load(data(), save_text, now, heartbeat).map_err(|e| e.to_string())?;
        Ok(GameCore {
            engine: out.engine,
            report: LoadReport {
                format: format_name(format),
                warnings: out.warnings,
                offline: out.offline,
            },
            frac_ms: 0.0,
        })
    }

    /// The engine, for Rust callers.
    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// [`LoadReport`] JSON.
    pub fn load_report(&self) -> String {
        to_json(&self.report)
    }

    /// `StaticView` JSON: send once.
    pub fn static_view(&self) -> String {
        to_json(&self.engine.static_view())
    }

    /// `View` JSON for a [`WasmViewRequest`] JSON (`""` or `"{}"`: the
    /// default request).
    pub fn view(&mut self, request_json: &str) -> Result<String, Error> {
        let req: WasmViewRequest = if request_json.trim().is_empty() {
            WasmViewRequest::default()
        } else {
            serde_json::from_str(request_json).map_err(|e| format!("bad view request: {e}"))?
        };
        let Some(scope) = req.upgrades_of.filter(|_| req.view.sections.upgrades) else {
            return Ok(to_json(&self.engine.view(&req.view)));
        };
        // units (and the rest) first, then the scoped upgrades: the order
        // one engine view queries them in, so sticky visibility is the same
        let mut first = req.view.clone();
        first.sections.upgrades = false;
        let mut view = self.engine.view(&first);
        let mut units: Vec<UnitId> = scope.into_iter().map(UnitId).collect();
        units.extend(req.view.focus.iter().copied());
        units.sort_unstable();
        units.dedup();
        let upgrades = self.engine.view(&ViewRequest {
            only_units: Some(units),
            sections: Sections {
                upgrades: true,
                ..Sections::NONE
            },
            ..req.view
        });
        view.upgrades = upgrades.upgrades;
        view.buy_all = upgrades.buy_all;
        view.buy_cheapest = upgrades.buy_cheapest;
        view.events.extend(upgrades.events);
        Ok(to_json(&view))
    }

    /// Runs a `Command` JSON (`{"do":"buy_unit",...}`); the outcome JSON, or
    /// the engine's error message.
    pub fn apply(&mut self, command_json: &str) -> Result<String, Error> {
        let cmd: Command =
            serde_json::from_str(command_json).map_err(|e| format!("bad command: {e}"))?;
        let outcome = self.engine.apply(cmd).map_err(|e| e.to_string())?;
        Ok(outcome_json(&outcome))
    }

    /// Moves the clock forward by a monotonic delta. Negative and non-finite
    /// deltas are ignored.
    pub fn advance_ms(&mut self, dt_ms: f64) {
        if !(dt_ms.is_finite() && dt_ms > 0.0) {
            return;
        }
        let total = dt_ms + self.frac_ms;
        // the epsilon absorbs float error in the carried remainder
        let whole = (total + 1e-6).floor();
        self.frac_ms = (total - whole).max(0.0);
        if whole >= 1.0 {
            self.engine
                .advance(Duration::from_millis(whole.min(u64::MAX as f64) as u64));
        }
    }

    /// After a suspend or hidden tab: adds the wall-clock gap; the
    /// `OfflineReport` JSON if there was one. A long enough gap also sets
    /// the view's `welcome_back` ([`swarm_engine::Engine::resync_wall`]).
    pub fn resync_wall(&mut self, wall_now_ms: f64) -> Result<Option<String>, Error> {
        let now = ms(wall_now_ms, "wall_now_ms")?;
        Ok(self.engine.resync_wall(now).map(|r| to_json(&r)))
    }

    /// Records that the game was closed (heartbeat, `pagehide`).
    pub fn mark_closed(&mut self, wall_now_ms: f64) -> Result<(), Error> {
        let now = ms(wall_now_ms, "wall_now_ms")?;
        self.engine.mark_closed(now);
        Ok(())
    }

    /// The game as a v2 save stamped at `wall_now_ms`.
    pub fn export_v2(&self, wall_now_ms: f64) -> Result<String, Error> {
        let now = ms(wall_now_ms, "wall_now_ms")?;
        Ok(swarm_save::export_v2(&self.engine, now))
    }

    /// The game as a v1 save the TS/Coffee game can import.
    #[cfg(feature = "legacy-write")]
    pub fn export_legacy(&self, wall_now_ms: f64) -> Result<String, Error> {
        let now = ms(wall_now_ms, "wall_now_ms")?;
        let mut state = self.engine.state().clone();
        swarm_save::prepare_save(&mut state, now);
        Ok(swarm_save::legacy::encode(&state))
    }

    /// The UI's part of the saved state, which the engine keeps but never
    /// reads: `{"options": {...}, "unknown": {...}}`, the options bag
    /// ([`Command::SetOption`] writes it) and the save's unknown top-level
    /// keys (e.g. an older app's `achievementsShown`).
    pub fn ui_state(&self) -> String {
        let state = self.engine.state();
        to_json(&serde_json::json!({
            "options": state.options,
            "unknown": state.unknown,
        }))
    }

    /// A unit's stats and production, `{"stats": [[stat, num], ...],
    /// "each_production": [[unit, num], ...], "total_production": [...]}`,
    /// whether or not the unit is visible. The view's `UnitDetail` has the
    /// same fields, but only for visible focused units; this reaches the
    /// hidden ones the descriptions read (`invisiblehatchery`, which owns
    /// the hatchery and expansion upgrades and their mutagen stats).
    pub fn unit_stats(&self, unit_name: &str) -> Result<String, Error> {
        let id = data()
            .unit_id(unit_name)
            .ok_or_else(|| format!("no such unit: {unit_name}"))?;
        let e = &self.engine;
        let stats: Vec<(u16, Num)> = e.stats(id).into_iter().map(|(s, v)| (s.0, v)).collect();
        let ids = |v: Vec<(swarm_data::UnitId, Num)>| -> Vec<(u16, Num)> {
            v.into_iter().map(|(u, n)| (u.0, n)).collect()
        };
        Ok(to_json(&serde_json::json!({
            "stats": stats,
            "each_production": ids(e.each_production(id)),
            "total_production": ids(e.total_production(id)),
        })))
    }

    /// A welcome-back report computed now, for a game closed when the load
    /// report's offline time began (or now, if it has none). With `force`
    /// it is given even after a short absence (the app's `?forcewelcome`
    /// and imports); without, `None` under the engine's minimum. Unlike
    /// [`swarm_engine::View::welcome_back`] it is not stored: the caller
    /// keeps it.
    pub fn welcome_back(&self, force: bool) -> Option<String> {
        let closed = self
            .report
            .offline
            .map_or_else(|| self.engine.now_ms(), |o| o.closed_ms);
        self.engine
            .compute_welcome_back(closed, force)
            .map(|w| to_json(&w))
    }

    /// Player number input (`"1.5k"`, `"50%"`, `"=10"`, `"@100"`) as a `Num`
    /// string, or `None` if unparseable. The `%`/`=`/`@` forms need a unit
    /// name.
    pub fn parse_number(
        &self,
        input: &str,
        unit_name: Option<&str>,
    ) -> Result<Option<String>, Error> {
        let handle = match unit_name {
            Some(name) => {
                let id = data()
                    .unit_id(name)
                    .ok_or_else(|| format!("no such unit: {name}"))?;
                Some(self.engine.unit_handle(id))
            }
            None => None,
        };
        Ok(
            swarm_engine::parse_number::parse_number(input, handle.as_ref().map(|h| h as _))
                .map(|n| n.to_string()),
        )
    }
}

/// Parses a `Num` string (or anything `Num` reads: `"1.5e+21"`, `"123"`).
pub fn parse_num(s: &str) -> Result<Num, Error> {
    s.trim()
        .parse::<Num>()
        .map_err(|e| format!("not a number: {s:?} ({e})"))
}

/// The app's short format (`"1.23M"`).
pub fn format_short_str(num: &str) -> Result<String, Error> {
    Ok(format_short(&parse_num(num)?))
}

/// The app's long format (`"1.23456 million"`).
pub fn format_long_str(num: &str) -> Result<String, Error> {
    Ok(format_long(&parse_num(num)?))
}

/// `"v1"`, `"v2"` or `None`.
pub fn detect_save_format(text: &str) -> Option<&'static str> {
    swarm_save::detect(text).map(format_name)
}

/// Re-encodes a save of either format as `to` (`"v1"` or `"v2"`). The
/// state is decoded and written back unchanged: no backfill, no new dates.
pub fn convert_save(text: &str, to: &str) -> Result<String, Error> {
    let decoded = swarm_save::decode_any(text).map_err(|e| e.to_string())?;
    match to {
        "v2" => Ok(swarm_save::encode_v2(&decoded.state)),
        #[cfg(feature = "legacy-write")]
        "v1" => Ok(swarm_save::legacy::encode(&decoded.state)),
        #[cfg(not(feature = "legacy-write"))]
        "v1" => Err("v1 output needs the legacy-write feature".to_owned()),
        other => Err(format!(
            "unknown save format: {other:?} (expected \"v1\" or \"v2\")"
        )),
    }
}
