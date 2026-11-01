//! Units (`engine/src/unit.ts` `Unit`): counts, caps, stats, costs,
//! visibility and buying.

use swarm_data::{
    json_num, EffectParent, RequireOp, Resource, StatId, UnitAmount, UnitId, UpgradeId,
};
use swarm_num::Num;

use crate::cache::Stats;
use crate::command::CommandError;
use crate::engine::Engine;
use crate::parse_number::ParseNumberUnit;
use crate::production::UNIT_LIMIT;
use crate::state::UnitStatistics;

/// What a unit purchase bought.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bought {
    /// Purchases made (after clamping to what was affordable).
    pub num: Num,
    /// Units received: `num` times the twin multiplier.
    pub twinnum: Num,
}

impl Engine {
    /// The count as of the last reify (TS `rawCount`); zero if unset. The
    /// legacy `toPrecision(15)` rule for numeric values is applied when a
    /// save is read ([`crate::state::legacy_count`]), since a [`Num`] is
    /// never a JS number. Cached in the update generation.
    pub fn raw_count(&self, unit: UnitId) -> Num {
        if let Some(v) = self.cache.borrow().raw_count[unit.index()] {
            return v;
        }
        let v = self
            .state
            .units
            .get(&self.data.unit(unit).name)
            .copied()
            .unwrap_or(Num::ZERO);
        self.cache.borrow_mut().raw_count[unit.index()] = Some(v);
        v
    }

    /// Whether the state has a count for this unit (TS `isCountInitialized`).
    pub fn is_count_initialized(&self, unit: UnitId) -> bool {
        self.state.units.contains_key(&self.data.unit(unit).name)
    }

    /// Sets a unit's raw count and clears the update caches (TS
    /// `_setCount`). Low level: no reify and no save; commands wrap changes
    /// in [`Engine::with_save`].
    pub fn set_unit_count(&mut self, unit: UnitId, val: Num) {
        let name = self.data.unit(unit).name.clone();
        self.state.units.insert(name, val);
        self.on_update();
    }

    /// Adds to a unit's raw count (TS `_addCount`).
    pub fn add_unit_count(&mut self, unit: UnitId, val: Num) {
        let v = self.raw_count(unit) + val;
        self.set_unit_count(unit, v);
    }

    /// Subtracts from a unit's raw count (TS `_subtractCount`).
    pub fn subtract_unit_count(&mut self, unit: UnitId, val: Num) {
        self.add_unit_count(unit, val * Num::from(-1));
    }

    /// The current count: the polynomial at the game clock, capped (TS
    /// `count()`, `unit.ts:495-504`). Cached per tick.
    pub fn count(&self, unit: UnitId) -> Num {
        if let Some(v) = self.cache.borrow().count[unit.index()] {
            return v;
        }
        let v = self.count_in_secs_from_now(unit, Num::ZERO);
        self.cache.borrow_mut().count[unit.index()] = Some(v);
        v
    }

    /// The count `secs` seconds after now, assuming nothing is bought.
    pub fn count_in_secs_from_now(&self, unit: UnitId, secs: Num) -> Num {
        self.count_in_secs_from_reified(unit, secs + self.diff_seconds_num())
    }

    /// `json_num(diff_seconds)`, memoised on the `f64` (the decimal parse
    /// is most of a cached count's cost).
    fn diff_seconds_num(&self) -> Num {
        let diff = self.diff_seconds();
        if let Some((d, n)) = self.cache.borrow().diff_seconds {
            if d.to_bits() == diff.to_bits() {
                return n;
            }
        }
        let n = json_num(diff);
        self.cache.borrow_mut().diff_seconds = Some((diff, n));
        n
    }

    /// The count `secs` seconds after the last reify (used by the app's
    /// welcome-back screen).
    pub fn count_in_secs_from_reified(&self, unit: UnitId, secs: Num) -> Num {
        self.cap_value_of(unit, self.poly_count(unit, secs))
    }

    /// The cap: `capBase · capMult + capFlat` if the unit has a `capBase`
    /// stat (`unit.ts:333-343`). Cached in the update generation.
    pub fn cap(&self, unit: UnitId) -> Option<Num> {
        if let Some(v) = self.cache.borrow().cap[unit.index()] {
            return v;
        }
        let s = self.data.stats();
        let v = self.stat_opt(unit, s.cap_base).map(|base| {
            base * self.stat(unit, s.cap_mult, Num::ONE) + self.stat(unit, s.cap_flat, Num::ZERO)
        });
        self.cache.borrow_mut().cap[unit.index()] = Some(v);
        v
    }

    /// `min(val, cap)`, or `min(val, UNIT_LIMIT)` for uncapped units (TS
    /// `capValue(val)`).
    pub fn cap_value_of(&self, unit: UnitId, val: Num) -> Num {
        val.min(self.cap(unit).unwrap_or(UNIT_LIMIT))
    }

    /// Count over cap, if capped (TS `capPercent`).
    pub fn cap_percent(&self, unit: UnitId) -> Option<Num> {
        self.cap(unit).map(|c| self.count(unit) / c)
    }

    /// The unit's stats: its upgrades' effects in list order, then the unit
    /// effects that target it with their parent's count, **in that order**,
    /// which matters for rounding (`unit.ts:720-732`). Cached in the update
    /// generation (PARITY(cache): stale until the next state change).
    pub fn stats(&self, unit: UnitId) -> Stats {
        self.ensure_stats(unit);
        self.cache.borrow().stats[unit.index()]
            .clone()
            .unwrap_or_default()
    }

    fn ensure_stats(&self, unit: UnitId) {
        if self.cache.borrow().stats[unit.index()].is_some() {
            return;
        }
        let mut stats = Stats::new();
        for &e in &self.data.unit(unit).stat_effects {
            let level = match self.data.effect(e).parent {
                EffectParent::Upgrade(g) => self.upgrade_count(g),
                EffectParent::Unit(p) => self.count(p),
            };
            self.calc_stats(e, &mut stats, level);
        }
        self.cache.borrow_mut().stats[unit.index()] = Some(stats);
    }

    /// A stat, if any effect set it.
    pub fn stat_opt(&self, unit: UnitId, stat: StatId) -> Option<Num> {
        self.ensure_stats(unit);
        self.cache.borrow().stat(unit, stat)
    }

    /// A stat, or `default` if unset (TS `stat(key, default)`).
    pub fn stat(&self, unit: UnitId, stat: StatId, default: Num) -> Num {
        self.stat_opt(unit, stat).unwrap_or(default)
    }

    /// A stat by name; `None` if unset or unknown. (TS `stat(key)` without a
    /// default throws "no such stat" instead.)
    pub fn stat_by_name(&self, unit: UnitId, name: &str) -> Option<Num> {
        self.data.stat_id(name).and_then(|s| self.stat_opt(unit, s))
    }

    /// Cost of one, after the `cost` and `cost.<currency>` stats
    /// (`unit.ts:680-686`).
    /// Cached in the update generation.
    pub fn each_cost(&self, unit: UnitId) -> Vec<UnitAmount> {
        if let Some(v) = &self.cache.borrow().each_cost[unit.index()] {
            return v.clone();
        }
        let v = self.compute_each_cost(unit);
        self.cache.borrow_mut().each_cost[unit.index()] = Some(v.clone());
        v
    }

    fn compute_each_cost(&self, unit: UnitId) -> Vec<UnitAmount> {
        let costs = &self.data.unit(unit).cost;
        if costs.is_empty() {
            return Vec::new();
        }
        let c = self.stat(unit, self.data.stats().cost, Num::ONE);
        costs
            .iter()
            .map(|cost| UnitAmount {
                unit: cost.unit,
                val: cost.val * c * self.stat(unit, self.data.unit(cost.unit).cost_stat, Num::ONE),
            })
            .collect()
    }

    /// Production of one, per second, after the `base` and `prod` stats
    /// (`unit.ts:670-678`).
    pub fn each_production(&self, unit: UnitId) -> Vec<(UnitId, Num)> {
        let prods = &self.data.unit(unit).prod;
        if prods.is_empty() {
            return Vec::new();
        }
        let s = self.data.stats();
        let base = self.stat(unit, s.base, Num::ZERO);
        let prod = self.stat(unit, s.prod, Num::ONE);
        prods
            .iter()
            .map(|p| (p.unit, (p.val + base) * prod))
            .collect()
    }

    /// Production of all of this unit (whole units only), per second.
    pub fn total_production(&self, unit: UnitId) -> Vec<(UnitId, Num)> {
        let count = self.count(unit).floor();
        self.each_production(unit)
            .into_iter()
            .map(|(u, v)| (u, v * count))
            .collect()
    }

    /// The units and upgrades that cost this unit, units first (TS
    /// `spentResources`).
    pub fn spent_resources(&self, unit: UnitId) -> Vec<Resource> {
        let units = self
            .data
            .units()
            .iter()
            .filter(|u| u.cost.iter().any(|c| c.unit == unit))
            .map(|u| Resource::Unit(u.id));
        let upgrades = self
            .data
            .upgrades()
            .iter()
            .filter(|g| g.cost.iter().any(|c| c.unit == unit))
            .map(|g| Resource::Upgrade(g.id));
        units.chain(upgrades).collect()
    }

    /// How much of this unit was spent on what is currently owned: unit
    /// counts times their base cost, plus the sum cost of upgrade levels,
    /// except the `ignores` upgrades (`unit.ts:512-527`).
    pub fn spent(&self, unit: UnitId, ignores: &[UpgradeId]) -> Num {
        let mut ret = Num::ZERO;
        for u in self.data.units() {
            // TS `costByName`: the last entry for a unit wins
            if let Some(c) = u.cost.iter().rev().find(|c| c.unit == unit) {
                ret += self.count(u.id) * c.val;
            }
        }
        for g in self.data.upgrades() {
            if g.cost.iter().any(|c| c.unit == unit) && !ignores.contains(&g.id) {
                let costs = self.sum_cost(g.id, self.upgrade_count(g.id), Some(Num::ZERO));
                if let Some(c) = costs.iter().find(|c| c.unit == unit) {
                    ret += c.val;
                }
            }
        }
        ret
    }

    /// The fraction of one purchase the cheapest cost allows: `min(count /
    /// cost)` over costs above zero. `None` (TS `Infinity`) without costs.
    pub fn cost_met_percent(&self, unit: UnitId) -> Option<Num> {
        self.cost_met_percent_of(&self.each_cost(unit))
    }

    /// [`Engine::cost_met_percent`] given [`Engine::each_cost`].
    pub(crate) fn cost_met_percent_of(&self, costs: &[UnitAmount]) -> Option<Num> {
        let mut max: Option<Num> = None;
        for &cost in costs {
            if cost.val.is_positive() {
                let m = self.count(cost.unit) / cost.val;
                max = Some(max.map_or(m, |x| x.min(m)));
            }
        }
        max
    }

    /// Like [`Engine::cost_met_percent`], with velocities instead of counts.
    pub fn cost_met_percent_of_velocity(&self, unit: UnitId) -> Option<Num> {
        let mut max: Option<Num> = None;
        for cost in self.each_cost(unit) {
            if cost.val.is_positive() {
                let m = self.velocity(cost.unit) / cost.val;
                max = Some(max.map_or(m, |x| x.min(m)));
            }
        }
        max
    }

    /// How many can be bought with `percent` of the resources:
    /// `floor(cost_met_percent · percent)` (`unit.ts:596-600`). A unit without
    /// costs gives [`Num::MAX`] (TS `Infinity`); don't do arithmetic on it.
    pub fn unit_max_cost_met(&self, unit: UnitId, percent: Num) -> Num {
        match self.cost_met_percent(unit) {
            Some(m) => (m * percent).floor(),
            None => Num::MAX,
        }
    }

    /// Whether one can be afforded.
    pub fn unit_is_cost_met(&self, unit: UnitId) -> bool {
        self.unit_max_cost_met(unit, Num::ONE).is_positive()
    }

    /// Visible: not disabled, and either once seen since the last respec
    /// (PARITY(cache): sticky), owned, or its requirements are met. A
    /// failed requirement fails unless it is `OR`; a met `OR` requirement is
    /// enough (`unit.ts:553-581`).
    pub fn unit_visible(&self, unit: UnitId) -> bool {
        let ut = self.data.unit(unit);
        if ut.disabled {
            return false;
        }
        if self.cache.borrow().unit_visible[unit.index()] {
            return true;
        }
        let v = self.compute_unit_visible(unit);
        self.cache.borrow_mut().unit_visible[unit.index()] = v;
        v
    }

    /// [`Engine::unit_visible`] without recording it in the sticky cache.
    pub(crate) fn unit_visible_peek(&self, unit: UnitId) -> bool {
        !self.data.unit(unit).disabled
            && (self.cache.borrow().unit_visible[unit.index()] || self.compute_unit_visible(unit))
    }

    fn compute_unit_visible(&self, unit: UnitId) -> bool {
        if self.count(unit).is_positive() {
            return true;
        }
        // the TS asserts requires is non-empty; the loop would say true
        for req in &self.data.unit(unit).requires {
            let have = self.resource_count(req.resource);
            if req.val > have {
                if req.op != RequireOp::Or {
                    return false;
                }
            } else if req.op == RequireOp::Or {
                return true;
            }
        }
        true
    }

    /// The count of a unit or the level of an upgrade.
    pub fn resource_count(&self, r: Resource) -> Num {
        match r {
            Resource::Unit(u) => self.count(u),
            Resource::Upgrade(g) => self.upgrade_count(g),
        }
    }

    /// Buy buttons shown: buyable, has costs, and every cost is visible.
    pub fn is_buy_button_visible(&self, unit: UnitId) -> bool {
        self.is_buy_button_visible_of(unit, &self.each_cost(unit))
    }

    /// [`Engine::is_buy_button_visible`] given [`Engine::each_cost`].
    pub(crate) fn is_buy_button_visible_of(&self, unit: UnitId, costs: &[UnitAmount]) -> bool {
        if self.data.unit(unit).unbuyable || costs.is_empty() {
            return false;
        }
        costs.iter().all(|c| self.unit_visible(c.unit))
    }

    /// Can be bought now (or ignoring cost).
    pub fn unit_is_buyable(&self, unit: UnitId, ignore_cost: bool) -> bool {
        (self.unit_is_cost_met(unit) || ignore_cost)
            && self.is_buy_button_visible(unit)
            && !self.data.unit(unit).unbuyable
    }

    /// Units received per purchase: `(1 + twinbase) · twin`.
    pub fn twin_mult(&self, unit: UnitId) -> Num {
        let s = self.data.stats();
        (Num::ONE + self.stat(unit, s.twinbase, Num::ZERO)) * self.stat(unit, s.twin, Num::ONE)
    }

    /// Buys up to `num` (clamped to what is affordable) and runs the unit's
    /// `onBuyUnit` effects; buying energy also adds `mtxEnergy`
    /// (`unit.ts:628-651`, the hack at 645-648).
    pub fn buy_unit(&mut self, unit: UnitId, num: Num) -> Result<Bought, CommandError> {
        if !self.unit_is_cost_met(unit) {
            return Err(CommandError::InsufficientResources);
        }
        if !self.unit_is_buyable(unit, false) {
            return Err(CommandError::CannotBuyUnit);
        }
        let num = num.min(self.unit_max_cost_met(unit, Num::ONE));
        self.with_save(|e| {
            for cost in e.each_cost(unit) {
                e.subtract_unit_count(cost.unit, cost.val * num);
            }
            let twinnum = num * e.twin_mult(unit);
            e.add_unit_count(unit, twinnum);
            for &effect in &e.data.unit(unit).effects {
                e.on_buy_unit(effect, twinnum);
            }
            let wk = e.data.well_known();
            if unit == wk.energy {
                e.add_unit_count(wk.mtx_energy, twinnum);
            }
            Ok(Bought { num, twinnum })
        })
    }

    /// Buys as many as `percent` of the resources allow.
    pub fn buy_max_unit(&mut self, unit: UnitId, percent: Num) -> Result<Bought, CommandError> {
        let n = self.unit_max_cost_met(unit, percent);
        self.buy_unit(unit, n)
    }

    /// Whether any visible upgrade listed with this unit (or its
    /// `showparent`) is newly upgradable.
    pub fn unit_is_newly_upgradable(&self, unit: UnitId) -> bool {
        let ut = self.data.unit(unit);
        let list = match ut.showparent {
            Some(p) => &self.data.unit(p).upgrades,
            None => &ut.upgrades,
        };
        list.iter()
            .any(|&g| self.upgrade_visible(g) && self.upgrade_is_newly_upgradable(g, 1.0))
    }

    /// The roman-numeral suffix the `suffix` effect gives this unit ("" for
    /// none). The TS writes it as a side effect of computing stats, so it
    /// can lag until stats are next computed; here it is computed from the
    /// current level.
    pub fn suffix(&self, unit: UnitId) -> String {
        // the last suffix effect targeting the unit wins
        let Some(effect) = self.cache.borrow().suffix_effect[unit.index()] else {
            return String::new();
        };
        let level = match self.data.effect(effect).parent {
            EffectParent::Upgrade(g) => self.upgrade_count(g),
            EffectParent::Unit(p) => self.count(p),
        };
        crate::effects::suffix_for_level(level)
    }

    /// This unit's purchase statistics.
    pub fn unit_statistics(&self, unit: UnitId) -> Option<&UnitStatistics> {
        self.state
            .statistics
            .by_unit
            .get(&self.data.unit(unit).name)
    }

    /// When the `addUnitTimed` effect last granted this unit (epoch 0 if
    /// never).
    pub fn add_unit_timer(&self, unit: UnitId) -> i64 {
        self.state
            .timers
            .get(&self.data.unit(unit).name)
            .copied()
            .unwrap_or(0)
    }

    /// Milliseconds until the timer has run `duration_ms` (0 when ready).
    pub fn add_unit_timer_remaining_ms(&self, unit: UnitId, duration_ms: f64) -> f64 {
        let elapsed = (self.rt.now_ms - self.add_unit_timer(unit)) as f64;
        (duration_ms - elapsed).max(0.0)
    }

    /// Restarts the timer at now.
    pub(crate) fn set_add_unit_timer(&mut self, unit: UnitId) {
        let name = self.data.unit(unit).name.clone();
        self.state.timers.insert(name, self.rt.now_ms);
    }

    /// A [`ParseNumberUnit`] view of a unit, for [`crate::parse_number`].
    pub fn unit_handle(&self, unit: UnitId) -> UnitHandle<'_> {
        UnitHandle { engine: self, unit }
    }
}

/// A unit of an [`Engine`], for [`crate::parse_number::parse_number`].
#[derive(Clone, Copy, Debug)]
pub struct UnitHandle<'a> {
    engine: &'a Engine,
    unit: UnitId,
}

impl ParseNumberUnit for UnitHandle<'_> {
    fn max_cost_met(&self, percent: Num) -> Num {
        self.engine.unit_max_cost_met(self.unit, percent)
    }
    fn count(&self) -> Num {
        self.engine.count(self.unit)
    }
    fn twin_mult(&self) -> Num {
        self.engine.twin_mult(self.unit)
    }
}
