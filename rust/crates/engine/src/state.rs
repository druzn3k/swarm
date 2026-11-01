//! The persisted game state (`engine/src/session.ts` `SessionState`), as a
//! serde struct. Everything the engine needs to resume a game lives here;
//! caches, the clock and undo live in the engine's runtime and are rebuilt
//! on load.
//!
//! Units and upgrades are keyed by **name**, not id, so a `State` does not
//! depend on the order of the game data and unknown names survive a round
//! trip. Dates are epoch milliseconds.
//!
//! The legacy (v1) save format and the v2 envelope are `swarm-save`'s job;
//! this struct is what both decode to.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use swarm_num::Num;

/// The version the TS engine writes into saves (`session.ts`
/// `DEFAULT_VERSION`).
pub const DEFAULT_VERSION: &str = "1.1.17";

/// The game state. See the [module docs](self).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct State {
    /// Unit counts as of the last reify (TS `state.unittypes`). A unit that
    /// is absent is "not initialised" (`Unit.isCountInitialized`), which
    /// backfill checks for `freeRespec`; it counts as zero.
    pub units: BTreeMap<String, Num>,
    /// Upgrade levels (TS `state.upgrades`). Absent means zero.
    pub upgrades: BTreeMap<String, Num>,
    /// The fixed dates.
    pub dates: Dates,
    /// `addUnitTimed` timers: unit name -> epoch ms of the last grant (TS
    /// `state.date["addUnitTimed-<unit>"]`, `unit.ts:744-761`). Absent means
    /// epoch 0.
    pub timers: BTreeMap<String, i64>,
    /// Total milliseconds skipped by swarmwarp and the like (TS
    /// `state.skippedMillis`), as of the last reify.
    pub skipped_ms: i64,
    /// Earned achievements: name -> milliseconds since `dates.started` when
    /// earned (`achievement.ts:63-70`).
    pub achievements: BTreeMap<String, i64>,
    /// Upgrade watch levels (TS `state.watched`): `-1` hidden, `0` off, `n`
    /// notify at `1/n` of the cost. Absent means the default: 1, or 0 for
    /// upgrades of mutagen-tab units. Legacy booleans are 1 and 0.
    pub watched: BTreeMap<String, i32>,
    /// Purchase statistics.
    pub statistics: Statistics,
    /// The UI's options bag, round-tripped untouched.
    pub options: serde_json::Map<String, Value>,
    /// Game versions that started and last saved this game.
    pub version: Option<VersionInfo>,
    /// Set on Kongregate.
    pub kongregate: Option<bool>,
    /// Unknown top-level keys from older or newer saves, kept as-is.
    pub unknown: BTreeMap<String, Value>,
}

/// The dates of a game, epoch ms (TS `state.date`, minus the timers).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Dates {
    /// When the game started. Seeds the random spawns.
    pub started: i64,
    /// When the current ascension started (`None` in some old saves: then
    /// `addUnitRand` sets it to `started`, `effecttypes.ts:185`).
    pub restarted: Option<i64>,
    /// When counts were last written back (the polynomial's `t = 0`).
    pub reified: i64,
    /// When the game was last saved.
    pub saved: Option<i64>,
    /// When the save was last loaded (removed on save).
    pub loaded: Option<i64>,
    /// When the game was last closed.
    pub closed: Option<i64>,
    /// Other date keys, kept as-is.
    pub other: BTreeMap<String, i64>,
}

/// `state.version`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct VersionInfo {
    /// Version that started the game; validated by the legacy loader.
    pub started: Option<String>,
    /// Version that last saved it.
    pub saved: Option<String>,
}

/// Purchase statistics (`statistics.ts`). The serde names match the legacy
/// JSON (`byUnit`, `elapsedFirst`, ...).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Statistics {
    /// Successful commands of any kind.
    pub clicks: u64,
    /// Per unit bought (including `ascension`, which the ascend command
    /// records as a unit).
    pub by_unit: BTreeMap<String, UnitStatistics>,
    /// Per upgrade bought.
    pub by_upgrade: BTreeMap<String, UpgradeStatistics>,
}

/// Statistics of one unit.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UnitStatistics {
    /// Purchases.
    pub clicks: u64,
    /// Units bought.
    pub num: Num,
    /// Units received, twins included. Unit achievements count this.
    pub twinnum: Num,
    /// Milliseconds since `started` of the first purchase.
    pub elapsed_first: Option<i64>,
}

/// Statistics of one upgrade.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UpgradeStatistics {
    /// Purchases.
    pub clicks: u64,
    /// Levels bought.
    pub num: Num,
    /// Milliseconds since `started` of the first purchase.
    pub elapsed_first: Option<i64>,
}

impl Default for State {
    fn default() -> State {
        State::new(0)
    }
}

impl State {
    /// A fresh state, as `Session.reset()` builds it (`session.ts:115-145`):
    /// every date at `now_ms`, no counts, empty statistics. The engine then
    /// sets each unit to its `init` count (see `Engine::new_game`).
    pub fn new(now_ms: i64) -> State {
        State {
            units: BTreeMap::new(),
            upgrades: BTreeMap::new(),
            dates: Dates {
                started: now_ms,
                restarted: Some(now_ms),
                reified: now_ms,
                saved: Some(now_ms),
                loaded: Some(now_ms),
                closed: Some(now_ms),
                other: BTreeMap::new(),
            },
            timers: BTreeMap::new(),
            skipped_ms: 0,
            achievements: BTreeMap::new(),
            watched: BTreeMap::new(),
            statistics: Statistics::default(),
            options: serde_json::Map::new(),
            version: Some(VersionInfo {
                started: Some(DEFAULT_VERSION.to_owned()),
                saved: Some(DEFAULT_VERSION.to_owned()),
            }),
            kongregate: None,
            unknown: BTreeMap::new(),
        }
    }

    /// A minimal state for tests and tools, like the TS specs' `mkgame`
    /// sessions: these counts, and `started`, `restarted` and `reified` at
    /// `now_ms`.
    pub fn with_units<'a>(now_ms: i64, counts: impl IntoIterator<Item = (&'a str, Num)>) -> State {
        let mut s = State::new(now_ms);
        s.dates.saved = None;
        s.dates.loaded = None;
        s.dates.closed = None;
        s.version = None;
        for (name, n) in counts {
            s.units.insert(name.to_owned(), n);
        }
        s
    }

    /// The latest date in the state, ignoring `saved` and `loaded`: when
    /// the game was most likely closed (`session.ts` `dateClosed`, without
    /// the heartbeat). Includes the timers, like the TS.
    pub fn date_closed(&self) -> i64 {
        let d = &self.dates;
        [Some(d.started), d.restarted, Some(d.reified), d.closed]
            .into_iter()
            .flatten()
            .chain(d.other.values().copied())
            .chain(self.timers.values().copied())
            .fold(0, i64::max)
    }
}

/// A count read from a legacy save as a JS number, the way the TS reads it
/// (`unit.ts:300-314`, `session.ts:231-240`): `toPrecision(15)` first, which
/// avoids decimal.js errors on binary fractions; NaN becomes zero (the TS
/// logs "NaN count"). For the legacy save reader.
pub fn legacy_count(x: f64) -> Num {
    if x.is_nan() {
        return Num::ZERO;
    }
    let n = Num::from_f64(x);
    n.to_precision(15).parse().unwrap_or(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_state_shape() {
        let s = State::new(1000);
        assert_eq!(s.dates.started, 1000);
        assert_eq!(s.dates.restarted, Some(1000));
        assert_eq!(s.statistics.clicks, 0);
        assert_eq!(
            s.version.as_ref().unwrap().started.as_deref(),
            Some("1.1.17")
        );
    }

    #[test]
    fn serde_round_trip() {
        let mut s = State::new(5);
        s.units.insert("meat".into(), Num::from(12));
        s.timers.insert("larva".into(), 77);
        s.statistics.by_unit.insert(
            "drone".into(),
            UnitStatistics {
                clicks: 1,
                num: Num::ONE,
                twinnum: Num::TWO,
                elapsed_first: Some(3),
            },
        );
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"byUnit\""));
        assert!(json.contains("\"elapsedFirst\""));
        let back: State = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn legacy_counts() {
        assert_eq!(legacy_count(f64::NAN), Num::ZERO);
        assert_eq!(legacy_count(0.1 + 0.2).to_string(), "0.3");
        assert_eq!(legacy_count(1e39), Num::new(1.0, 39));
    }

    #[test]
    fn date_closed_takes_the_max() {
        let mut s = State::new(10);
        s.timers.insert("x".into(), 50);
        s.dates.saved = Some(100);
        assert_eq!(s.date_closed(), 50);
    }
}
