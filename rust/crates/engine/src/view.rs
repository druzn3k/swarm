//! The view: everything a frontend reads, as plain data. [`Engine::view`]
//! gives the per-tick [`View`], shaped by a [`ViewRequest`];
//! [`Engine::static_view`] gives the [`StaticView`] (names, texts, tabs,
//! effect parameters), which never changes and is sent once.
//!
//! # Shape
//!
//! * **Flat and index-based.** Units, upgrades, achievements, stats, tabs
//!   and effects are referred to by their `u16` index into the data tables
//!   (and into the [`StaticView`] lists). Lists of units and upgrades carry
//!   their `id`; with the default request they are index-aligned with the
//!   data.
//! * **Numbers are [`Num`]**, serialised as Num's canonical string. The
//!   view carries no pre-formatted text: number and duration formatting is
//!   the frontend's job (the TUI uses `swarm_num`'s formatting; the web app
//!   ports its `format.ts`). Durations are seconds (`f64`) or
//!   [`Estimate`]s; dates are epoch ms.
//! * **TS sentinels** are `Option` or [`Num::MAX`] as documented on the
//!   engine queries they come from.
//! * **Round-trips through serde**, so a frontend in another process (or
//!   wasm's JSON boundary) can use the same types. To keep the per-tick JSON
//!   small (about 36 KB for a mid-game save, 56 KB with every detail),
//!   `None`, empty lists and `false` are left out: an absent field means
//!   that. `Num` is exact to 15 significant digits on the wire.
//!
//! # Cost and side effects
//!
//! [`Engine::view`] only reads the state. Like the TS UI's per-tick reads, it
//! fills the engine's memo caches, including the `PARITY(cache)` ones the
//! TS UI also filled every tick: sticky visibility (units are queried
//! before upgrades, in data order), the 3 s `isUpgradable` cache read by
//! buy-all, memoised stats and upgrade estimates. It never clears a cache
//! or bumps a generation. The heavy parts (stats, estimates with a
//! degree-20 bisection, effect details) are computed only for the units the
//! request focuses on, and whole sections can be skipped.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize};
use swarm_data::{
    json_num, EffectId, EffectKind, EffectParent, GameData, TabId, UnitId, UpgradeClass, UpgradeId,
};
use swarm_num::Num;

use crate::engine::{Engine, OfflineReport};
use crate::estimate::Estimate;
use crate::events::Event;
use crate::upgrade::UpgradeEstimate;
use crate::welcomeback::{WelcomeBack, WELCOME_BACK_MIN_MS};

/// Undo works for this long after a command (`UNDO_LIMIT_SECONDS`,
/// `app/src/game/progression.ts`).
pub const UNDO_LIMIT_SECS: f64 = 30.0;

/// "Buy cheapest" spends at most this share of each resource
/// (`CHEAPEST_PERCENT`, `app/src/game/progression.ts`).
pub const CHEAPEST_PERCENT: f64 = 0.25;

/// `(index, amount)` pairs: costs, productions, stats.
pub type Amounts = Vec<(u16, Num)>;

// ---------------------------------------------------------------- request

/// Which sections [`Engine::view`] computes. Skipped sections are left
/// empty (`Vec::new()` or `None`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Sections {
    /// [`View::units`].
    pub units: bool,
    /// [`View::upgrades`], [`View::buy_all`], [`View::buy_cheapest`].
    pub upgrades: bool,
    /// [`View::tabs`] and [`View::all_tab`].
    pub tabs: bool,
    /// [`View::achievements`].
    pub achievements: bool,
    /// [`View::ascension`].
    pub ascension: bool,
    /// [`View::statistics`].
    pub statistics: bool,
}

impl Sections {
    /// Every section.
    pub const ALL: Sections = Sections {
        units: true,
        upgrades: true,
        tabs: true,
        achievements: true,
        ascension: true,
        statistics: true,
    };
    /// No optional section: only the clock, hints, undo, welcome back and
    /// events.
    pub const NONE: Sections = Sections {
        units: false,
        upgrades: false,
        tabs: false,
        achievements: false,
        ascension: false,
        statistics: false,
    };
}

impl Default for Sections {
    fn default() -> Sections {
        Sections::ALL
    }
}

/// What [`Engine::view`] computes. The default is every section for every
/// unit and upgrade, without details: about what the web app's main screen
/// reads per tick. Ids out of range are ignored.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ViewRequest {
    /// Units shown in detail (the unit screen): their [`UnitDetail`], and
    /// the [`UpgradeDetail`] of the visible upgrades listed with them.
    #[serde(with = "unit_ids")]
    pub focus: Vec<UnitId>,
    /// Details for every visible unit and upgrade in scope (expensive: an
    /// estimate per upgrade).
    pub detail_all: bool,
    /// Limit [`View::units`] to these units and [`View::upgrades`] to the
    /// upgrades listed with them (see [`ViewRequest::for_tab`]). `None`: all.
    #[serde(with = "opt_unit_ids")]
    pub only_units: Option<Vec<UnitId>>,
    /// Sections to compute.
    pub sections: Sections,
    /// Extra fractions of the resources to compute `max_cost_met` for, in
    /// [`UnitView::max_cost_met_at`] and [`UpgradeView::max_cost_met_at`]
    /// (100% and 25% are always there).
    pub percents: Vec<f64>,
    /// Level counts to compute each upgrade's [`UpgradeView::sum_costs`]
    /// for (the cost of buying that many levels at once).
    pub sum_amounts: Vec<Num>,
}

impl Default for ViewRequest {
    fn default() -> ViewRequest {
        ViewRequest {
            focus: Vec::new(),
            detail_all: false,
            only_units: None,
            sections: Sections::ALL,
            percents: Vec::new(),
            sum_amounts: Vec::new(),
        }
    }
}

impl ViewRequest {
    /// A request for one tab's screen: its units and their upgrades, the
    /// tab bar and the cheap global sections, with `focus` in detail.
    pub fn for_tab(data: &GameData, tab: TabId, focus: Vec<UnitId>) -> ViewRequest {
        ViewRequest {
            focus,
            only_units: Some(data.tabs().get(tab).units.clone()),
            sections: Sections {
                statistics: false,
                ..Sections::ALL
            },
            ..ViewRequest::default()
        }
    }
}

// ---------------------------------------------------------------- view

/// One tick's view of the game. See the [module docs](self).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct View {
    /// Bumps on every view.
    pub seq: u64,
    /// The game clock, epoch ms.
    pub now_ms: i64,
    /// When the game started, epoch ms.
    pub started_ms: i64,
    /// When it last ascended, epoch ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restarted_ms: Option<i64>,
    /// When the counts were last written back, epoch ms.
    pub reified_ms: i64,
    /// Game time skipped since the last reify (swarmwarp), ms.
    pub skipped_ms: i64,
    /// Game time skipped in total, ms (statistics' "skipped").
    pub total_skipped_ms: i64,
    /// Time since the start, ms (statistics' "played").
    pub elapsed_ms: i64,
    /// When the 3 s caches (upgradable flags, buy-all) were last cleared, on
    /// the engine's clock. A frontend can skip re-rendering those when this
    /// hasn't moved.
    pub periodic_ms: i64,

    /// Units, in data order (all, or [`ViewRequest::only_units`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<UnitView>,
    /// Upgrades and abilities, in data order (all, or those listed with
    /// [`ViewRequest::only_units`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upgrades: Vec<UpgradeView>,
    /// What "buy all upgrades" buys (TS `availableAutobuyUpgrades()`). Can
    /// be up to 3 s stale, like the TS (PARITY(cache)).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buy_all: Vec<u16>,
    /// What "buy cheapest upgrades" buys: the same with
    /// [`CHEAPEST_PERCENT`] of the resources.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buy_cheapest: Vec<u16>,
    /// The tabs, in [`StaticView::tabs`] order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tabs: Vec<TabView>,
    /// The hidden "all units" tab's visible units, in table order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub all_tab: Vec<u16>,
    /// Achievements.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub achievements: Option<AchievementsView>,
    /// Ascension and respec.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ascension: Option<AscensionView>,
    /// Purchase statistics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statistics: Option<StatisticsView>,

    /// The undo button; `None` before the first undoable command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo: Option<UndoView>,
    /// The tutorial hint ([`Engine::tutorial_step`]).
    pub tutorial_step: u32,
    /// Units that spawned for the first time this session, with when (TS
    /// `cache.firstSpawn`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub first_spawn: Vec<(u16, i64)>,
    /// Time away, until dismissed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offline: Option<OfflineReport>,
    /// Offline gains, until dismissed ([`Engine::welcome_back`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub welcome_back: Option<WelcomeBack>,
    /// Events since the last view (drained).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<ViewEvent>,
}

/// A unit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UnitView {
    /// The unit's index.
    pub id: u16,
    /// Count now.
    pub count: Num,
    /// Per second.
    pub velocity: Num,
    /// Shown (sticky until respec, ascension, import or undo).
    #[serde(default, skip_serializing_if = "is_false")]
    pub visible: bool,
    /// Roman-numeral suffix ("" for none).
    pub suffix: String,
    /// Visible and buyable now.
    #[serde(default, skip_serializing_if = "is_false")]
    pub buyable: bool,
    /// Buy buttons shown.
    #[serde(default, skip_serializing_if = "is_false")]
    pub buy_button_visible: bool,
    /// At least one affordable.
    #[serde(default, skip_serializing_if = "is_false")]
    pub cost_met: bool,
    /// Affordable count ([`Num::MAX`] without costs). Multiply by
    /// `twin_mult` for the units received.
    pub max_cost_met: Num,
    /// Affordable with a quarter of the resources.
    pub max_cost_met_quarter: Num,
    /// Affordable with each of [`ViewRequest::percents`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub max_cost_met_at: Vec<Num>,
    /// Units received per unit bought.
    pub twin_mult: Num,
    /// Cost of one, after cost stats.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub each_cost: Amounts,
    /// Cap, if capped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap: Option<Num>,
    /// Count over cap, if capped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap_percent: Option<Num>,
    /// A visible upgrade listed with it is newly upgradable (the arrow).
    #[serde(default, skip_serializing_if = "is_false")]
    pub newly_upgradable: bool,
    /// Details, for focused units that are visible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<UnitDetail>,
}

/// The expensive parts of a [`UnitView`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UnitDetail {
    /// Its stats, by stat index, in the order computed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stats: Amounts,
    /// Production of one, per second.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub each_production: Amounts,
    /// Production of all of them, per second.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub total_production: Amounts,
    /// Resources spent on what is owned now (TS `spent()`).
    pub spent: Num,
    /// TS `maxCostMetOfVelocity`: how many one second of income buys
    /// (unfloored); `None` without costs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_met_of_velocity: Option<Num>,
    /// Seconds until one more is affordable at the current production: the
    /// slowest cost. `None` without costs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eta: Option<Estimate>,
    /// Seconds until the cap is reached, if capped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap_eta: Option<Estimate>,
    /// Its own effects ([`StaticUnit::effects`] order).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<EffectView>,
}

/// An upgrade or ability.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UpgradeView {
    /// The upgrade's index.
    pub id: u16,
    /// Level.
    pub count: Num,
    /// Shown (sticky).
    #[serde(default, skip_serializing_if = "is_false")]
    pub visible: bool,
    /// Visible and affordable.
    #[serde(default, skip_serializing_if = "is_false")]
    pub buyable: bool,
    /// An upgrade (not an ability) buyable now (TS `isUpgradable()`; up to
    /// 3 s stale, PARITY(cache)).
    #[serde(default, skip_serializing_if = "is_false")]
    pub upgradable: bool,
    /// The upgrade arrow: watched and affordable at the watch level.
    #[serde(default, skip_serializing_if = "is_false")]
    pub newly_upgradable: bool,
    /// Watch level: -1 hidden, 0 off, n = notify at 1/n of the resources.
    pub watched: i32,
    /// One level is affordable.
    #[serde(default, skip_serializing_if = "is_false")]
    pub cost_met: bool,
    /// Affordable levels ([`Num::MAX`] without costs).
    pub max_cost_met: Num,
    /// Affordable levels with a quarter of the resources.
    pub max_cost_met_quarter: Num,
    /// Affordable levels with each of [`ViewRequest::percents`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub max_cost_met_at: Vec<Num>,
    /// Progress to the next level, 0..=1; `None` where the TS gives NaN.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_met_percent: Option<Num>,
    /// Cost of the next level.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub total_cost: Amounts,
    /// Cost of each of [`ViewRequest::sum_amounts`] levels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sum_costs: Vec<Amounts>,
    /// Details, for visible upgrades of focused units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<UpgradeDetail>,
}

/// The expensive parts of an [`UpgradeView`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UpgradeDetail {
    /// When the next level is affordable.
    pub eta: UpgradeEta,
    /// Its effects ([`StaticUpgrade::effects`] order): what the live
    /// descriptions show.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<EffectView>,
}

/// [`UpgradeEstimate`], with indices.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpgradeEta {
    /// Every remaining level is affordable already.
    MaxAffordable,
    /// No next level (the TS throws a TypeError: show nothing).
    Unavailable,
    /// The wait for the slowest cost of the next level.
    Wait {
        /// Seconds; `Secs(NaN)` (`null` in JSON) in the TS's NaN case.
        secs: Estimate,
        /// The unit waited for.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unit: Option<u16>,
    },
}

impl From<UpgradeEstimate> for UpgradeEta {
    fn from(e: UpgradeEstimate) -> UpgradeEta {
        match e {
            UpgradeEstimate::MaxAffordable => UpgradeEta::MaxAffordable,
            UpgradeEstimate::Unavailable => UpgradeEta::Unavailable,
            UpgradeEstimate::Wait { secs, unit, .. } => UpgradeEta::Wait {
                secs,
                unit: unit.map(|u| u.0),
            },
        }
    }
}

/// An effect's live values (TS `effect.output()`, `outputNext()`, `bank()`,
/// `cap()`, `calcStats()`), for descriptions. The parameters are in
/// [`StaticView::effects`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EffectView {
    /// The effect's index.
    pub id: u16,
    /// The amount added or skipped (addUnit, addUnitByVelocity,
    /// compoundUnit, addUpgrade, skipTime).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Num>,
    /// addUnitRand: the roll at the current level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rand: Option<RandView>,
    /// addUnitRand: the roll one level up (what the next purchase gives).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rand_next: Option<RandView>,
    /// compoundUnit: the count it compounds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bank: Option<Num>,
    /// compoundUnit: the cap, if capped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap: Option<Num>,
    /// The stats it alone gives at the current level, by stat index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stats: Amounts,
    /// addUnitTimed: ms until the next grant is ready (0 when ready).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_remaining_ms: Option<f64>,
}

/// An addUnitRand roll.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct RandView {
    /// A spawn happens.
    #[serde(default, skip_serializing_if = "is_false")]
    pub spawned: bool,
    /// The quantity before the random factor.
    pub baseqty: Num,
    /// The quantity spawned.
    pub qty: Num,
}

/// A tab.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TabView {
    /// The tab's index.
    pub id: u16,
    /// Its lead unit is visible.
    #[serde(default, skip_serializing_if = "is_false")]
    pub visible: bool,
    /// One of its visible units has a newly upgradable upgrade.
    #[serde(default, skip_serializing_if = "is_false")]
    pub newly_upgradable: bool,
    /// Its visible units in the TS `sortUnits` order: highest tier first,
    /// stable-sorted by the `empower` stat, descending.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<u16>,
}

/// Achievements.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AchievementsView {
    /// Points earned.
    pub points: u32,
    /// Points earned over points possible, 0..=1.
    pub percent: f64,
    /// How many are earned.
    pub earned: u32,
    /// Per achievement, in data order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub list: Vec<AchievementView>,
}

/// An achievement.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AchievementView {
    /// Milliseconds after the start when earned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub earned_at: Option<i64>,
    /// Not masked.
    #[serde(default, skip_serializing_if = "is_false")]
    pub unmasked: bool,
    /// Sort key: 2 earned, -2 masked, progress, or -1.
    pub progress_order: f64,
    /// Count so far, for count achievements.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_val: Option<Num>,
    /// Count needed, for count achievements.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_max: Option<Num>,
}

/// Ascension and respec (the mutagen screen).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AscensionView {
    /// Times ascended.
    pub ascensions: Num,
    /// Energy spent on what is owned now.
    pub energy_spent: Num,
    /// Energy an ascension costs now.
    pub cost: Num,
    /// What it would cost with nothing spent (after a respec).
    pub base_cost: Num,
    /// Energy over cost, at most 1.
    pub cost_percent: Num,
    /// Cost minus the energy cap: positive means unaffordable until the cap
    /// is raised or the cost lowered.
    pub cap_diff: Num,
    /// Time until energy covers the cost, when that will happen (the app's
    /// `ascendEtaSecs`): `None` if capped out or already affordable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eta: Option<Estimate>,
    /// Energy covers the cost.
    #[serde(default, skip_serializing_if = "is_false")]
    pub can_ascend: bool,
    /// Mutagen an ascension would give.
    pub premutagen: Num,
    /// Energy a respec costs.
    pub respec_cost: Num,
    /// Mutagen a respec refunds.
    pub respec_spent: Num,
    /// A respec is possible: something to refund and its cost met.
    #[serde(default, skip_serializing_if = "is_false")]
    pub can_respec: bool,
    /// Free respecs left.
    pub free_respecs: Num,
    /// A free respec is possible.
    #[serde(default, skip_serializing_if = "is_false")]
    pub can_respec_free: bool,
}

/// Purchase statistics.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StatisticsView {
    /// Clicks on buy buttons.
    pub clicks: u64,
    /// Per unit bought, in data order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<ItemStatistics>,
    /// Per upgrade bought, in data order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upgrades: Vec<ItemStatistics>,
}

/// One unit's or upgrade's statistics.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ItemStatistics {
    /// The unit's or upgrade's index.
    pub id: u16,
    /// Clicks.
    pub clicks: u64,
    /// Bought.
    pub num: Num,
    /// Received (units; equals `num` for upgrades).
    pub twinnum: Num,
    /// Ms after the start of the first purchase.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_first: Option<i64>,
}

/// The undo button (`app/src/game/progression.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct UndoView {
    /// Undo is possible now: within [`UNDO_LIMIT_SECS`] of the command, and
    /// not an undo itself (that would redo).
    #[serde(default, skip_serializing_if = "is_false")]
    pub undoable: bool,
    /// Seconds since the command.
    pub secs_since: f64,
    /// Whole seconds left to undo; 0 when not undoable.
    pub secs_left: u32,
    /// Undoing would redo the undone command.
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_redo: bool,
}

/// An [`Event`], with indices.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewEvent {
    /// A command ran.
    Command {
        /// `buyUnit`, `buyMaxUnit`, `buyUpgrade`, `buyMaxUpgrade`,
        /// `buyAllUpgrades`, `ascension` or `respec`.
        name: String,
        /// The unit bought.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unit: Option<u16>,
        /// The upgrade bought.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        upgrade: Option<u16>,
        /// Bought.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        num: Option<Num>,
        /// Received.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        twinnum: Option<Num>,
    },
    /// First purchase of a unit or upgrade.
    BuyFirst {
        /// The unit, if a unit was bought.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unit: Option<u16>,
        /// The upgrade, if an upgrade was bought.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        upgrade: Option<u16>,
    },
    /// An achievement was earned.
    Achieved(u16),
    /// A command failed, with the TS error message.
    CommandFailed(String),
    /// The state changed and should be saved.
    SaveRequested,
}

impl From<Event> for ViewEvent {
    fn from(e: Event) -> ViewEvent {
        match e {
            Event::Command(c) => ViewEvent::Command {
                name: c.name.to_owned(),
                unit: c.unit.map(|u| u.0),
                upgrade: c.upgrade.map(|g| g.0),
                num: c.num,
                twinnum: c.twinnum,
            },
            Event::BuyFirst { unit, upgrade } => ViewEvent::BuyFirst {
                unit: unit.map(|u| u.0),
                upgrade: upgrade.map(|g| g.0),
            },
            Event::Achieved(a) => ViewEvent::Achieved(a.0),
            Event::CommandFailed(m) => ViewEvent::CommandFailed(m),
            Event::SaveRequested => ViewEvent::SaveRequested,
        }
    }
}

// ---------------------------------------------------------------- static

/// What never changes: names, texts, structure, effect parameters. Sent
/// once; the [`View`] refers to its lists by index.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaticView {
    /// Units, by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<StaticUnit>,
    /// Upgrades and abilities, by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upgrades: Vec<StaticUpgrade>,
    /// Achievements, by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub achievements: Vec<StaticAchievement>,
    /// Effects, by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<StaticEffect>,
    /// Stat names, by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stats: Vec<String>,
    /// The tabs, in order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tabs: Vec<StaticTab>,
    /// The hidden "all units" tab's units, in table order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub all_tab: Vec<u16>,
    /// Achievement points possible.
    pub achievement_points_possible: u32,
    /// Undo window, seconds.
    pub undo_limit_secs: f64,
    /// Minimum time away for a welcome-back report, ms.
    pub welcome_back_min_ms: i64,
    /// The respec's share of the ascension cost.
    pub respec_cost_rate: f64,
    /// [`CHEAPEST_PERCENT`].
    pub cheapest_percent: f64,
}

/// A unit type.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaticUnit {
    /// Unique name.
    pub name: String,
    /// URL slug.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    /// Singular label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Plural label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plural: Option<String>,
    /// Buy verb ("hatch").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verb: Option<String>,
    /// Buy verb, one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verbone: Option<String>,
    /// Buy verb, -ing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verbing: Option<String>,
    /// Description; "-" or none means a live template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Flavour text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lol: Option<String>,
    /// Its tab, if listed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<u16>,
    /// UI column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    /// UI tier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<u32>,
    /// Can't be bought.
    pub unbuyable: bool,
    /// Buy buttons hidden.
    pub is_buy_hidden: bool,
    /// Hidden and in no tab.
    pub disabled: bool,
    /// Kept when ascending.
    pub ascend_preserve: bool,
    /// The unit whose upgrades it also lists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub showparent: Option<u16>,
    /// Base cost of one (before stats).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cost: Amounts,
    /// Base production of one per second (before stats).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prod: Amounts,
    /// Upgrades listed with it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upgrades: Vec<u16>,
    /// Its own effects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<u16>,
    /// First-purchase warning: `(unit, threshold, text)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnfirst: Option<(u16, Option<Num>, Option<String>)>,
}

/// An upgrade or ability.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaticUpgrade {
    /// Unique name.
    pub name: String,
    /// Label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Description; "-" or none means a live template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Flavour text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lol: Option<String>,
    /// An ability (repeatable), not an upgrade.
    pub ability: bool,
    /// The unit it belongs to.
    pub unit: u16,
    /// Maximum level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maxlevel: Option<Num>,
    /// Costs of level 1 with their growth factor: `(unit, val, factor)`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cost: Vec<(u16, Num, Num)>,
    /// Its effects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<u16>,
}

/// An achievement.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaticAchievement {
    /// Unique name.
    pub name: String,
    /// Label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Long description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub longdesc: Option<String>,
    /// Points.
    pub points: u32,
}

/// An effect's parameters (the description templates' `effect.val` etc.).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaticEffect {
    /// The type's table name (`multStat`, `addUnitRand`, ...).
    pub kind: String,
    /// The unit it belongs to, for unit effects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_unit: Option<u16>,
    /// The upgrade it belongs to, for upgrade effects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_upgrade: Option<u16>,
    /// Target unit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<u16>,
    /// Second unit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit2: Option<u16>,
    /// Target upgrade.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upgrade: Option<u16>,
    /// The stat written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stat: Option<u16>,
    /// First parameter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val: Option<Num>,
    /// Second parameter (addUnitTimed: seconds; compoundUnit: cap).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val2: Option<Num>,
    /// Third parameter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val3: Option<Num>,
}

/// A tab.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaticTab {
    /// Name.
    pub name: String,
    /// The lead unit, which decides visibility.
    pub lead: u16,
    /// Units in table order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<u16>,
}

// ---------------------------------------------------------------- engine

#[allow(clippy::trivially_copy_pass_by_ref)] // serde's skip_serializing_if signature
fn is_false(b: &bool) -> bool {
    !*b
}

fn amounts(it: impl IntoIterator<Item = (u16, Num)>) -> Amounts {
    it.into_iter().collect()
}

impl Engine {
    /// Computes the view and drains the events. See the [module
    /// docs](self) for what it reads and caches; it never changes the state.
    pub fn view(&mut self, req: &ViewRequest) -> View {
        let data = self.data;
        let nunits = data.units().len();
        let nupgrades = data.upgrades().len();
        let valid = |u: &UnitId| u.index() < nunits;
        let focus: BTreeSet<UnitId> = req.focus.iter().copied().filter(valid).collect();
        let scope: Option<Vec<UnitId>> = req.only_units.as_ref().map(|list| {
            let set: BTreeSet<UnitId> = list.iter().copied().filter(valid).collect();
            set.into_iter().collect()
        });
        let percents: Vec<Num> = req.percents.iter().map(|&p| json_num(p)).collect();
        let quarter = json_num(0.25);

        // units first: visibility is sticky, so query order matters
        let unit_ids: Vec<UnitId> = match &scope {
            Some(list) => list.clone(),
            None => data.units().iter().map(|u| u.id).collect(),
        };
        let units = if req.sections.units {
            unit_ids
                .iter()
                .map(|&id| {
                    let detail = req.detail_all || focus.contains(&id);
                    self.unit_view(id, &percents, quarter, detail)
                })
                .collect()
        } else {
            Vec::new()
        };

        let (upgrades, buy_all, buy_cheapest) = if req.sections.upgrades {
            let mut ids: Vec<UpgradeId> = match &scope {
                Some(list) => {
                    let set: BTreeSet<UpgradeId> = list
                        .iter()
                        .flat_map(|&u| data.unit(u).upgrades.iter().copied())
                        .collect();
                    set.into_iter().collect()
                }
                None => data.upgrades().iter().map(|g| g.id).collect(),
            };
            ids.retain(|g| g.index() < nupgrades);
            let detailed: BTreeSet<UpgradeId> = focus
                .iter()
                .flat_map(|&u| data.unit(u).upgrades.iter().copied())
                .collect();
            let upgrades = ids
                .iter()
                .map(|&id| {
                    let detail = req.detail_all || detailed.contains(&id);
                    self.upgrade_view(id, &percents, quarter, &req.sum_amounts, detail)
                })
                .collect();
            let ids = |v: Vec<UpgradeId>| v.into_iter().map(|g| g.0).collect::<Vec<_>>();
            (
                upgrades,
                ids(self.available_autobuy_upgrades(None)),
                ids(self.available_autobuy_upgrades(Some(json_num(CHEAPEST_PERCENT)))),
            )
        } else {
            (Vec::new(), Vec::new(), Vec::new())
        };

        let (tabs, all_tab) = if req.sections.tabs {
            let tabs = data
                .tabs()
                .list
                .iter()
                .enumerate()
                .map(|(i, t)| TabView {
                    id: i as u16,
                    visible: self.unit_visible(t.lead),
                    newly_upgradable: t
                        .units
                        .iter()
                        .any(|&u| self.unit_visible(u) && self.unit_is_newly_upgradable(u)),
                    units: self
                        .sort_tab_units(t.sorted_units())
                        .into_iter()
                        .filter(|&u| self.unit_visible(u))
                        .map(|u| u.0)
                        .collect(),
                })
                .collect();
            let all = data
                .tabs()
                .all
                .units
                .iter()
                .filter(|&&u| self.unit_visible(u))
                .map(|u| u.0)
                .collect();
            (tabs, all)
        } else {
            (Vec::new(), Vec::new())
        };

        let achievements = req.sections.achievements.then(|| {
            let list: Vec<AchievementView> = data
                .achievements()
                .iter()
                .map(|a| AchievementView {
                    earned_at: self.achievement_earned_at(a.id),
                    unmasked: self.achievement_unmasked(a.id),
                    progress_order: self.achievement_progress_order(a.id),
                    progress_val: self.achievement_progress_val(a.id),
                    progress_max: self.achievement_progress_max(a.id),
                })
                .collect();
            AchievementsView {
                points: self.achievement_points(),
                percent: self.achievement_percent(),
                earned: list.iter().filter(|a| a.earned_at.is_some()).count() as u32,
                list,
            }
        });
        let ascension = req.sections.ascension.then(|| self.ascension_view());
        let statistics = req.sections.statistics.then(|| self.statistics_view());

        self.rt.view_seq += 1;
        let periodic_ms = self.cache.borrow().last_periodic_ms;
        let events = self
            .drain_events()
            .into_iter()
            .map(ViewEvent::from)
            .collect();
        let d = &self.state.dates;
        View {
            seq: self.rt.view_seq,
            now_ms: self.rt.now_ms,
            started_ms: d.started,
            restarted_ms: d.restarted,
            reified_ms: d.reified,
            skipped_ms: self.rt.skipped_ms,
            total_skipped_ms: self.state.skipped_ms,
            elapsed_ms: self.elapsed_start_ms(),
            periodic_ms,
            units,
            upgrades,
            buy_all,
            buy_cheapest,
            tabs,
            all_tab,
            achievements,
            ascension,
            statistics,
            undo: self.undo_window(),
            tutorial_step: self.tutorial_step(),
            first_spawn: self.rt.first_spawn.iter().map(|(u, &t)| (u.0, t)).collect(),
            offline: self.rt.offline,
            welcome_back: self.welcome_back().cloned(),
            events,
        }
    }

    fn unit_view(&self, id: UnitId, percents: &[Num], quarter: Num, detail: bool) -> UnitView {
        let visible = self.unit_visible(id);
        UnitView {
            id: id.0,
            count: self.count(id),
            velocity: self.velocity(id),
            visible,
            suffix: self.suffix(id),
            buyable: visible && self.unit_is_buyable(id, false),
            buy_button_visible: visible && self.is_buy_button_visible(id),
            cost_met: self.unit_is_cost_met(id),
            max_cost_met: self.unit_max_cost_met(id, Num::ONE),
            max_cost_met_quarter: self.unit_max_cost_met(id, quarter),
            max_cost_met_at: percents
                .iter()
                .map(|&p| self.unit_max_cost_met(id, p))
                .collect(),
            twin_mult: self.twin_mult(id),
            each_cost: amounts(self.each_cost(id).into_iter().map(|c| (c.unit.0, c.val))),
            cap: self.cap(id),
            cap_percent: self.cap_percent(id),
            newly_upgradable: visible && self.unit_is_newly_upgradable(id),
            detail: (detail && visible).then(|| self.unit_detail(id)),
        }
    }

    fn unit_detail(&self, id: UnitId) -> UnitDetail {
        let mut eta: Option<Estimate> = None;
        for c in self.each_cost(id) {
            if !c.val.is_positive() {
                continue;
            }
            let e = self.estimate_secs_until_earned(c.unit, c.val);
            eta = Some(match eta {
                Some(prev) if prev.secs() >= e.secs() => prev,
                _ => e,
            });
        }
        UnitDetail {
            stats: amounts(self.stats(id).into_iter().map(|(s, v)| (s.0, v))),
            each_production: amounts(self.each_production(id).into_iter().map(|(u, v)| (u.0, v))),
            total_production: amounts(self.total_production(id).into_iter().map(|(u, v)| (u.0, v))),
            spent: self.spent(id, &[]),
            max_cost_met_of_velocity: self.cost_met_percent_of_velocity(id),
            eta,
            cap_eta: self.cap_eta(id),
            effects: self
                .data
                .unit(id)
                .effects
                .iter()
                .map(|&e| self.effect_view(e))
                .collect(),
        }
    }

    fn upgrade_view(
        &self,
        id: UpgradeId,
        percents: &[Num],
        quarter: Num,
        sum_amounts: &[Num],
        detail: bool,
    ) -> UpgradeView {
        let visible = self.upgrade_visible(id);
        UpgradeView {
            id: id.0,
            count: self.upgrade_count(id),
            visible,
            buyable: visible && self.upgrade_is_buyable(id),
            upgradable: visible && self.upgrade_is_upgradable(id, None, false),
            newly_upgradable: visible && self.upgrade_is_newly_upgradable(id, 1.0),
            watched: self.watched_at(id),
            cost_met: self.upgrade_is_cost_met(id),
            max_cost_met: self.upgrade_max_cost_met(id, Num::ONE),
            max_cost_met_quarter: self.upgrade_max_cost_met(id, quarter),
            max_cost_met_at: percents
                .iter()
                .map(|&p| self.upgrade_max_cost_met(id, p))
                .collect(),
            cost_met_percent: self.upgrade_cost_met_percent(id),
            total_cost: amounts(self.total_cost(id).into_iter().map(|c| (c.unit.0, c.val))),
            sum_costs: sum_amounts
                .iter()
                .map(|&n| {
                    amounts(
                        self.sum_cost(id, n, None)
                            .into_iter()
                            .map(|c| (c.unit.0, c.val)),
                    )
                })
                .collect(),
            detail: (detail && visible).then(|| UpgradeDetail {
                eta: self.estimate_secs_until_buyable(id).into(),
                effects: self
                    .data
                    .upgrade(id)
                    .effects
                    .iter()
                    .map(|&e| self.effect_view(e))
                    .collect(),
            }),
        }
    }

    /// An effect's live values (see [`EffectView`]).
    pub fn effect_view(&self, effect: EffectId) -> EffectView {
        let e = self.data.effect(effect);
        let rand = |o: crate::EffectOutput| match o {
            crate::EffectOutput::Rand(r) => Some(RandView {
                spawned: r.spawned,
                baseqty: r.baseqty,
                qty: r.qty,
            }),
            _ => None,
        };
        let output = self.effect_output(effect, None);
        let is_rand = e.kind == EffectKind::AddUnitRand;
        EffectView {
            id: effect.0,
            output: output.num(),
            rand: rand(output),
            rand_next: if is_rand {
                rand(self.effect_output_next(effect))
            } else {
                None
            },
            bank: self.effect_bank(effect),
            cap: self.effect_cap(effect),
            stats: amounts(self.effect_stats(effect).into_iter().map(|(s, v)| (s.0, v))),
            timer_remaining_ms: match (e.kind, e.unit) {
                (EffectKind::AddUnitTimed, Some(u)) => {
                    let secs = e.val2.map_or(0.0, |v| v.to_f64());
                    Some(self.add_unit_timer_remaining_ms(u, secs * 1000.0))
                }
                _ => None,
            },
        }
    }

    /// The stats this effect alone gives at its parent's current level (TS
    /// `effect.calcStats()`, which the live descriptions read).
    pub fn effect_stats(&self, effect: EffectId) -> crate::cache::Stats {
        let mut stats = crate::cache::Stats::new();
        let level = self.effect_parent_count(effect);
        self.calc_stats(effect, &mut stats, level);
        stats
    }

    /// Units in the TS `Tab.sortUnits` order, given the tab's
    /// `sortedUnits` (highest tier first): stable-sorted by the `empower`
    /// stat, descending. (The hidden "all" tab isn't sorted.)
    pub fn sort_tab_units(&self, sorted_units: impl IntoIterator<Item = UnitId>) -> Vec<UnitId> {
        let empower = self.data.stats().empower;
        let mut keyed: Vec<(f64, UnitId)> = sorted_units
            .into_iter()
            .map(|u| (-self.stat(u, empower, Num::ZERO).to_f64(), u))
            .collect();
        // lodash sortBy is stable; NaN keys don't occur (Num has none)
        keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
        keyed.into_iter().map(|(_, u)| u).collect()
    }

    /// The units of a tab in the TS `sortUnits` order, all of them (filter
    /// by visibility for what a screen lists).
    pub fn sorted_tab_units(&self, tab: TabId) -> Vec<UnitId> {
        self.sort_tab_units(self.data.tabs().get(tab).sorted_units())
    }

    fn ascension_view(&self) -> AscensionView {
        let wk = self.data.well_known();
        let cost = self.ascend_cost(None);
        let cost_percent = self.ascend_cost_percent(cost);
        let cap_diff = self.ascend_cost_cap_diff(cost);
        let respec_spent = self.respec_spent();
        let free_respecs = self.count(wk.free_respec);
        AscensionView {
            ascensions: self.count(wk.ascension),
            energy_spent: self.ascend_energy_spent(),
            cost,
            base_cost: self.ascend_cost(Some(Num::ZERO)),
            cost_percent,
            cap_diff,
            eta: if cap_diff.is_positive() || cost_percent >= Num::ONE {
                None
            } else {
                self.ascend_cost_duration(cost)
            },
            can_ascend: cost_percent >= Num::ONE,
            premutagen: self.count(wk.premutagen),
            respec_cost: self.respec_cost(),
            respec_spent,
            can_respec: !respec_spent.is_zero() && self.is_respec_cost_met(),
            free_respecs,
            can_respec_free: !respec_spent.is_zero() && free_respecs.is_positive(),
        }
    }

    fn statistics_view(&self) -> StatisticsView {
        let st = &self.state.statistics;
        let data = self.data;
        let units = data
            .units()
            .iter()
            .filter_map(|u| {
                st.by_unit.get(&u.name).map(|s| ItemStatistics {
                    id: u.id.0,
                    clicks: s.clicks,
                    num: s.num,
                    twinnum: s.twinnum,
                    elapsed_first: s.elapsed_first,
                })
            })
            .collect();
        let upgrades = data
            .upgrades()
            .iter()
            .filter_map(|g| {
                st.by_upgrade.get(&g.name).map(|s| ItemStatistics {
                    id: g.id.0,
                    clicks: s.clicks,
                    num: s.num,
                    twinnum: s.num,
                    elapsed_first: s.elapsed_first,
                })
            })
            .collect();
        StatisticsView {
            clicks: st.clicks,
            units,
            upgrades,
        }
    }

    /// The undo button's state (`app/src/game/progression.ts`); `None`
    /// before the first undoable command.
    pub fn undo_window(&self) -> Option<UndoView> {
        let undo = self.rt.undo.as_ref()?;
        let secs_since = (self.rt.now_ms - undo.date_ms) as f64 / 1000.0;
        let undoable = secs_since < UNDO_LIMIT_SECS && !undo.is_redo;
        Some(UndoView {
            undoable,
            secs_since,
            // JS Math.round
            secs_left: if undoable {
                (UNDO_LIMIT_SECS - secs_since + 0.5).floor().max(0.0) as u32
            } else {
                0
            },
            is_redo: undo.is_redo,
        })
    }

    /// Undo is possible now (the app's `isUndoable`).
    pub fn is_undoable(&self) -> bool {
        self.undo_window().is_some_and(|u| u.undoable)
    }

    /// Names, texts, tabs and effect parameters: everything that never
    /// changes.
    pub fn static_view(&self) -> StaticView {
        let d = self.data;
        let ids = |v: &[UnitId]| v.iter().map(|u| u.0).collect::<Vec<_>>();
        StaticView {
            units: d
                .units()
                .iter()
                .map(|u| StaticUnit {
                    name: u.name.clone(),
                    slug: u.slug.clone(),
                    label: u.text.label.clone(),
                    plural: u.text.plural.clone(),
                    verb: u.text.verb.clone(),
                    verbone: u.text.verbone.clone(),
                    verbing: u.text.verbing.clone(),
                    description: u.text.description.clone(),
                    lol: u.text.lol.clone(),
                    tab: d.tabs().of_unit(u.id).map(|t| t.index() as u16),
                    column: u.column,
                    tier: u.tier,
                    unbuyable: u.unbuyable,
                    is_buy_hidden: u.is_buy_hidden,
                    disabled: u.disabled,
                    ascend_preserve: u.ascend_preserve,
                    showparent: u.showparent.map(|p| p.0),
                    cost: amounts(u.cost.iter().map(|c| (c.unit.0, c.val))),
                    prod: amounts(u.prod.iter().map(|c| (c.unit.0, c.val))),
                    upgrades: u.upgrades.iter().map(|g| g.0).collect(),
                    effects: u.effects.iter().map(|e| e.0).collect(),
                    warnfirst: u
                        .warnfirst
                        .as_ref()
                        .map(|w| (w.unit.0, w.val, w.text.clone())),
                })
                .collect(),
            upgrades: d
                .upgrades()
                .iter()
                .map(|g| StaticUpgrade {
                    name: g.name.clone(),
                    label: g.text.label.clone(),
                    description: g.text.description.clone(),
                    lol: g.text.lol.clone(),
                    ability: g.class == UpgradeClass::Ability,
                    unit: g.unit.0,
                    maxlevel: g.maxlevel,
                    cost: g.cost.iter().map(|c| (c.unit.0, c.val, c.factor)).collect(),
                    effects: g.effects.iter().map(|e| e.0).collect(),
                })
                .collect(),
            achievements: d
                .achievements()
                .iter()
                .map(|a| StaticAchievement {
                    name: a.name.clone(),
                    label: a.text.label.clone(),
                    description: a.text.description.clone(),
                    longdesc: a.text.longdesc.clone(),
                    points: a.points,
                })
                .collect(),
            effects: d
                .effects()
                .iter()
                .map(|e| StaticEffect {
                    kind: e.kind.name().to_owned(),
                    parent_unit: match e.parent {
                        EffectParent::Unit(u) => Some(u.0),
                        EffectParent::Upgrade(_) => None,
                    },
                    parent_upgrade: match e.parent {
                        EffectParent::Upgrade(g) => Some(g.0),
                        EffectParent::Unit(_) => None,
                    },
                    unit: e.unit.map(|u| u.0),
                    unit2: e.unit2.map(|u| u.0),
                    upgrade: e.upgrade.map(|g| g.0),
                    stat: e.stat.map(|s| s.0),
                    val: e.val,
                    val2: e.val2,
                    val3: e.val3,
                })
                .collect(),
            stats: d.stat_names().to_vec(),
            tabs: d
                .tabs()
                .list
                .iter()
                .map(|t| StaticTab {
                    name: t.name.clone(),
                    lead: t.lead.0,
                    units: ids(&t.units),
                })
                .collect(),
            all_tab: ids(&d.tabs().all.units),
            achievement_points_possible: d.achievement_points_possible(),
            undo_limit_secs: UNDO_LIMIT_SECS,
            welcome_back_min_ms: WELCOME_BACK_MIN_MS,
            respec_cost_rate: crate::progression::RESPEC_COST_RATE,
            cheapest_percent: CHEAPEST_PERCENT,
        }
    }
}

// ---------------------------------------------------------------- serde

impl<'de> Deserialize<'de> for Estimate {
    /// The inverse of its `Serialize`: `{"reached":true}`, `{"secs":x}`
    /// (`null` is NaN) or `{"never":true}`.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Estimate, D::Error> {
        use serde::de::Error;
        let m = serde_json::Map::<String, serde_json::Value>::deserialize(d)?;
        if m.contains_key("reached") {
            Ok(Estimate::Reached)
        } else if m.contains_key("never") {
            Ok(Estimate::Never)
        } else if let Some(v) = m.get("secs") {
            Ok(Estimate::Secs(v.as_f64().unwrap_or(f64::NAN)))
        } else {
            Err(D::Error::custom("expected reached, secs or never"))
        }
    }
}

/// `Vec<UnitId>` as indices.
mod unit_ids {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use swarm_data::UnitId;

    pub fn serialize<S: Serializer>(v: &[UnitId], s: S) -> Result<S::Ok, S::Error> {
        v.iter().map(|u| u.0).collect::<Vec<u16>>().serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<UnitId>, D::Error> {
        Ok(Vec::<u16>::deserialize(d)?
            .into_iter()
            .map(UnitId)
            .collect())
    }
}

/// `Option<Vec<UnitId>>` as indices.
mod opt_unit_ids {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use swarm_data::UnitId;

    pub fn serialize<S: Serializer>(v: &Option<Vec<UnitId>>, s: S) -> Result<S::Ok, S::Error> {
        v.as_ref()
            .map(|v| v.iter().map(|u| u.0).collect::<Vec<u16>>())
            .serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<UnitId>>, D::Error> {
        Ok(Option::<Vec<u16>>::deserialize(d)?.map(|v| v.into_iter().map(UnitId).collect()))
    }
}
