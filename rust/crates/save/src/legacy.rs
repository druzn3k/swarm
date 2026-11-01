//! The legacy (v1) save format of the CoffeeScript game and the TS engine
//! (`engine/src/session.ts`, `swarmsim-coffee/app/scripts/services/session.coffee`):
//!
//! ```text
//! btoa(version) + "|" + btoa("Cheater :(\n\n") + LZString.compressToBase64(JSON.stringify(state))
//! ```
//!
//! [`decode`] follows `Session._loads` step by step (see `rust/PLAN.md`
//! section 5): strip whitespace, split off the latin1-base64 version header,
//! drop the prefix, lz-string-decompress, parse the JSON, validate the save
//! version and the publictest blacklist, read counts (JS numbers through
//! [`legacy_count`], decimal.js strings through `Num::from_str`), turn dates
//! into epoch ms and `addUnitTimed-*` dates into timers, and `watched`
//! booleans into 1/0. It does **not** run backfill: hand the state to
//! [`Engine::load`](swarm_engine::Engine::load) (or use
//! [`crate::load_legacy`]).
//!
//! `encode` (feature `legacy-write`) writes a save the TS engine imports.

use std::collections::BTreeMap;
use std::fmt;

use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use base64::engine::DecodePaddingMode;
use base64::Engine as _;
use serde_json::{Map, Value};
use swarm_engine::state::{
    legacy_count, Dates, State, Statistics, UnitStatistics, UpgradeStatistics, VersionInfo,
    DEFAULT_VERSION,
};
use swarm_num::Num;

use crate::lz;

/// `btoa("Cheater :(\n\n")`: the prefix of every v1 save body.
pub const PREFIX: &str = "Q2hlYXRlciA6KAoK";

/// Separates the base64 version header from the body.
pub const VERSION_DELIM: char = '|';

/// The game version the TS engine runs as, and writes into save headers
/// ([`DEFAULT_VERSION`], `"1.1.17"`). Saves are validated against it.
pub const GAME_VERSION: &str = DEFAULT_VERSION;

/// The date key prefix of `addUnitTimed` timers (`unit.ts:744-761`).
pub const TIMER_PREFIX: &str = "addUnitTimed-";

/// `atob`/`btoa`: standard alphabet, forgiving about padding and trailing
/// bits like the WHATWG forgiving-base64 decoder.
const B64: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// A decoded v1 save.
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyDecoded {
    /// The game state, before backfill.
    pub state: State,
    /// The version in the save's header (`atob` of the part before `|`), if
    /// it had one. Very old saves have none.
    pub format_version: Option<String>,
    /// Things that were repaired or dropped while reading.
    pub warnings: Vec<String>,
}

/// Why a v1 save was rejected. The `Display` strings of the version checks
/// are the TS engine's error messages.
#[derive(Clone, Debug, PartialEq)]
pub enum LegacyError {
    /// The version header is not valid base64 (JS `atob` throws).
    Header(String),
    /// lz-string decompression failed.
    Decompress,
    /// The decompressed text is not JSON.
    Json(String),
    /// The JSON is not a save (not an object, no `date`, ...).
    Shape(String),
    /// `_validateSaveVersion` refused `version.started`.
    SaveVersion(VersionError),
    /// `_validateFormatVersion` refused the header version (publictest).
    FormatVersion(VersionError),
    /// A count that decimal.js would not parse.
    Number {
        /// `unittypes.<name>`, `upgrades.<name>`, ...
        field: String,
        /// The JSON value.
        value: String,
    },
    /// A required date that JS would read as an Invalid Date.
    Date {
        /// The `date` key.
        key: String,
        /// The JSON value.
        value: String,
    },
}

impl fmt::Display for LegacyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LegacyError::Header(e) => write!(f, "invalid save version header: {e}"),
            LegacyError::Decompress => f.write_str("invalid save: lz-string decompression failed"),
            LegacyError::Json(e) => write!(f, "invalid save JSON: {e}"),
            LegacyError::Shape(e) => write!(f, "invalid save: {e}"),
            LegacyError::SaveVersion(e) | LegacyError::FormatVersion(e) => e.fmt(f),
            LegacyError::Number { field, value } => write!(f, "invalid number in {field}: {value}"),
            LegacyError::Date { key, value } => write!(f, "invalid date.{key}: {value}"),
        }
    }
}

impl std::error::Error for LegacyError {}

/// The TS `_validateSaveVersion` / `_validateFormatVersion` errors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VersionError {
    /// "Beta save from different minor version".
    BetaMinor,
    /// "1.0 save in 0.x game".
    ReleaseInBeta,
    /// "nice try, no 0.1.x saves".
    Beta01,
    /// "blacklisted save version" (`1.0.0-publictest*`).
    Blacklisted,
    /// The version is not a string (JS throws a TypeError).
    NotAString,
}

impl fmt::Display for VersionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            VersionError::BetaMinor => "Beta save from different minor version",
            VersionError::ReleaseInBeta => "1.0 save in 0.x game",
            VersionError::Beta01 => "nice try, no 0.1.x saves",
            VersionError::Blacklisted => "blacklisted save version",
            VersionError::NotAString => "save version is not a string",
        })
    }
}

impl std::error::Error for VersionError {}

/// JS `parseInt(s)` for the version check: `None` is NaN.
fn parse_int(s: &str) -> Option<f64> {
    let s = s.trim_start();
    let (neg, rest) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    let v: f64 = rest[..end].parse().ok()?;
    Some(if neg { -v } else { v })
}

/// The first two parts of a version, as JS values: `None` is `undefined`,
/// `Some(NaN)` is NaN.
fn major_minor(v: &str) -> [Option<f64>; 2] {
    let mut parts = v.split('.').map(|p| parse_int(p).unwrap_or(f64::NAN));
    [parts.next(), parts.next()]
}

/// JS `===` on numbers or undefined.
fn js_eq(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

fn js_gt(a: Option<f64>, b: Option<f64>) -> bool {
    matches!((a, b), (Some(a), Some(b)) if a > b)
}

fn is_blacklisted(version: &str, game: &str) -> bool {
    // never blacklist the current version
    version != game && version.starts_with("1.0.0-publictest")
}

/// TS `_validateSaveVersion(saveversion = "0.1.0", gameversion)`: rejects
/// beta saves from another minor version, 1.x saves in a 0.x game, 0.1.x
/// saves in a 1.x game and publictest saves. `None` is a save without a
/// version (assumed 0.1.0).
pub fn validate_save_version(save: Option<&str>, game: &str) -> Result<(), VersionError> {
    let save = save.unwrap_or("0.1.0");
    let [s_major, s_minor] = major_minor(save);
    let [g_major, g_minor] = major_minor(game);
    let zero = Some(0.0);
    if js_eq(s_major, g_major) && js_eq(g_major, zero) && !js_eq(s_minor, g_minor) {
        return Err(VersionError::BetaMinor);
    }
    if js_gt(s_major, zero) && js_eq(g_major, zero) {
        return Err(VersionError::ReleaseInBeta);
    }
    if js_gt(g_major, zero) && js_eq(s_major, zero) && js_gt(Some(2.0), s_minor) {
        return Err(VersionError::Beta01);
    }
    if is_blacklisted(save, game) {
        return Err(VersionError::Blacklisted);
    }
    Ok(())
}

/// TS `_validateFormatVersion`: the header version must not be a publictest
/// build.
pub fn validate_format_version(format: &str, game: &str) -> Result<(), VersionError> {
    if is_blacklisted(format, game) {
        Err(VersionError::Blacklisted)
    } else {
        Ok(())
    }
}

/// JS `/\s+/g` whitespace.
fn strip_whitespace(text: &str) -> String {
    text.chars()
        .filter(|c| !(c.is_whitespace() || *c == '\u{feff}'))
        .collect()
}

/// Whether `text` looks like a v1 save: `^[A-Za-z0-9+/=]*\|Q2hlYXRlciA6KAoK`,
/// or the bare prefix of pre-header saves, after removing whitespace.
pub fn is_legacy(text: &str) -> bool {
    let text = strip_whitespace(text);
    if text.starts_with(PREFIX) {
        return true;
    }
    match text.split_once(VERSION_DELIM) {
        Some((header, body)) => {
            header
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'/' | b'='))
                && body.starts_with(PREFIX)
        }
        None => false,
    }
}

/// JS `atob`: base64 to a latin1 string.
fn atob(text: &str) -> Result<String, LegacyError> {
    let bytes = B64
        .decode(text)
        .map_err(|e| LegacyError::Header(e.to_string()))?;
    Ok(bytes.into_iter().map(char::from).collect())
}

/// JS `btoa` of a latin1 string. Characters above U+00FF (which `btoa`
/// refuses) are written as `?`.
#[cfg(feature = "legacy-write")]
fn btoa(text: &str) -> String {
    let bytes: Vec<u8> = text
        .chars()
        .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
        .collect();
    B64.encode(bytes)
}

/// Decodes a v1 save, as TS `Session._loads` does. See the [module
/// docs](self).
///
/// Differences from the TS: `date.loaded` is dropped (the TS sets it to the
/// clock; [`Engine::load`](swarm_engine::Engine::load) does that here);
/// fractional `skippedMillis`, achievement times and `elapsedFirst` are
/// rounded to whole milliseconds; a `"NaN"` count reads as zero with a
/// warning (decimal.js would carry a NaN that the engine reads as zero);
/// a missing `unittypes`/`upgrades` reads as empty with a warning (the TS
/// throws); unknown keys inside `statistics` and `version` are dropped.
pub fn decode(text: &str) -> Result<LegacyDecoded, LegacyError> {
    // 1. strip whitespace
    let text = strip_whitespace(text);
    // 2. split the version header (JS `split("|")`, first two parts)
    let (header, body) = match text.find(VERSION_DELIM) {
        Some(i) => {
            let rest = &text[i + 1..];
            let body = rest.split(VERSION_DELIM).next().unwrap_or("");
            (Some(&text[..i]), body)
        }
        None => (None, text.as_str()),
    };
    // 3. drop the prefix (unchecked, like the TS) and decompress
    let body: String = body.chars().skip(PREFIX.len()).collect();
    let json = lz::decompress_from_base64(&body).ok_or(LegacyError::Decompress)?;
    // 4. parse
    let root: Value = serde_json::from_str(&json).map_err(|e| LegacyError::Json(e.to_string()))?;
    let Value::Object(mut root) = root else {
        return Err(LegacyError::Shape("not a JSON object".into()));
    };
    let mut warnings = Vec::new();
    // 7. dates (the TS converts them before validating)
    let (dates, timers) = read_dates(root.remove("date"), &mut warnings)?;
    // 5. versions
    let version = root.remove("version");
    let started = match version.as_ref().and_then(|v| v.get("started")) {
        None => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => return Err(LegacyError::SaveVersion(VersionError::NotAString)),
    };
    validate_save_version(started, GAME_VERSION).map_err(LegacyError::SaveVersion)?;
    let format_version = match header {
        Some(h) if !h.is_empty() => {
            let v = atob(h)?;
            validate_format_version(&v, GAME_VERSION).map_err(LegacyError::FormatVersion)?;
            Some(v)
        }
        _ => None,
    };
    // 6. counts
    let units = read_counts(root.remove("unittypes"), "unittypes", &mut warnings)?;
    let upgrades = read_counts(root.remove("upgrades"), "upgrades", &mut warnings)?;
    // 8. the rest
    let watched = read_watched(root.remove("watched"), &mut warnings);
    let achievements = read_ms_map(root.remove("achievements"), "achievements", &mut warnings);
    let statistics = read_statistics(root.remove("statistics"), &mut warnings)?;
    let skipped_ms = match root.remove("skippedMillis") {
        None | Some(Value::Null) => 0,
        Some(v) => match as_ms(&v) {
            Some(ms) => ms,
            None => {
                warnings.push(format!("skippedMillis: not a number ({v}), using 0"));
                0
            }
        },
    };
    let options = match root.remove("options") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m,
        Some(v) => {
            warnings.push(format!("options: not an object ({v}), dropped"));
            Map::new()
        }
    };
    let version = version.and_then(|v| {
        let get = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        v.is_object().then(|| VersionInfo {
            started: get("started"),
            saved: get("saved"),
        })
    });
    let kongregate = match root.remove("kongregate") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(b)) => Some(b),
        Some(v) => {
            warnings.push(format!("kongregate: not a boolean ({v}), dropped"));
            None
        }
    };
    let state = State {
        units,
        upgrades,
        dates,
        timers,
        skipped_ms,
        achievements,
        watched,
        statistics,
        options,
        version,
        kongregate,
        unknown: root.into_iter().collect(),
    };
    Ok(LegacyDecoded {
        state,
        format_version,
        warnings,
    })
}

/// JS `new Date(value).getTime()`; `None` is an Invalid Date.
fn js_date(v: &Value) -> Option<i64> {
    match v {
        Value::String(s) => crate::date::parse_iso(s),
        Value::Number(n) => n
            .as_f64()
            .filter(|x| x.is_finite())
            .map(|x| x.trunc() as i64),
        Value::Null => Some(0),
        Value::Bool(b) => Some(i64::from(*b)),
        _ => None,
    }
}

fn read_dates(
    date: Option<Value>,
    warnings: &mut Vec<String>,
) -> Result<(Dates, BTreeMap<String, i64>), LegacyError> {
    let Some(Value::Object(date)) = date else {
        return Err(LegacyError::Shape("no date object".into()));
    };
    let mut dates = Dates::default();
    let mut timers = BTreeMap::new();
    let mut started = None;
    let mut reified = None;
    for (key, v) in date {
        let ms = js_date(&v);
        let required = key == "started" || key == "reified";
        let Some(ms) = ms else {
            if required {
                return Err(LegacyError::Date {
                    key,
                    value: v.to_string(),
                });
            }
            warnings.push(format!("date.{key}: invalid date {v}, dropped"));
            continue;
        };
        match key.as_str() {
            "started" => started = Some(ms),
            "reified" => reified = Some(ms),
            "restarted" => dates.restarted = Some(ms),
            "saved" => dates.saved = Some(ms),
            "closed" => dates.closed = Some(ms),
            // the TS overwrites it with the clock; Engine::load sets it
            "loaded" => {}
            _ => match key.strip_prefix(TIMER_PREFIX) {
                Some(unit) => {
                    timers.insert(unit.to_owned(), ms);
                }
                None => {
                    dates.other.insert(key, ms);
                }
            },
        }
    }
    let missing = |key: &str| LegacyError::Date {
        key: key.into(),
        value: "undefined".into(),
    };
    dates.started = started.ok_or_else(|| missing("started"))?;
    dates.reified = reified.ok_or_else(|| missing("reified"))?;
    Ok((dates, timers))
}

/// A Decimal-valued field: a JS number through `toPrecision(15)`, or a
/// decimal.js string.
fn read_num(v: &Value, field: &str, warnings: &mut Vec<String>) -> Result<Num, LegacyError> {
    let bad = || LegacyError::Number {
        field: field.to_owned(),
        value: v.to_string(),
    };
    match v {
        Value::Number(n) => Ok(legacy_count(n.as_f64().ok_or_else(bad)?)),
        Value::String(s) => match s.parse::<Num>() {
            Ok(n) => Ok(n),
            Err(swarm_num::ParseNumError::NaN) => {
                warnings.push(format!("{field}: NaN, using 0"));
                Ok(Num::ZERO)
            }
            Err(_) => Err(bad()),
        },
        _ => Err(bad()),
    }
}

fn read_counts(
    obj: Option<Value>,
    what: &str,
    warnings: &mut Vec<String>,
) -> Result<BTreeMap<String, Num>, LegacyError> {
    let obj = match obj {
        Some(Value::Object(m)) => m,
        other => {
            warnings.push(format!(
                "{what}: missing or not an object ({other:?}), empty"
            ));
            return Ok(BTreeMap::new());
        }
    };
    obj.into_iter()
        .map(|(k, v)| {
            let n = read_num(&v, &format!("{what}.{k}"), warnings)?;
            Ok((k, n))
        })
        .collect()
}

fn read_watched(obj: Option<Value>, warnings: &mut Vec<String>) -> BTreeMap<String, i32> {
    let Some(Value::Object(obj)) = obj else {
        return BTreeMap::new();
    };
    let mut out = BTreeMap::new();
    for (k, v) in obj {
        let level = match &v {
            Value::Bool(b) => Some(i32::from(*b)),
            Value::Number(n) => n
                .as_f64()
                .filter(|x| x.is_finite())
                .map(|x| x.trunc().clamp(i32::MIN.into(), i32::MAX.into()) as i32),
            _ => None,
        };
        match level {
            Some(l) => {
                out.insert(k, l);
            }
            None => warnings.push(format!("watched.{k}: not a level ({v}), dropped")),
        }
    }
    out
}

/// A JS number of milliseconds, rounded to an integer (integers exactly).
fn as_ms(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| {
        v.as_f64()
            .filter(|x| x.is_finite())
            .map(|x| x.round() as i64)
    })
}

fn read_ms_map(
    obj: Option<Value>,
    what: &str,
    warnings: &mut Vec<String>,
) -> BTreeMap<String, i64> {
    let Some(Value::Object(obj)) = obj else {
        return BTreeMap::new();
    };
    let mut out = BTreeMap::new();
    for (k, v) in obj {
        match as_ms(&v) {
            Some(ms) => {
                out.insert(k, ms);
            }
            None => warnings.push(format!("{what}.{k}: not a number ({v}), dropped")),
        }
    }
    out
}

fn read_clicks(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_f64)
        .filter(|x| x.is_finite() && *x >= 0.0)
        .map_or(0, |x| x.round() as u64)
}

fn read_statistics(
    obj: Option<Value>,
    warnings: &mut Vec<String>,
) -> Result<Statistics, LegacyError> {
    let Some(Value::Object(obj)) = obj else {
        return Ok(Statistics::default());
    };
    let mut stats = Statistics {
        clicks: read_clicks(obj.get("clicks")),
        ..Statistics::default()
    };
    let entries = |key: &str| -> Vec<(String, Map<String, Value>)> {
        match obj.get(key) {
            Some(Value::Object(m)) => m
                .iter()
                .filter_map(|(k, v)| v.as_object().map(|o| (k.clone(), o.clone())))
                .collect(),
            _ => Vec::new(),
        }
    };
    let num = |o: &Map<String, Value>, k: &str, field: String, w: &mut Vec<String>| match o.get(k) {
        None | Some(Value::Null) => Ok(Num::ZERO),
        Some(v) => read_num(v, &field, w),
    };
    for (name, o) in entries("byUnit") {
        let s = UnitStatistics {
            clicks: read_clicks(o.get("clicks")),
            num: num(&o, "num", format!("statistics.byUnit.{name}.num"), warnings)?,
            twinnum: num(
                &o,
                "twinnum",
                format!("statistics.byUnit.{name}.twinnum"),
                warnings,
            )?,
            elapsed_first: o.get("elapsedFirst").and_then(as_ms),
        };
        stats.by_unit.insert(name, s);
    }
    for (name, o) in entries("byUpgrade") {
        let s = UpgradeStatistics {
            clicks: read_clicks(o.get("clicks")),
            num: num(
                &o,
                "num",
                format!("statistics.byUpgrade.{name}.num"),
                warnings,
            )?,
            elapsed_first: o.get("elapsedFirst").and_then(as_ms),
        };
        stats.by_upgrade.insert(name, s);
    }
    Ok(stats)
}

/// Encodes a state as a v1 save that the TS engine (and the CoffeeScript
/// game) imports: header `btoa("1.1.17")`, the `Cheater :(` prefix, and the
/// lz-string-compressed JSON with the TS key layout (`unittypes`, `date`,
/// `options`, `upgrades`, `statistics`, `achievements`, `watched`,
/// `skippedMillis`, `version`, `kongregate`, then unknown keys). Decimal
/// values are decimal.js-style strings carrying every digit of the `Num`
/// (lossless), dates are `toISOString` strings, timers are
/// `addUnitTimed-<unit>` dates.
///
/// The state is written as-is: call [`crate::prepare_save`] first to stamp
/// `date.saved` like TS `session.save()`. `date.loaded` is never written
/// (the TS deletes it on save).
#[cfg(feature = "legacy-write")]
pub fn encode(state: &State) -> String {
    let json = to_legacy_json(state);
    format!(
        "{}{VERSION_DELIM}{PREFIX}{}",
        btoa(GAME_VERSION),
        lz::compress_to_base64(&json)
    )
}

/// The JSON text of a v1 save body, as TS `JSON.stringify(state)` lays it
/// out. See [`encode`].
#[cfg(feature = "legacy-write")]
pub fn to_legacy_json(state: &State) -> String {
    use crate::date::to_iso;
    use crate::num_text::exact;

    let mut w = JsonWriter::default();
    w.open();
    w.key("unittypes");
    w.map(state.units.iter(), |w, n| w.string(&exact(n)));
    w.key("date");
    w.open();
    let d = &state.dates;
    let date = |w: &mut JsonWriter, k: &str, ms: Option<i64>| {
        if let Some(ms) = ms {
            w.key(k);
            w.string(&to_iso(ms));
        }
    };
    date(&mut w, "started", Some(d.started));
    date(&mut w, "restarted", d.restarted);
    date(&mut w, "saved", d.saved);
    date(&mut w, "reified", Some(d.reified));
    date(&mut w, "closed", d.closed);
    for (k, ms) in &d.other {
        if !matches!(
            k.as_str(),
            "started" | "restarted" | "saved" | "reified" | "closed" | "loaded"
        ) && !k.starts_with(TIMER_PREFIX)
        {
            date(&mut w, k, Some(*ms));
        }
    }
    for (unit, ms) in &state.timers {
        date(&mut w, &format!("{TIMER_PREFIX}{unit}"), Some(*ms));
    }
    w.close();
    w.key("options");
    w.raw(&Value::Object(state.options.clone()).to_string());
    w.key("upgrades");
    w.map(state.upgrades.iter(), |w, n| w.string(&exact(n)));
    w.key("statistics");
    w.open();
    w.key("byUnit");
    w.map(state.statistics.by_unit.iter(), |w, s| {
        w.open();
        w.key("clicks");
        w.raw(&s.clicks.to_string());
        w.key("num");
        w.string(&exact(&s.num));
        w.key("twinnum");
        w.string(&exact(&s.twinnum));
        if let Some(e) = s.elapsed_first {
            w.key("elapsedFirst");
            w.raw(&e.to_string());
        }
        w.close();
    });
    w.key("byUpgrade");
    w.map(state.statistics.by_upgrade.iter(), |w, s| {
        w.open();
        w.key("clicks");
        w.raw(&s.clicks.to_string());
        w.key("num");
        w.string(&exact(&s.num));
        if let Some(e) = s.elapsed_first {
            w.key("elapsedFirst");
            w.raw(&e.to_string());
        }
        w.close();
    });
    w.key("clicks");
    w.raw(&state.statistics.clicks.to_string());
    w.close();
    w.key("achievements");
    w.map(state.achievements.iter(), |w, ms| w.raw(&ms.to_string()));
    w.key("watched");
    w.map(state.watched.iter(), |w, l| w.raw(&l.to_string()));
    w.key("skippedMillis");
    w.raw(&state.skipped_ms.to_string());
    if let Some(v) = &state.version {
        w.key("version");
        w.open();
        if let Some(s) = &v.started {
            w.key("started");
            w.string(s);
        }
        if let Some(s) = &v.saved {
            w.key("saved");
            w.string(s);
        }
        w.close();
    }
    if let Some(k) = state.kongregate {
        w.key("kongregate");
        w.raw(&k.to_string());
    }
    for (k, v) in &state.unknown {
        if !KNOWN_KEYS.contains(&k.as_str()) {
            w.key(k);
            w.raw(&v.to_string());
        }
    }
    w.close();
    w.out
}

/// Top-level keys [`to_legacy_json`] writes itself.
#[cfg(feature = "legacy-write")]
const KNOWN_KEYS: &[&str] = &[
    "unittypes",
    "date",
    "options",
    "upgrades",
    "statistics",
    "achievements",
    "watched",
    "skippedMillis",
    "version",
    "kongregate",
];

/// A minimal ordered JSON writer (serde_json's `Map` sorts keys).
#[cfg(feature = "legacy-write")]
#[derive(Default)]
struct JsonWriter {
    out: String,
    /// Whether the innermost open object has no members yet.
    first: Vec<bool>,
}

#[cfg(feature = "legacy-write")]
impl JsonWriter {
    fn open(&mut self) {
        self.out.push('{');
        self.first.push(true);
    }
    fn close(&mut self) {
        self.out.push('}');
        self.first.pop();
    }
    fn key(&mut self, k: &str) {
        if let Some(first) = self.first.last_mut() {
            if !*first {
                self.out.push(',');
            }
            *first = false;
        }
        self.string(k);
        self.out.push(':');
    }
    fn string(&mut self, s: &str) {
        self.out.push_str(&Value::String(s.to_owned()).to_string());
    }
    fn raw(&mut self, json: &str) {
        self.out.push_str(json);
    }
    fn map<'a, T: 'a>(
        &mut self,
        items: impl Iterator<Item = (&'a String, &'a T)>,
        mut value: impl FnMut(&mut Self, &T),
    ) {
        self.open();
        for (k, v) in items {
            self.key(k);
            value(self, v);
        }
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_int_like_js() {
        assert_eq!(parse_int("0-publictest9"), Some(0.0));
        assert_eq!(parse_int(" 12x"), Some(12.0));
        assert_eq!(parse_int(""), None);
        assert_eq!(parse_int("x"), None);
        assert_eq!(parse_int("-3"), Some(-3.0));
    }

    #[test]
    fn detects_v1() {
        assert!(is_legacy("MS4wLjA=|Q2hlYXRlciA6KAoKN4Ig"));
        assert!(is_legacy("Q2hlYXRlciA6KAoKN4Ig"));
        assert!(is_legacy("MS4wLjA=|\n  Q2hlYXRlciA6KAoKN4Ig"));
        assert!(!is_legacy("SW2|N4Ig"));
        assert!(!is_legacy("MS!wLjA=|Q2hlYXRlciA6KAoKN4Ig"));
        assert!(!is_legacy("{}"));
    }
}
