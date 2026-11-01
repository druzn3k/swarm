//! Save format v2. See the [crate docs](crate) for the layout and the
//! versioning rules.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use swarm_engine::state::{
    Dates, State, Statistics, UnitStatistics, UpgradeStatistics, VersionInfo,
};
use swarm_num::Num;

use crate::lz;
use crate::num_text::exact;

/// The text prefix of a v2 save. `S`, `W` and `2` are base64 characters, but
/// a v1 save has `Q2hlYXRlciA6KAoK` right after its `|`, and lz-string
/// output of a JSON object starts with `N4Ig`, so the two never collide.
pub const V2_PREFIX: &str = "SW2|";

/// The format number this crate writes. Bumped only for incompatible
/// changes; additions go through `#[serde(default)]` and the unknown-key
/// bag instead.
pub const FORMAT: u32 = 2;

/// A migration from format `n` to `n + 1`, on the raw JSON object.
pub type Migration = fn(&mut Map<String, Value>) -> Result<(), String>;

/// `MIGRATIONS[i]` turns format `FIRST_FORMAT + i` into the next one. Empty
/// while format 2 is the only v2 format.
pub const MIGRATIONS: &[Migration] = &[];

/// The oldest format [`MIGRATIONS`] starts from.
pub const FIRST_FORMAT: u32 = 2;

/// The v2 save, field for field. Units, upgrades and the rest are keyed by
/// name, so the save survives reordered game data, and unknown names are
/// kept. Decimal values are lossless decimal.js-style strings (see
/// [`crate::num_text`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SaveV2 {
    /// [`FORMAT`].
    pub format: u32,
    /// The `swarm-save` crate version that wrote the save.
    pub game_version: String,
    /// The `schema` of the game data the save was written with
    /// ([`swarm_data::SCHEMA_VERSION`]).
    pub data_schema: u32,
    /// Epoch ms: `started`, `restarted`, `reified`, `saved` (when the save
    /// was written), `closed` (when the game was last seen running), and
    /// unknown date keys.
    #[serde(default)]
    pub dates: Dates,
    /// Total milliseconds skipped (swarmwarp).
    #[serde(default)]
    pub skipped_ms: i64,
    /// Unit counts as of `dates.reified`.
    #[serde(default)]
    pub units: BTreeMap<String, ExactNum>,
    /// Upgrade levels.
    #[serde(default)]
    pub upgrades: BTreeMap<String, ExactNum>,
    /// Earned achievements: ms since `dates.started`.
    #[serde(default)]
    pub achievements: BTreeMap<String, i64>,
    /// Upgrade watch levels.
    #[serde(default)]
    pub watched: BTreeMap<String, i32>,
    /// `addUnitTimed` timers: unit -> epoch ms.
    #[serde(default)]
    pub timers: BTreeMap<String, i64>,
    /// Purchase statistics.
    #[serde(default)]
    pub statistics: StatisticsV2,
    /// The UI's options bag, round-tripped untouched.
    #[serde(default)]
    pub options: Map<String, Value>,
    /// The legacy `version` object (versions that started and last saved
    /// the game, as the TS engine records them).
    #[serde(default)]
    pub version: Option<VersionInfo>,
    /// Platform flags.
    #[serde(default)]
    pub flags: Flags,
    /// Unknown keys (from newer writers, or unknown top-level keys of a
    /// converted v1 save), kept and written back.
    #[serde(flatten)]
    pub unknown: BTreeMap<String, Value>,
}

/// Platform flags.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Flags {
    /// Set on Kongregate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kongregate: Option<bool>,
}

/// [`Statistics`] with lossless numbers.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[allow(missing_docs)]
pub struct StatisticsV2 {
    pub clicks: u64,
    pub by_unit: BTreeMap<String, UnitStatisticsV2>,
    pub by_upgrade: BTreeMap<String, UpgradeStatisticsV2>,
}

/// [`UnitStatistics`] with lossless numbers.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[allow(missing_docs)]
pub struct UnitStatisticsV2 {
    pub clicks: u64,
    pub num: ExactNum,
    pub twinnum: ExactNum,
    pub elapsed_first: Option<i64>,
}

/// [`UpgradeStatistics`] with lossless numbers.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[allow(missing_docs)]
pub struct UpgradeStatisticsV2 {
    pub clicks: u64,
    pub num: ExactNum,
    pub elapsed_first: Option<i64>,
}

/// A [`Num`] that serialises losslessly ([`crate::num_text::exact`]) and
/// reads any decimal string or JSON number.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ExactNum(pub Num);

impl Serialize for ExactNum {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&exact(&self.0))
    }
}

impl<'de> Deserialize<'de> for ExactNum {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<ExactNum, D::Error> {
        Num::deserialize(d).map(ExactNum)
    }
}

fn exact_map(m: &BTreeMap<String, Num>) -> BTreeMap<String, ExactNum> {
    m.iter().map(|(k, v)| (k.clone(), ExactNum(*v))).collect()
}

fn num_map(m: BTreeMap<String, ExactNum>) -> BTreeMap<String, Num> {
    m.into_iter().map(|(k, v)| (k, v.0)).collect()
}

/// The top-level keys of [`SaveV2`]; unknown keys with these names cannot
/// be written back and are dropped.
const FIELDS: &[&str] = &[
    "format",
    "game_version",
    "data_schema",
    "dates",
    "skipped_ms",
    "units",
    "upgrades",
    "achievements",
    "watched",
    "timers",
    "statistics",
    "options",
    "version",
    "flags",
];

impl SaveV2 {
    /// Wraps a state, stamped with this crate's version and data schema.
    pub fn from_state(state: &State) -> SaveV2 {
        let s = &state.statistics;
        SaveV2 {
            format: FORMAT,
            game_version: env!("CARGO_PKG_VERSION").to_owned(),
            data_schema: swarm_data::SCHEMA_VERSION,
            dates: state.dates.clone(),
            skipped_ms: state.skipped_ms,
            units: exact_map(&state.units),
            upgrades: exact_map(&state.upgrades),
            achievements: state.achievements.clone(),
            watched: state.watched.clone(),
            timers: state.timers.clone(),
            statistics: StatisticsV2 {
                clicks: s.clicks,
                by_unit: s
                    .by_unit
                    .iter()
                    .map(|(k, u)| {
                        let v = UnitStatisticsV2 {
                            clicks: u.clicks,
                            num: ExactNum(u.num),
                            twinnum: ExactNum(u.twinnum),
                            elapsed_first: u.elapsed_first,
                        };
                        (k.clone(), v)
                    })
                    .collect(),
                by_upgrade: s
                    .by_upgrade
                    .iter()
                    .map(|(k, u)| {
                        let v = UpgradeStatisticsV2 {
                            clicks: u.clicks,
                            num: ExactNum(u.num),
                            elapsed_first: u.elapsed_first,
                        };
                        (k.clone(), v)
                    })
                    .collect(),
            },
            options: state.options.clone(),
            version: state.version.clone(),
            flags: Flags {
                kongregate: state.kongregate,
            },
            unknown: state
                .unknown
                .iter()
                .filter(|(k, _)| !FIELDS.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }

    /// The state inside.
    pub fn into_state(self) -> State {
        let s = self.statistics;
        State {
            units: num_map(self.units),
            upgrades: num_map(self.upgrades),
            dates: self.dates,
            timers: self.timers,
            skipped_ms: self.skipped_ms,
            achievements: self.achievements,
            watched: self.watched,
            statistics: Statistics {
                clicks: s.clicks,
                by_unit: s
                    .by_unit
                    .into_iter()
                    .map(|(k, u)| {
                        let v = UnitStatistics {
                            clicks: u.clicks,
                            num: u.num.0,
                            twinnum: u.twinnum.0,
                            elapsed_first: u.elapsed_first,
                        };
                        (k, v)
                    })
                    .collect(),
                by_upgrade: s
                    .by_upgrade
                    .into_iter()
                    .map(|(k, u)| {
                        let v = UpgradeStatistics {
                            clicks: u.clicks,
                            num: u.num.0,
                            elapsed_first: u.elapsed_first,
                        };
                        (k, v)
                    })
                    .collect(),
            },
            options: self.options,
            version: self.version,
            kongregate: self.flags.kongregate,
            unknown: self.unknown,
        }
    }
}

/// A decoded v2 save.
#[derive(Clone, Debug, PartialEq)]
pub struct V2Decoded {
    /// The game state, before backfill.
    pub state: State,
    /// The format the save was written in (before migration).
    pub format: u32,
    /// The crate version that wrote it.
    pub game_version: String,
    /// The game data schema it was written with.
    pub data_schema: u32,
    /// Non-fatal problems.
    pub warnings: Vec<String>,
}

/// Why a v2 save was rejected.
#[derive(Clone, Debug, PartialEq)]
pub enum V2Error {
    /// The text does not start with [`V2_PREFIX`].
    NotV2,
    /// lz-string decompression failed.
    Decompress,
    /// The JSON is malformed or does not match [`SaveV2`].
    Json(String),
    /// No numeric `format` field.
    NoFormat,
    /// The save is from a newer, incompatible format.
    TooNew(u64),
    /// The save's format is older than any this crate migrates from.
    TooOld(u64),
    /// A migration step failed.
    Migration {
        /// The format the step started from.
        from: u32,
        /// What went wrong.
        error: String,
    },
}

impl fmt::Display for V2Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            V2Error::NotV2 => write!(f, "not a v2 save (no {V2_PREFIX:?} prefix)"),
            V2Error::Decompress => f.write_str("invalid save: lz-string decompression failed"),
            V2Error::Json(e) => write!(f, "invalid save JSON: {e}"),
            V2Error::NoFormat => f.write_str("invalid save: no format number"),
            V2Error::TooNew(n) => write!(
                f,
                "save format {n} is newer than this game supports ({FORMAT}); update the game"
            ),
            V2Error::TooOld(n) => write!(f, "save format {n} is not supported"),
            V2Error::Migration { from, error } => {
                write!(f, "save migration from format {from} failed: {error}")
            }
        }
    }
}

impl std::error::Error for V2Error {}

/// Encodes a state as a v2 save: `"SW2|" + compressToBase64(json)`. The
/// state is written as-is; see [`crate::prepare_save`].
pub fn encode_v2(state: &State) -> String {
    let json = to_json(state);
    format!("{V2_PREFIX}{}", lz::compress_to_base64(&json))
}

/// The v2 JSON text of a state (what [`encode_v2`] compresses).
pub fn to_json(state: &State) -> String {
    serde_json::to_string(&SaveV2::from_state(state)).expect("SaveV2 serialises")
}

/// Runs the [`MIGRATIONS`] on a raw save object, up to [`FORMAT`]. Returns
/// the format the save was in.
pub fn migrate(save: &mut Map<String, Value>) -> Result<u32, V2Error> {
    let format = save
        .get("format")
        .and_then(Value::as_u64)
        .ok_or(V2Error::NoFormat)?;
    if format > u64::from(FORMAT) {
        return Err(V2Error::TooNew(format));
    }
    if format < u64::from(FIRST_FORMAT) {
        return Err(V2Error::TooOld(format));
    }
    let original = format as u32;
    let mut f = original;
    while f < FORMAT {
        let step = MIGRATIONS[(f - FIRST_FORMAT) as usize];
        step(save).map_err(|error| V2Error::Migration { from: f, error })?;
        f += 1;
        save.insert("format".into(), Value::from(f));
    }
    Ok(original)
}

/// Decodes the v2 JSON text (no prefix, not compressed).
pub fn from_json(json: &str) -> Result<V2Decoded, V2Error> {
    let value: Value = serde_json::from_str(json).map_err(|e| V2Error::Json(e.to_string()))?;
    let Value::Object(mut obj) = value else {
        return Err(V2Error::Json("not a JSON object".into()));
    };
    let format = migrate(&mut obj)?;
    let save: SaveV2 =
        serde_json::from_value(Value::Object(obj)).map_err(|e| V2Error::Json(e.to_string()))?;
    let mut warnings = Vec::new();
    if save.data_schema != swarm_data::SCHEMA_VERSION {
        warnings.push(format!(
            "save written with game data schema {}, this game has {}",
            save.data_schema,
            swarm_data::SCHEMA_VERSION
        ));
    }
    Ok(V2Decoded {
        format,
        game_version: save.game_version.clone(),
        data_schema: save.data_schema,
        state: save.into_state(),
        warnings,
    })
}

/// Decodes a v2 save (whitespace is ignored).
pub fn decode_v2(text: &str) -> Result<V2Decoded, V2Error> {
    let text: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let body = text.strip_prefix(V2_PREFIX).ok_or(V2Error::NotV2)?;
    let json = lz::decompress_from_base64(body).ok_or(V2Error::Decompress)?;
    from_json(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_other_formats() {
        let mut m = Map::new();
        assert_eq!(migrate(&mut m), Err(V2Error::NoFormat));
        m.insert("format".into(), Value::from(3));
        assert_eq!(migrate(&mut m), Err(V2Error::TooNew(3)));
        m.insert("format".into(), Value::from(1));
        assert_eq!(migrate(&mut m), Err(V2Error::TooOld(1)));
        m.insert("format".into(), Value::from(2));
        assert_eq!(migrate(&mut m), Ok(2));
    }

    #[test]
    fn keeps_unknown_keys() {
        let mut s = State::new(1);
        s.unknown.insert("mtx".into(), serde_json::json!({"a": 1}));
        s.unknown.insert("units".into(), Value::from(5));
        let json = to_json(&s);
        let back = from_json(&json.replace("\"format\":2", "\"format\":2,\"future\":[1]"))
            .unwrap()
            .state;
        assert_eq!(back.unknown["mtx"], serde_json::json!({"a": 1}));
        assert_eq!(back.unknown["future"], serde_json::json!([1]));
        assert!(!back.unknown.contains_key("units"));
    }
}
