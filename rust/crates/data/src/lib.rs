//! `swarm-data`: the Swarm Simulator game data.
//!
//! The units, upgrades, achievements and crystal packs come from the
//! `tables` package, which writes them to `data/gamedata.json`
//! (`pnpm --filter @swarmsim/tables gen:json`; the file is committed, so
//! building this crate never needs Node). The JSON is embedded with
//! [`include_str!`] and resolved once at startup into a [`GameData`]:
//!
//! * names become typed ids ([`UnitId`], [`UpgradeId`], [`AchievementId`],
//!   [`MtxId`], [`EffectId`], [`StatId`], [`PathId`], [`TabId`]), with name
//!   lookups for the boundary (saves, commands);
//! * game values become [`swarm_num::Num`];
//! * the TS engine's load-time defaults and asserts are applied
//!   (`unittypes.ts`, `upgradetypes.ts`, `achievementtypes.ts`), and stat
//!   operation conflicts (`effecttypes.ts` `validateSchema`) are checked here
//!   instead of at the first `stats()`;
//! * everything that depends only on the data is precomputed: producers and
//!   [producer paths](ProducerPath), each unit's upgrade list and the order
//!   its stats are folded in, [tabs](Tabs), and the [`WellKnown`] units,
//!   upgrades and tab the engine refers to by name.
//!
//! [`GameData::embedded`] is the shared, lazily loaded copy;
//! [`GameData::from_json`] loads other data (tests, the scenario harness).
//! The crate is wasm-portable: no clocks, files or threads.
//!
//! The raw schema, field for field, is in [`schema`];
//! `engine/test/gamedata-json.test.ts` checks the JSON against what the TS
//! engine parses.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod error;
mod ids;
mod paths;
mod resolve;
pub mod schema;
mod stats;
mod tabs;
mod types;
mod wellknown;

use std::collections::HashMap;
use std::sync::OnceLock;

pub use error::DataError;
pub use ids::{AchievementId, EffectId, MtxId, PathId, StatId, TabId, UnitId, UpgradeId};
pub use paths::{PathLink, ProducerPath};
pub use resolve::json_num;
pub use stats::WellKnownStats;
pub use swarm_num::Num;
pub use tabs::{Tab, Tabs};
pub use types::*;
pub use wellknown::WellKnown;

/// The `schema` version of `gamedata.json` this crate reads
/// (`SCHEMA_VERSION` in `tables/src/json/gen-json.ts`).
pub const SCHEMA_VERSION: u32 = 1;

/// The embedded `data/gamedata.json`.
pub const EMBEDDED_JSON: &str = include_str!("../data/gamedata.json");

/// The resolved game data. See the [crate docs](crate).
///
/// Tables are indexed by their ids; every list keeps the spreadsheet order.
#[derive(Clone, Debug)]
pub struct GameData {
    raw: schema::GameDataJson,
    units: Vec<UnitType>,
    upgrades: Vec<UpgradeType>,
    achievements: Vec<AchievementType>,
    mtx: Vec<Mtx>,
    effects: Vec<Effect>,
    producer_paths: Vec<ProducerPath>,
    tabs: Tabs,
    unit_by_name: HashMap<String, UnitId>,
    unit_by_slug: HashMap<String, UnitId>,
    upgrade_by_name: HashMap<String, UpgradeId>,
    achievement_by_name: HashMap<String, AchievementId>,
    mtx_by_name: HashMap<String, MtxId>,
    stat_names: Vec<String>,
    stat_by_name: HashMap<String, StatId>,
    well_known_stats: WellKnownStats,
    well_known: WellKnown,
}

static EMBEDDED: OnceLock<GameData> = OnceLock::new();

impl GameData {
    /// Parses and resolves the embedded data.
    pub fn load() -> Result<GameData, DataError> {
        GameData::from_json(EMBEDDED_JSON)
    }

    /// The embedded data, loaded on first use and shared.
    ///
    /// # Panics
    ///
    /// If the embedded data doesn't load, which this crate's tests rule out.
    pub fn embedded() -> &'static GameData {
        EMBEDDED.get_or_init(|| match GameData::load() {
            Ok(data) => data,
            Err(e) => panic!("embedded {e}"),
        })
    }

    /// Parses and resolves game data in the `gamedata.json` format.
    pub fn from_json(json: &str) -> Result<GameData, DataError> {
        GameData::from_schema(serde_json::from_str(json)?)
    }

    /// Resolves already-parsed game data.
    pub fn from_schema(raw: schema::GameDataJson) -> Result<GameData, DataError> {
        resolve::resolve(raw)
    }

    /// The data as parsed, before resolving: exact JSON values (`f64`) and
    /// names.
    pub fn raw(&self) -> &schema::GameDataJson {
        &self.raw
    }

    /// All units, in table order.
    pub fn units(&self) -> &[UnitType] {
        &self.units
    }
    /// The unit with this id.
    pub fn unit(&self, id: UnitId) -> &UnitType {
        &self.units[id.index()]
    }
    /// The unit with this name.
    pub fn unit_id(&self, name: &str) -> Option<UnitId> {
        self.unit_by_name.get(name).copied()
    }
    /// The unit with this slug (TS `game.unitBySlug`).
    pub fn unit_by_slug(&self, slug: &str) -> Option<UnitId> {
        self.unit_by_slug.get(slug).copied()
    }

    /// All upgrades and abilities, in table order.
    pub fn upgrades(&self) -> &[UpgradeType] {
        &self.upgrades
    }
    /// The upgrade with this id.
    pub fn upgrade(&self, id: UpgradeId) -> &UpgradeType {
        &self.upgrades[id.index()]
    }
    /// The upgrade with this name.
    pub fn upgrade_id(&self, name: &str) -> Option<UpgradeId> {
        self.upgrade_by_name.get(name).copied()
    }

    /// All achievements, in table order.
    pub fn achievements(&self) -> &[AchievementType] {
        &self.achievements
    }
    /// The achievement with this id.
    pub fn achievement(&self, id: AchievementId) -> &AchievementType {
        &self.achievements[id.index()]
    }
    /// The achievement with this name.
    pub fn achievement_id(&self, name: &str) -> Option<AchievementId> {
        self.achievement_by_name.get(name).copied()
    }
    /// Sum of all achievement points (TS `pointsPossible`).
    pub fn achievement_points_possible(&self) -> u32 {
        self.achievements.iter().map(|a| a.points).sum()
    }

    /// All crystal packs, in table order.
    pub fn mtx(&self) -> &[Mtx] {
        &self.mtx
    }
    /// The crystal pack with this name.
    pub fn mtx_id(&self, name: &str) -> Option<MtxId> {
        self.mtx_by_name.get(name).copied()
    }

    /// Every effect: all units' (in unit order), then all upgrades'.
    pub fn effects(&self) -> &[Effect] {
        &self.effects
    }
    /// The effect with this id.
    pub fn effect(&self, id: EffectId) -> &Effect {
        &self.effects[id.index()]
    }

    /// Every producer path, grouped by unit in unit order.
    pub fn producer_paths(&self) -> &[ProducerPath] {
        &self.producer_paths
    }
    /// The producer path with this id.
    pub fn producer_path(&self, id: PathId) -> &ProducerPath {
        &self.producer_paths[id.index()]
    }
    /// A unit's producer paths, in the TS engine's order.
    pub fn paths_of(&self, unit: UnitId) -> impl Iterator<Item = &ProducerPath> + '_ {
        self.unit(unit)
            .producer_paths
            .iter()
            .map(|&p| self.producer_path(p))
    }

    /// The tabs.
    pub fn tabs(&self) -> &Tabs {
        &self.tabs
    }

    /// Every interned stat name, indexed by [`StatId`].
    pub fn stat_names(&self) -> &[String] {
        &self.stat_names
    }
    /// The name of a stat.
    pub fn stat_name(&self, id: StatId) -> &str {
        &self.stat_names[id.index()]
    }
    /// The id of a stat name. `None` means no effect can set it and the
    /// engine never reads it.
    pub fn stat_id(&self, name: &str) -> Option<StatId> {
        self.stat_by_name.get(name).copied()
    }
    /// The stats the engine reads by a fixed name.
    pub fn stats(&self) -> &WellKnownStats {
        &self.well_known_stats
    }

    /// The units, upgrades and tab the engine refers to by name.
    pub fn well_known(&self) -> &WellKnown {
        &self.well_known
    }
}
