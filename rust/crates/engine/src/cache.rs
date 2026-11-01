//! The runtime caches (`engine/src/game.ts` `Cache`), as explicit
//! generations. None of this is persisted; it is rebuilt on load, undo and
//! ascension (TS `Game._init` creates a new `Cache`).
//!
//! Most entries are plain memos: recomputing them gives the same value. A
//! few **change game behaviour** and are kept for parity with the TS engine
//! (plan section 0 point 3); each is marked `PARITY(cache)` where it is
//! read, so it can be revisited after cut-over:
//!
//! * `stats` (update generation): a unit's stats read other units' counts
//!   and the achievement points when computed, and keep those values until
//!   the next state change, even as time passes or achievements are earned
//!   without a reify (`game.ts:60-74`).
//! * `unit_visible` / `upgrade_visible` (respec generation): visibility is
//!   sticky once seen (`unit.ts:553-561`, `upgrade.ts:109-124`).
//! * `upgradable` (periodic generation, 3000 ms of the clock): stale
//!   `isUpgradable`, which drives buy-all (`upgrade.ts:283-291`).
//! * `upgrade_estimate` (update generation): an upgrade's estimate, minus the
//!   time elapsed since it was computed (`upgrade.ts:231-259`).

use std::collections::HashMap;

use swarm_data::{EffectId, EffectKind, GameData, StatId, UnitAmount, UnitId, UpgradeId};
use swarm_num::Num;

use crate::upgrade::{UpgradeCostVal, UpgradeEstimateCached};

/// Milliseconds of clock time between periodic clears (`game.ts:86`).
pub const PERIODIC_MS: i64 = 3000;

/// A unit's folded stats, in the order first written (TS object key order).
pub type Stats = Vec<(StatId, Num)>;

#[derive(Clone, Debug)]
pub(crate) struct Cache {
    // ---- update generation (any state change) ----
    pub raw_count: Vec<Option<Num>>,
    pub stats: Vec<Option<Stats>>,
    pub prod_each: Vec<Option<Num>>,
    pub coefficients: Vec<Option<Vec<Num>>>,
    pub cap: Vec<Option<Option<Num>>>,
    pub upgrade_estimate: HashMap<UpgradeId, UpgradeEstimateCached>,
    /// An upgrade's next-level cost (a pure memo of its level and stats).
    pub total_cost: Vec<Option<Vec<UpgradeCostVal>>>,
    /// A unit's cost of one (a pure memo of its stats).
    pub each_cost: Vec<Option<Vec<UnitAmount>>>,
    // ---- tick generation (the clock moved) ----
    /// `json_num(diff_seconds)`, keyed by the `f64` (a pure memo).
    pub diff_seconds: Option<(f64, Num)>,
    pub count: Vec<Option<Num>>,
    pub velocity: Vec<Option<Num>>,
    // ---- periodic generation ----
    pub last_periodic_ms: i64,
    pub upgradable: HashMap<(UpgradeId, Num), bool>,
    // ---- respec generation ----
    pub unit_visible: Vec<bool>,
    pub upgrade_visible: Vec<bool>,
    // ---- never cleared (derived from the data) ----
    /// Per unit, the last `suffix` effect targeting it.
    pub suffix_effect: Vec<Option<EffectId>>,
}

impl Cache {
    pub fn new(data: &GameData, clock_ms: i64) -> Cache {
        let units = data.units().len();
        let upgrades = data.upgrades().len();
        let paths = data.producer_paths().len();
        Cache {
            raw_count: vec![None; units],
            stats: vec![None; units],
            prod_each: vec![None; paths],
            coefficients: vec![None; units],
            cap: vec![None; units],
            upgrade_estimate: HashMap::new(),
            total_cost: vec![None; upgrades],
            each_cost: vec![None; units],
            diff_seconds: None,
            count: vec![None; units],
            velocity: vec![None; units],
            last_periodic_ms: clock_ms,
            upgradable: HashMap::new(),
            unit_visible: vec![false; units],
            upgrade_visible: vec![false; upgrades],
            suffix_effect: {
                let mut list = vec![None; units];
                for e in data.effects() {
                    if let (EffectKind::Suffix, Some(u)) = (e.kind, e.unit) {
                        list[u.index()] = Some(e.id);
                    }
                }
                list
            },
        }
    }

    /// `Cache.onPeriodic`.
    pub fn on_periodic(&mut self, clock_ms: i64) {
        self.last_periodic_ms = clock_ms;
        self.upgradable.clear();
    }

    /// `Cache.onTick`: tick-level memos, and the periodic ones every 3 s.
    pub fn on_tick(&mut self, clock_ms: i64) {
        self.count.iter_mut().for_each(|c| *c = None);
        self.velocity.iter_mut().for_each(|c| *c = None);
        if clock_ms - self.last_periodic_ms >= PERIODIC_MS {
            self.on_periodic(clock_ms);
        }
    }

    /// `Cache.onUpdate`: everything but visibility.
    pub fn on_update(&mut self, clock_ms: i64) {
        self.on_periodic(clock_ms);
        self.on_tick(clock_ms);
        self.raw_count.iter_mut().for_each(|c| *c = None);
        self.stats.iter_mut().for_each(|c| *c = None);
        self.prod_each.iter_mut().for_each(|c| *c = None);
        self.coefficients.iter_mut().for_each(|c| *c = None);
        self.cap.iter_mut().for_each(|c| *c = None);
        self.upgrade_estimate.clear();
        self.total_cost.iter_mut().for_each(|c| *c = None);
        self.each_cost.iter_mut().for_each(|c| *c = None);
    }

    /// `Cache.onRespec`: forget sticky visibility.
    pub fn on_respec(&mut self) {
        self.unit_visible.iter_mut().for_each(|v| *v = false);
        self.upgrade_visible.iter_mut().for_each(|v| *v = false);
    }

    pub fn stat(&self, unit: UnitId, stat: StatId) -> Option<Num> {
        self.stats[unit.index()]
            .as_ref()
            .and_then(|s| s.iter().find(|(id, _)| *id == stat).map(|&(_, n)| n))
    }
}
