//! Upgrades and abilities (`engine/src/upgrade.ts` `Upgrade`).

use swarm_data::{UnitId, UpgradeClass, UpgradeId};
use swarm_num::Num;

use crate::command::CommandError;
use crate::engine::Engine;
use crate::estimate::Estimate;
use crate::state::UpgradeStatistics;

/// The most levels one purchase may buy. `Upgrade.buy` runs every effect
/// once per level (`upgrade.ts:323-327`) and the TS first builds an array of
/// that size, so a larger purchase would hang; this one is refused.
pub const MAX_LEVELS_PER_BUY: f64 = 1e7;

/// One cost of an upgrade, with its growth factor.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UpgradeCostVal {
    /// The unit paid.
    pub unit: UnitId,
    /// How much.
    pub val: Num,
    /// Growth per level.
    pub factor: Num,
}

/// When an upgrade becomes affordable (`upgrade.ts` `estimateSecsUntilBuyable`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum UpgradeEstimate {
    /// Every remaining level is affordable already (TS `{val: Infinity}`).
    MaxAffordable,
    /// One more level would pass `maxlevel`. The TS throws a TypeError here
    /// ([`UPGRADE_ESTIMATE_TYPE_ERROR`]).
    Unavailable,
    /// The wait for the slowest cost of the next level.
    Wait {
        /// Seconds, as of now. `Secs(NaN)` in the odd case where no cost
        /// needs waiting for (the TS gives NaN too).
        secs: Estimate,
        /// The unit waited for.
        unit: Option<UnitId>,
        /// TS `cacheSafe` (always true: bisection estimates are cacheable).
        cache_safe: bool,
    },
}

/// The TS error for [`UpgradeEstimate::Unavailable`].
pub const UPGRADE_ESTIMATE_TYPE_ERROR: &str =
    "Cannot read properties of undefined (reading 'plus')";

/// The cost of `num` levels from a level's cost: the geometric series, or
/// `val · num` when `factor == 1` (`upgrade.ts:149-162`).
fn sum_cost_of(mut c: UpgradeCostVal, num: Num) -> UpgradeCostVal {
    if c.factor == Num::ONE {
        c.val *= num;
    } else {
        c.val *= (Num::ONE - c.factor.pow_num(&num)) / (Num::ONE - c.factor);
    }
    c
}

/// A difference of two values of magnitude `scale`, with differences below
/// `Num`'s precision (a few ulps) taken as exactly zero: decimal.js loses
/// them too, at 20 digits, where `Num` would keep an ulp of noise.
pub(crate) fn absorbed(diff: Num, scale: Num) -> Num {
    if diff.abs() <= scale * Num::from_f64(4.0 * f64::EPSILON) {
        Num::ZERO
    } else {
        diff
    }
}

/// A quotient with the JS/decimal.js special values, for the few places
/// where the TS lets them flow into `Decimal.min`/`max`.
#[derive(Clone, Copy, Debug, PartialEq)]
enum JsRatio {
    Finite(Num),
    PosInf,
    NegInf,
    NaN,
}

impl JsRatio {
    fn div(a: Num, b: Num) -> JsRatio {
        if !b.is_zero() {
            JsRatio::Finite(a / b)
        } else if a.is_zero() {
            JsRatio::NaN
        } else if a.is_positive() == !b.is_negative() {
            JsRatio::PosInf
        } else {
            JsRatio::NegInf
        }
    }

    /// `Decimal.min(self, other)`: NaN wins.
    fn min(self, other: JsRatio) -> JsRatio {
        use JsRatio::*;
        match (self, other) {
            (NaN, _) | (_, NaN) => NaN,
            (NegInf, _) | (_, NegInf) => NegInf,
            (PosInf, x) | (x, PosInf) => x,
            (Finite(a), Finite(b)) => Finite(a.min(b)),
        }
    }
}

/// A cached estimate: the raw value, and when it was taken.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum UpgradeEstimateCached {
    Unavailable,
    Wait {
        /// `None`: infinite.
        raw: Option<Num>,
        unit: Option<UnitId>,
        at_ms: Option<i64>,
    },
}

impl Engine {
    /// The level (TS `count()`), never above `maxlevel`.
    pub fn upgrade_count(&self, upgrade: UpgradeId) -> Num {
        let g = self.data.upgrade(upgrade);
        let ret = self
            .state
            .upgrades
            .get(&g.name)
            .copied()
            .unwrap_or(Num::ZERO);
        match g.maxlevel {
            Some(m) => m.min(ret),
            None => ret,
        }
    }

    /// Sets the level (TS `_setCount`). Low level: no reify, no save.
    pub fn set_upgrade_count(&mut self, upgrade: UpgradeId, val: Num) {
        let name = self.data.upgrade(upgrade).name.clone();
        self.state.upgrades.insert(name, val);
        self.on_update();
    }

    /// Adds levels (TS `_addCount`).
    pub fn add_upgrade_count(&mut self, upgrade: UpgradeId, val: Num) {
        let v = self.upgrade_count(upgrade) + val;
        self.set_upgrade_count(upgrade, v);
    }

    /// Visible: its unit is visible (or disabled), below `maxlevel`, and
    /// either seen since the last respec (PARITY(cache): sticky), owned, or
    /// every requirement met (`upgrade.ts:109-135`).
    pub fn upgrade_visible(&self, upgrade: UpgradeId) -> bool {
        let g = self.data.upgrade(upgrade);
        if !self.unit_visible(g.unit) && !self.data.unit(g.unit).disabled {
            return false;
        }
        if let Some(m) = g.maxlevel {
            if self.upgrade_count(upgrade) >= m {
                return false;
            }
        }
        if self.cache.borrow().upgrade_visible[upgrade.index()] {
            return true;
        }
        let v = self.upgrade_count(upgrade).is_positive()
            || g.requires.iter().all(|r| r.val <= self.count(r.unit));
        self.cache.borrow_mut().upgrade_visible[upgrade.index()] = v;
        v
    }

    /// The cost of the next level (`upgrade.ts:136-148`).
    /// Cached in the update generation.
    pub fn total_cost(&self, upgrade: UpgradeId) -> Vec<UpgradeCostVal> {
        if let Some(v) = &self.cache.borrow().total_cost[upgrade.index()] {
            return v.clone();
        }
        let v = self.compute_total_cost(upgrade);
        self.cache.borrow_mut().total_cost[upgrade.index()] = Some(v.clone());
        v
    }

    fn compute_total_cost(&self, upgrade: UpgradeId) -> Vec<UpgradeCostVal> {
        let unit = self.data.upgrade(upgrade).unit;
        let level =
            self.upgrade_count(upgrade) + self.stat(unit, self.data.stats().upgradecost, Num::ZERO);
        self.total_cost_at(upgrade, level)
    }

    /// The cost of level `count + 1`: `val · factor^count · upgradecostmult ·
    /// upgradecostmult.<name>`.
    pub fn total_cost_at(&self, upgrade: UpgradeId, count: Num) -> Vec<UpgradeCostVal> {
        let g = self.data.upgrade(upgrade);
        let s = self.data.stats();
        let mult = self.stat(g.unit, s.upgradecostmult, Num::ONE);
        let mult_this = self.stat(g.unit, g.upgradecostmult_stat, Num::ONE);
        g.cost
            .iter()
            .map(|c| UpgradeCostVal {
                unit: c.unit,
                val: c.val * c.factor.pow_num(&count) * mult * mult_this,
                factor: c.factor,
            })
            .collect()
    }

    /// The cost of `num` levels starting after `start` (default: the next
    /// level): the geometric series, or `val · num` when `factor == 1`
    /// (`upgrade.ts:149-162`).
    pub fn sum_cost(
        &self,
        upgrade: UpgradeId,
        num: Num,
        start: Option<Num>,
    ) -> Vec<UpgradeCostVal> {
        let totals = match start {
            Some(s) => self.total_cost_at(upgrade, s),
            None => self.total_cost(upgrade),
        };
        totals.iter().map(|&c| sum_cost_of(c, num)).collect()
    }

    /// How many levels `percent` of the resources buy (`upgrade.ts:167-207`):
    /// the geometric series solved for the level count, floored, then the
    /// #290 correction (one less if the sum cost of that many is more than
    /// what we have). A `factor == 1` cost ignores `percent`, like the TS.
    /// [`Num::MAX`] (TS `Infinity`) without costs or `maxlevel`.
    pub fn upgrade_max_cost_met(&self, upgrade: UpgradeId, percent: Num) -> Num {
        self.upgrade_max_cost_met_with(upgrade, &self.total_cost(upgrade), percent)
    }

    /// [`Engine::upgrade_max_cost_met`] given [`Engine::total_cost`].
    pub(crate) fn upgrade_max_cost_met_with(
        &self,
        upgrade: UpgradeId,
        totals: &[UpgradeCostVal],
        percent: Num,
    ) -> Num {
        let g = self.data.upgrade(upgrade);
        let mut max: Option<Num> = g.maxlevel.map(|m| m - self.upgrade_count(upgrade));
        for &cost in totals {
            let have = self.count(cost.unit);
            let m = if cost.factor == Num::ONE {
                have / cost.val
            } else {
                let x = Num::ONE - have * percent * (Num::ONE - cost.factor) / cost.val;
                // log of a non-positive number: NaN in the TS; zero here
                Num::from_f64(x.log10() / cost.factor.log10())
            };
            max = Some(max.map_or(m, |x| x.min(m)));
        }
        let Some(max) = max else {
            return Num::MAX;
        };
        let max = max.floor();
        if !max.is_negative() {
            for &cost in totals {
                let cost = sum_cost_of(cost, max);
                if self.count(cost.unit) < cost.val {
                    return max - Num::ONE;
                }
            }
        }
        max
    }

    /// At least one level is affordable.
    pub fn upgrade_is_cost_met(&self, upgrade: UpgradeId) -> bool {
        self.upgrade_max_cost_met(upgrade, Num::ONE).is_positive()
    }

    /// Every remaining level up to `maxlevel` is affordable.
    pub fn upgrade_is_max_affordable(&self, upgrade: UpgradeId) -> bool {
        match self.data.upgrade(upgrade).maxlevel {
            Some(m) => self.upgrade_max_cost_met(upgrade, Num::ONE) >= m,
            None => false,
        }
    }

    /// Progress towards the next unaffordable level, 0..=1
    /// (`upgrade.ts:213-225`). `None` is the TS NaN: a level's cost is
    /// lost to rounding next to what was already paid (`0 / 0`), as with
    /// huge resource counts.
    pub fn upgrade_cost_met_percent(&self, upgrade: UpgradeId) -> Option<Num> {
        let totals = self.total_cost(upgrade);
        let met = self.upgrade_max_cost_met_with(upgrade, &totals, Num::ONE);
        self.upgrade_cost_met_percent_with(upgrade, &totals, met)
    }

    /// [`Engine::upgrade_cost_met_percent`] given [`Engine::total_cost`] and
    /// the levels affordable with all the resources.
    pub(crate) fn upgrade_cost_met_percent_with(
        &self,
        upgrade: UpgradeId,
        totals: &[UpgradeCostVal],
        met: Num,
    ) -> Option<Num> {
        if self
            .data
            .upgrade(upgrade)
            .maxlevel
            .is_some_and(|m| met >= m)
        {
            return Some(Num::ONE);
        }
        let cost_of_met: Vec<UpgradeCostVal> =
            totals.iter().map(|&c| sum_cost_of(c, met)).collect();
        // decimal.js `Decimal.min`, NaN-propagating; starts at Infinity
        let mut max = JsRatio::PosInf;
        for &cost in totals {
            let cost = sum_cost_of(cost, met + Num::ONE);
            // TS `keyBy(unit name)`: the last entry for a unit wins
            let paid = cost_of_met
                .iter()
                .rev()
                .find(|c| c.unit == cost.unit)
                .map_or(Num::ZERO, |c| c.val);
            let count = self.count(cost.unit);
            let m = JsRatio::div(
                absorbed(count - paid, count.abs().max(paid.abs())),
                absorbed(cost.val - paid, cost.val.abs().max(paid.abs())),
            );
            max = max.min(m);
        }
        match max {
            JsRatio::NaN => None,
            JsRatio::PosInf => Some(Num::ONE),
            JsRatio::NegInf => Some(Num::ZERO),
            JsRatio::Finite(m) => Some(Num::ONE.min(Num::ZERO.max(m))),
        }
    }

    /// Visible and affordable.
    pub fn upgrade_is_buyable(&self, upgrade: UpgradeId) -> bool {
        self.upgrade_is_cost_met(upgrade) && self.upgrade_visible(upgrade)
    }

    /// An upgrade (not an ability) that is buyable with `cost_percent` of the
    /// resources (default all), divided by the watch level if
    /// `use_watched`. PARITY(cache): cached for up to 3 s of clock time per
    /// (upgrade, percent), so it can be stale (`upgrade.ts:283-291`); `None`
    /// is its own key, like the TS's `"undefined"`.
    pub fn upgrade_is_upgradable(
        &self,
        upgrade: UpgradeId,
        cost_percent: Option<Num>,
        use_watched: bool,
    ) -> bool {
        let pct = if use_watched {
            Some(cost_percent.unwrap_or(Num::ONE) / Num::from(self.watched_divisor(upgrade)))
        } else {
            cost_percent
        };
        let key = (upgrade, pct.unwrap_or(Num::MIN));
        if let Some(&v) = self.cache.borrow().upgradable.get(&key) {
            return v;
        }
        let v = self.data.upgrade(upgrade).class == UpgradeClass::Upgrade
            && self.upgrade_is_buyable(upgrade)
            && self
                .upgrade_max_cost_met(upgrade, pct.unwrap_or(Num::ONE))
                .is_positive();
        self.cache.borrow_mut().upgradable.insert(key, v);
        v
    }

    /// Watched, so buy-all buys it.
    pub fn upgrade_is_autobuyable(&self, upgrade: UpgradeId) -> bool {
        self.watched_at(upgrade) > 0
    }

    /// Watched and upgradable with `cost_percent` / watch level of the
    /// resources: the "new upgrade" arrow.
    pub fn upgrade_is_newly_upgradable(&self, upgrade: UpgradeId, cost_percent: f64) -> bool {
        let watched = self.watched_at(upgrade);
        if watched <= 0 {
            return false;
        }
        let pct = cost_percent / f64::from(watched);
        // json_num parses a decimal string; 1 is the common case
        let pct = if pct == 1.0 {
            Num::ONE
        } else {
            swarm_data::json_num(pct)
        };
        self.upgrade_is_upgradable(upgrade, Some(pct), false)
    }

    /// The default watch level: 1, but 0 for upgrades of mutagen-tab units.
    pub fn watched_default(&self, upgrade: UpgradeId) -> i32 {
        let unit = self.data.upgrade(upgrade).unit;
        i32::from(self.data.unit(unit).tab != Some(self.data.well_known().mutagen_tab))
    }

    /// The watch level: -1 hidden, 0 off, `n` notify at `1/n` of the cost.
    pub fn watched_at(&self, upgrade: UpgradeId) -> i32 {
        self.state
            .watched
            .get(&self.data.upgrade(upgrade).name)
            .copied()
            .unwrap_or_else(|| self.watched_default(upgrade))
    }

    /// `max(watched_at, 1)`.
    pub fn watched_divisor(&self, upgrade: UpgradeId) -> i32 {
        self.watched_at(upgrade).max(1)
    }

    /// Sets the watch level. The default level is stored as absent (the TS
    /// compares against the boolean default, so it stores a numeric `1`
    /// where this stores nothing; both read back as 1).
    pub fn watch(&mut self, upgrade: UpgradeId, level: i32) {
        let name = self.data.upgrade(upgrade).name.clone();
        let default = self.watched_default(upgrade);
        self.with_unreified_save(|e| {
            if level != default {
                e.state.watched.insert(name, level);
            } else {
                e.state.watched.remove(&name);
            }
        });
    }

    /// Visible upgrades upgradable with `cost_percent` over their watch
    /// level (TS `availableUpgrades`).
    pub fn available_upgrades(&self, cost_percent: Option<Num>) -> Vec<UpgradeId> {
        self.data
            .upgrades()
            .iter()
            .map(|g| g.id)
            .filter(|&g| {
                self.upgrade_visible(g) && self.upgrade_is_upgradable(g, cost_percent, true)
            })
            .collect()
    }

    /// What "buy all upgrades" buys: available and watched (TS
    /// `availableAutobuyUpgrades`). Can be up to 3 s stale (PARITY(cache)).
    pub fn available_autobuy_upgrades(&self, cost_percent: Option<Num>) -> Vec<UpgradeId> {
        self.available_upgrades(cost_percent)
            .into_iter()
            .filter(|&g| self.upgrade_is_autobuyable(g))
            .collect()
    }

    /// Buys up to `num` levels (clamped to what is affordable), running every
    /// effect once per level with that level (`upgrade.ts:305-330`).
    pub fn buy_upgrade(&mut self, upgrade: UpgradeId, num: Num) -> Result<Num, CommandError> {
        if !self.upgrade_is_cost_met(upgrade) {
            return Err(CommandError::InsufficientResources);
        }
        if !self.upgrade_is_buyable(upgrade) {
            return Err(CommandError::CannotBuyUpgrade);
        }
        let num = num.min(self.upgrade_max_cost_met(upgrade, Num::ONE));
        let levels = num.to_f64();
        if levels > MAX_LEVELS_PER_BUY {
            return Err(CommandError::TooManyLevels);
        }
        let data = self.data;
        let name = &data.upgrade(upgrade).name;
        self.with_save(|e| {
            for cost in e.sum_cost(upgrade, num, None) {
                if e.count(cost.unit) < cost.val {
                    return Err(CommandError::Assertion(format!(
                        "tried to buy more than we can afford. upgrade.maxCostMet is broken!,{name},,[object Object]"
                    )));
                }
                if !cost.val.is_positive() {
                    return Err(CommandError::Assertion(format!(
                        "zero cost from sumCost, yet cost was met?,{name},,[object Object]"
                    )));
                }
                e.subtract_unit_count(cost.unit, cost.val);
            }
            let count = e.upgrade_count(upgrade);
            e.add_upgrade_count(upgrade, num);
            // CoffeeScript `[0...n]`
            let mut i = 0.0;
            while i < levels {
                for &effect in &e.data.upgrade(upgrade).effects {
                    e.on_buy(effect, count + Num::from_f64(i + 1.0));
                }
                i += 1.0;
            }
            Ok(num)
        })
    }

    /// Buys as many levels as `percent` of the resources allow.
    pub fn buy_max_upgrade(
        &mut self,
        upgrade: UpgradeId,
        percent: Num,
    ) -> Result<Num, CommandError> {
        let n = self.upgrade_max_cost_met(upgrade, percent);
        self.buy_upgrade(upgrade, n)
    }

    /// This upgrade's purchase statistics.
    pub fn upgrade_statistics(&self, upgrade: UpgradeId) -> Option<&UpgradeStatistics> {
        self.state
            .statistics
            .by_upgrade
            .get(&self.data.upgrade(upgrade).name)
    }

    /// Seconds until the next level is affordable (`upgrade.ts:231-277`).
    /// PARITY(cache): computed once per state change, then aged by the time
    /// passed since; once it would be due, recomputed once.
    pub fn estimate_secs_until_buyable(&self, upgrade: UpgradeId) -> UpgradeEstimate {
        self.estimate_upgrade(upgrade, false)
    }

    fn estimate_upgrade(&self, upgrade: UpgradeId, no_recurse: bool) -> UpgradeEstimate {
        if self.upgrade_is_max_affordable(upgrade) {
            return UpgradeEstimate::MaxAffordable;
        }
        let cached = self.cache.borrow().upgrade_estimate.get(&upgrade).copied();
        let cached = match cached {
            Some(c) => c,
            None => {
                let c = self.compute_upgrade_estimate(upgrade);
                self.cache.borrow_mut().upgrade_estimate.insert(upgrade, c);
                c
            }
        };
        let UpgradeEstimateCached::Wait { raw, unit, at_ms } = cached else {
            return UpgradeEstimate::Unavailable;
        };
        let secs = match raw {
            None => Estimate::Never,
            Some(raw) => {
                let aged = match at_ms {
                    Some(at) => (at - self.rt.now_ms) as f64 / 1000.0,
                    None => f64::NAN,
                };
                let v = (raw + Num::from_f64(aged)).to_f64();
                let v = if aged.is_nan() { f64::NAN } else { v };
                if v <= 0.0 && !no_recurse {
                    self.cache.borrow_mut().upgrade_estimate.remove(&upgrade);
                    return self.estimate_upgrade(upgrade, true);
                }
                Estimate::Secs(v)
            }
        };
        UpgradeEstimate::Wait {
            secs,
            unit,
            cache_safe: true,
        }
    }

    fn compute_upgrade_estimate(&self, upgrade: UpgradeId) -> UpgradeEstimateCached {
        let met = self.upgrade_max_cost_met(upgrade, Num::ONE);
        if let Some(m) = self.data.upgrade(upgrade).maxlevel {
            if met + Num::ONE > m {
                return UpgradeEstimateCached::Unavailable;
            }
        }
        // `None` is infinity
        let mut raw: Option<Num> = Some(Num::ZERO);
        let mut unit = None;
        let mut at_ms = None;
        for cost in self.sum_cost(upgrade, met + Num::ONE, None) {
            let secs = match self.estimate_secs_until_earned(cost.unit, cost.val) {
                Estimate::Reached => Some(Num::ZERO),
                Estimate::Secs(s) => Some(Num::from_f64(s)),
                Estimate::Never => None,
            };
            let less = match (raw, secs) {
                (Some(r), Some(s)) => r < s,
                (Some(_), None) => true,
                (None, _) => false,
            };
            if less {
                raw = secs;
                unit = Some(cost.unit);
                at_ms = Some(self.rt.now_ms);
            }
        }
        UpgradeEstimateCached::Wait { raw, unit, at_ms }
    }
}
