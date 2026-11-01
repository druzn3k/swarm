//! Swarm Simulator save formats (`rust/PLAN.md` section 5).
//!
//! Both formats decode to a [`swarm_engine::State`]; neither runs backfill.
//! Hand the state to [`Engine::load`] (which does), or use [`load`] /
//! [`load_legacy`], which compose the two.
//!
//! # Format v2
//!
//! ```text
//! "SW2|" + LZString.compressToBase64(json)
//! ```
//!
//! `json` is a [`v2::SaveV2`] object:
//!
//! ```text
//! {
//!   "format": 2,                       // bumped only for incompatible changes
//!   "game_version": "0.1.0",           // swarm-save version that wrote it
//!   "data_schema": 1,                  // gamedata.json "schema"
//!   "dates": {"started": ms, "restarted": ms|null, "reified": ms,
//!             "saved": ms|null, "loaded": ms|null, "closed": ms|null, "other": {key: ms}},
//!   "skipped_ms": 0,
//!   "units":    {"meat": "253232.571", "drone": "1.2345678901234567e+300", ...},
//!   "upgrades": {"hatchery": "81", ...},
//!   "achievements": {"drone1": 29403, ...},  // ms since dates.started
//!   "watched":  {"dronetwin": -1, ...},
//!   "timers":   {"crystal": ms, ...},        // legacy addUnitTimed-<unit> dates
//!   "statistics": {"clicks": 3, "byUnit": {...}, "byUpgrade": {...}},
//!   "options": {...},                        // opaque UI bag
//!   "version": {"started": "1.1.14", "saved": "1.1.17"} | null,
//!   "flags": {"kongregate": true},
//!   ...                                      // unknown keys, kept and written back
//! }
//! ```
//!
//! Dates are epoch milliseconds. Numbers are decimal.js-style strings with
//! every digit of the `f64` mantissa ([`num_text`]), so a v2 round trip is
//! bit-identical, and JS can read them with decimal.js. Units and upgrades
//! are keyed by name: a save survives reordered game data, and unknown names
//! are kept, never dropped. lz-string base64 keeps the text clipboard- and
//! URL-friendly; whitespace is ignored on decode.
//!
//! The first bytes tell the formats apart ([`detect`]): `SW2|` is v2;
//! `<base64>|Q2hlYXRlciA6KAoK` or a bare `Q2hlYXRlciA6KAoK` is v1.
//!
//! **Versioning.** `format` is bumped only for incompatible changes;
//! compatible additions are new keys with defaults (and old readers keep
//! unknown keys). Decoding runs [`v2::migrate`] on the raw
//! `serde_json::Value` first: each step in [`v2::MIGRATIONS`] turns format
//! `n` into `n + 1`, then the object is decoded as [`v2::SaveV2`]. A save
//! with a newer `format` is refused ([`v2::V2Error::TooNew`]) rather than
//! misread. Game data changes such as renamed units belong in a rename table
//! in `swarm-data` (there is none yet); a different `data_schema` only
//! produces a warning.
//!
//! # Legacy (v1)
//!
//! [`legacy::decode`] reads saves of the CoffeeScript game and the TS
//! engine, validating versions like `Session._loads`;
//! `legacy::encode` (feature `legacy-write`) writes them.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod date;
pub mod legacy;
pub mod lz;
pub mod num_text;
pub mod v2;

use std::fmt;

use swarm_data::GameData;
use swarm_engine::state::DEFAULT_VERSION;
use swarm_engine::{Engine, LoadOutcome, State};

pub use legacy::{LegacyDecoded, LegacyError};
pub use v2::{decode_v2, encode_v2, SaveV2, V2Decoded, V2Error};

/// A save format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// The TS/Coffee format ([`legacy`]).
    V1,
    /// [`v2`].
    V2,
}

/// Which format `text` is in, from its first bytes (whitespace ignored), or
/// `None` if it is neither.
pub fn detect(text: &str) -> Option<Format> {
    let start: String = text
        .chars()
        .filter(|c| !c.is_whitespace())
        .take(4)
        .collect();
    if start == v2::V2_PREFIX {
        Some(Format::V2)
    } else if legacy::is_legacy(text) {
        Some(Format::V1)
    } else {
        None
    }
}

/// A decoded save of either format.
#[derive(Clone, Debug, PartialEq)]
pub struct Decoded {
    /// The game state, before backfill.
    pub state: State,
    /// The format it was in.
    pub format: Format,
    /// Non-fatal problems found while decoding.
    pub warnings: Vec<String>,
}

/// Why a save could not be decoded or loaded.
#[derive(Clone, Debug, PartialEq)]
pub enum SaveError {
    /// The text is neither a v1 nor a v2 save.
    Unrecognized,
    /// A v1 save was rejected.
    Legacy(LegacyError),
    /// A v2 save was rejected.
    V2(V2Error),
    /// The engine refused the state.
    Load(swarm_engine::LoadError),
}

impl fmt::Display for SaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SaveError::Unrecognized => f.write_str("not a Swarm Simulator save"),
            SaveError::Legacy(e) => e.fmt(f),
            SaveError::V2(e) => e.fmt(f),
            SaveError::Load(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for SaveError {}

impl From<LegacyError> for SaveError {
    fn from(e: LegacyError) -> SaveError {
        SaveError::Legacy(e)
    }
}

impl From<V2Error> for SaveError {
    fn from(e: V2Error) -> SaveError {
        SaveError::V2(e)
    }
}

impl From<swarm_engine::LoadError> for SaveError {
    fn from(e: swarm_engine::LoadError) -> SaveError {
        SaveError::Load(e)
    }
}

/// Decodes a save of either format ([`detect`]).
pub fn decode_any(text: &str) -> Result<Decoded, SaveError> {
    match detect(text) {
        Some(Format::V2) => {
            let d = decode_v2(text)?;
            Ok(Decoded {
                state: d.state,
                format: Format::V2,
                warnings: d.warnings,
            })
        }
        Some(Format::V1) => {
            let d = legacy::decode(text)?;
            Ok(Decoded {
                state: d.state,
                format: Format::V1,
                warnings: d.warnings,
            })
        }
        None => Err(SaveError::Unrecognized),
    }
}

/// Stamps a state for saving, like TS `session._saves`: `dates.saved` is
/// `wall_now_ms`, `dates.loaded` is cleared, and `version.saved` becomes
/// the TS game version (when there is a `version`).
pub fn prepare_save(state: &mut State, wall_now_ms: i64) {
    state.dates.saved = Some(wall_now_ms);
    state.dates.loaded = None;
    if let Some(v) = &mut state.version {
        v.saved = Some(DEFAULT_VERSION.to_owned());
    }
}

/// The engine's game as a v2 save at `wall_now_ms` ([`prepare_save`], then
/// [`encode_v2`]).
pub fn export_v2(engine: &Engine, wall_now_ms: i64) -> String {
    let mut state = engine.state().clone();
    prepare_save(&mut state, wall_now_ms);
    encode_v2(&state)
}

fn load_state(
    data: &'static GameData,
    state: State,
    mut warnings: Vec<String>,
    wall_now_ms: i64,
    heartbeat_ms: Option<i64>,
) -> Result<LoadOutcome, SaveError> {
    let mut out = Engine::load(data, state, wall_now_ms, heartbeat_ms)?;
    warnings.append(&mut out.warnings);
    out.warnings = warnings;
    Ok(out)
}

/// Decodes a v1 save and loads it ([`legacy::decode`] then
/// [`Engine::load`], which runs backfill and computes the offline time
/// from the save's dates and `heartbeat_ms`). Decoder warnings come first
/// in [`LoadOutcome::warnings`].
pub fn load_legacy(
    data: &'static GameData,
    text: &str,
    wall_now_ms: i64,
    heartbeat_ms: Option<i64>,
) -> Result<LoadOutcome, SaveError> {
    let d = legacy::decode(text)?;
    load_state(data, d.state, d.warnings, wall_now_ms, heartbeat_ms)
}

/// Decodes a save of either format ([`decode_any`]) and loads it like
/// [`load_legacy`].
pub fn load(
    data: &'static GameData,
    text: &str,
    wall_now_ms: i64,
    heartbeat_ms: Option<i64>,
) -> Result<LoadOutcome, SaveError> {
    let d = decode_any(text)?;
    load_state(data, d.state, d.warnings, wall_now_ms, heartbeat_ms)
}
