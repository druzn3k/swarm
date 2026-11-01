//! Effects of units and upgrades (`effect.ts`, `effecttypes.ts`): the
//! handler registry is a `match` on [`EffectKind`].
//!
//! Effect parameters are [`Num`]s read from the JSON's shortest decimal
//! form, like decimal.js reads JS numbers. Where the TS does arithmetic on
//! the raw JS number first (`effect.val - 1`, `effect.val2 * 1000`), the raw
//! `f64` is used the same way. A missing parameter where the TS would throw
//! reads as zero; the data has none (the load-time checks rule them out).

use swarm_data::{json_num, EffectId, EffectKind, EffectParent, StatId, UnitId};
use swarm_num::Num;

use crate::cache::Stats;
use crate::engine::Engine;
use crate::seedrand::{mkseed, utc_date_string, SeedRandom};

/// What an effect's `output()` gives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EffectOutput {
    /// The kind has no output (stat kinds, `addUnitTimed`).
    None,
    /// An amount: units or levels added, or seconds skipped.
    Num(Num),
    /// `addUnitRand`: whether a spawn happens at this level and how many.
    Rand(RandOutput),
}

impl EffectOutput {
    /// The amount, for [`EffectOutput::Num`].
    pub fn num(&self) -> Option<Num> {
        match self {
            EffectOutput::Num(n) => Some(*n),
            _ => None,
        }
    }
}

/// `addUnitRand`'s output (`effecttypes.ts:163-208`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RandOutput {
    /// A spawn happens.
    pub spawned: bool,
    /// The quantity before the random factor.
    pub baseqty: Num,
    /// The quantity spawned, if any.
    pub qty: Num,
}

/// Roman numerals, from the blog post the TS copies (`effecttypes.ts:51-65`):
/// "" for 0.
pub fn romanize(num: u64) -> String {
    if num == 0 {
        return String::new();
    }
    const KEY: [&str; 30] = [
        "", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM", "", "X", "XX", "XXX", "XL",
        "L", "LX", "LXX", "LXXX", "XC", "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
    ];
    let mut digits: Vec<usize> = num
        .to_string()
        .bytes()
        .map(|b| (b - b'0') as usize)
        .collect();
    let mut roman = String::new();
    for i in (0..3).rev() {
        let d = digits.pop().unwrap_or(0);
        roman = format!("{}{}", KEY[d + i * 10], roman);
    }
    let thousands: usize = if digits.is_empty() {
        0
    } else {
        digits.iter().fold(0, |acc, &d| acc * 10 + d)
    };
    "M".repeat(thousands) + &roman
}

/// The suffix for an empower level: none at 0, roman `level + 1` below
/// 3999, else decimal `level + 1` (`effecttypes.ts:337-354`).
pub fn suffix_for_level(level: Num) -> String {
    if level.is_zero() {
        String::new()
    } else if level < Num::from(3999) {
        romanize((level + Num::ONE).to_f64() as u64)
    } else {
        (level + Num::ONE).to_string()
    }
}

fn get(stats: &Stats, id: StatId) -> Option<Num> {
    stats.iter().find(|(s, _)| *s == id).map(|&(_, v)| v)
}

fn set(stats: &mut Stats, id: StatId, v: Num) {
    match stats.iter_mut().find(|(s, _)| *s == id) {
        Some(e) => e.1 = v,
        None => stats.push((id, v)),
    }
}

impl Engine {
    /// The unit an effect's stats come from: the unit itself, or an
    /// upgrade's unit (TS `parentUnit`).
    pub fn effect_parent_unit(&self, effect: EffectId) -> UnitId {
        match self.data.effect(effect).parent {
            EffectParent::Unit(u) => u,
            EffectParent::Upgrade(g) => self.data.upgrade(g).unit,
        }
    }

    /// The parent's level: a unit's count or an upgrade's level.
    pub fn effect_parent_count(&self, effect: EffectId) -> Num {
        match self.data.effect(effect).parent {
            EffectParent::Unit(u) => self.count(u),
            EffectParent::Upgrade(g) => self.upgrade_count(g),
        }
    }

    fn parent_stat(&self, effect: EffectId, stat: StatId, default: Num) -> Num {
        self.stat(self.effect_parent_unit(effect), stat, default)
    }

    fn parent_stat_opt(&self, effect: EffectId, stat: StatId) -> Option<Num> {
        self.stat_opt(self.effect_parent_unit(effect), stat)
    }

    /// The raw JSON `val` and `val2` (JS numbers).
    fn raw_vals(&self, effect: EffectId) -> (Option<f64>, Option<f64>) {
        let e = self.data.effect(effect);
        let raw = self.data.raw();
        match e.parent {
            EffectParent::Unit(u) => {
                let r = &raw.unittypes[u.index()].effect[e.index];
                (Some(r.val), r.val2)
            }
            EffectParent::Upgrade(g) => {
                let r = &raw.upgrades[g.index()].effect[e.index];
                (r.val, r.val2)
            }
        }
    }

    /// `power · power.<upgrade>` of the parent unit (`effect.ts:82-90`).
    pub fn effect_power(&self, effect: EffectId) -> Num {
        let s = self.data.stats();
        let mut ret = self.parent_stat(effect, s.power, Num::ONE);
        if let EffectParent::Upgrade(g) = self.data.effect(effect).parent {
            ret *= self.parent_stat(effect, self.data.upgrade(g).power_stat, Num::ONE);
        }
        ret
    }

    /// Folds one effect into a unit's stats at `level`
    /// (`effecttypes.ts:259-354`), in the TS's exact operation order. The
    /// mult/add conflict check is done when the data loads.
    pub(crate) fn calc_stats(&self, effect: EffectId, stats: &mut Stats, level: Num) {
        let e = self.data.effect(effect);
        let val = e.val.unwrap_or(Num::ZERO);
        let one = Num::ONE;
        let Some(stat) = e.stat else {
            if e.kind == EffectKind::Suffix {
                // the suffix itself is computed by `Engine::suffix`
                let empower = self.data.stats().empower;
                let v = get(stats, empower).unwrap_or(Num::ZERO) + level;
                set(stats, empower, v);
            }
            return;
        };
        let cur_mult = || get(stats, stat).unwrap_or(one);
        let v = match e.kind {
            EffectKind::MultStat => cur_mult() * val.pow_num(&level),
            EffectKind::ExpStat => {
                let val2 = e.val2.unwrap_or(Num::ZERO);
                cur_mult() * (level.pow_num(&val) * val2 + one)
            }
            EffectKind::AsympStat => {
                // val: asymptote max; val2: 1/x weight
                let weight = level * e.val2.unwrap_or(Num::ZERO);
                debug_assert!(!weight.is_negative(), "negative asympStat weight");
                cur_mult() * (one + (val - one) * (one - one / (weight + one)))
            }
            EffectKind::LogStat => {
                // val: log multiplier; val2: log base; val3 (default 1): weight
                let val2 = e.val2.unwrap_or(Num::ZERO);
                let val3 = e.val3.unwrap_or(one);
                let ratio = Num::from_f64((level * val + val2).log10() / val2.log10());
                cur_mult() * (val3 * (ratio - one) + one)
            }
            EffectKind::AddStat => get(stats, stat).unwrap_or(Num::ZERO) + val * level,
            EffectKind::InitStat => cur_mult() * val,
            EffectKind::MultStatPerAchievementPoint => {
                let points = Num::from(self.achievement_points());
                cur_mult() * (one + val * points).pow_num(&level)
            }
            _ => return,
        };
        set(stats, stat, v);
    }

    /// The effect's output at the parent's current level, or at `level` for
    /// `addUnitRand` (TS `effect.output(level)`).
    pub fn effect_output(&self, effect: EffectId, level: Option<Num>) -> EffectOutput {
        let e = self.data.effect(effect);
        let val = e.val.unwrap_or(Num::ZERO);
        match e.kind {
            EffectKind::AddUnit => EffectOutput::Num(self.effect_power(effect) * val * Num::ONE),
            EffectKind::AddUnitByVelocity => {
                let unit = e.unit.expect("addUnitByVelocity has a unit");
                EffectOutput::Num(self.velocity(unit) * val * self.effect_power(effect))
            }
            EffectKind::AddUnitRand => {
                let level = level.unwrap_or_else(|| self.effect_parent_count(effect));
                EffectOutput::Rand(self.rand_output(effect, level))
            }
            EffectKind::CompoundUnit => EffectOutput::Num(self.compound_output(effect)),
            EffectKind::AddUpgrade | EffectKind::SkipTime => {
                EffectOutput::Num(self.effect_power(effect) * val)
            }
            _ => EffectOutput::None,
        }
    }

    /// The output one level up (TS `outputNext`).
    pub fn effect_output_next(&self, effect: EffectId) -> EffectOutput {
        self.effect_output(effect, Some(self.effect_parent_count(effect) + Num::ONE))
    }

    /// `compoundUnit`'s bank: the unit's count plus `unit2`'s.
    pub fn effect_bank(&self, effect: EffectId) -> Option<Num> {
        let e = self.data.effect(effect);
        if e.kind != EffectKind::CompoundUnit {
            return None;
        }
        let mut base = self.count(e.unit?);
        if let Some(u2) = e.unit2 {
            base += self.count(u2);
        }
        Some(base)
    }

    /// `compoundUnit`'s cap: `velocity · val2 · power`; `None` when `val2`
    /// is empty, which means uncapped (not 0, `effecttypes.ts:218-221`).
    pub fn effect_cap(&self, effect: EffectId) -> Option<Num> {
        let e = self.data.effect(effect);
        if e.kind != EffectKind::CompoundUnit {
            return None;
        }
        let val2 = e.val2?;
        let mut velocity = self.velocity(e.unit?);
        if let Some(u2) = e.unit2 {
            velocity += self.velocity(u2);
        }
        Some(velocity * val2 * self.effect_power(effect))
    }

    fn compound_output(&self, effect: EffectId) -> Num {
        let base = self.effect_bank(effect).unwrap_or(Num::ZERO);
        // `effect.val - 1` is JS number arithmetic
        let val = self.raw_vals(effect).0.unwrap_or(0.0);
        let mut ret = base * json_num(val - 1.0);
        if let Some(cap) = self.effect_cap(effect) {
            ret = ret.min(cap);
        }
        ret
    }

    /// The seed string of a spawn roll: `[restarted, parent, level]`
    /// (`effecttypes.ts:187-188`), with `restarted` defaulting to `started`.
    pub fn rand_seed_string(&self, effect: EffectId, level: Num) -> String {
        let d = &self.state.dates;
        let restarted = d.restarted.unwrap_or(d.started);
        let parent = match self.data.effect(effect).parent {
            EffectParent::Unit(u) => &self.data.unit(u).name,
            EffectParent::Upgrade(g) => &self.data.upgrade(g).name,
        };
        format!("[{restarted}, {parent}, {level}]")
    }

    fn rand_output(&self, effect: EffectId, level: Num) -> RandOutput {
        let none = RandOutput {
            spawned: false,
            baseqty: Num::ZERO,
            qty: Num::ZERO,
        };
        let e = self.data.effect(effect);
        let EffectParent::Upgrade(g) = e.parent else {
            return none;
        };
        let s = self.data.stats();
        // the minimum level to spawn, which also guarantees a spawn. The TS
        // throws "no such stat" if unset; here nothing spawns.
        let Some(minlevel) =
            self.parent_stat_opt(effect, self.data.upgrade(g).random_minlevel_stat)
        else {
            return none;
        };
        if level < minlevel {
            return none;
        }
        let stat_each = self.parent_stat(effect, s.random_each, Num::ONE);
        let prob = self
            .parent_stat_opt(effect, s.random_freq)
            .unwrap_or(Num::ZERO);
        let (minqty, maxqty) = (0.9_f64, 1.1_f64);
        let qtyfactor = e.val.unwrap_or(Num::ZERO);
        let baseqty = stat_each * qtyfactor.pow_num(&level);
        let base = utc_date_string(self.state.dates.started);
        let mut rng = SeedRandom::new(&mkseed(&base, &self.rand_seed_string(effect, level)));
        let roll = rng.next_f64();
        // guaranteed at minlevel and every 8 levels
        let spawned =
            level == minlevel || (level % Num::from(8)).is_zero() || json_num(roll) < prob;
        let roll2 = rng.next_f64();
        let modqty = minqty + roll2 * (maxqty - minqty);
        let qty = (baseqty * json_num(modqty)).ceil();
        RandOutput {
            spawned,
            baseqty,
            qty,
        }
    }

    /// Runs an effect for buying its upgrade's `level`th level (TS
    /// `onBuy`).
    pub(crate) fn on_buy(&mut self, effect: EffectId, level: Num) {
        let e = self.data.effect(effect);
        match e.kind {
            EffectKind::AddUnit | EffectKind::AddUnitByVelocity | EffectKind::CompoundUnit => {
                if let (Some(unit), Some(out)) = (e.unit, self.effect_output(effect, None).num()) {
                    self.add_unit_count(unit, out);
                }
            }
            EffectKind::AddUnitTimed => {
                let (Some(unit), Some(val)) = (e.unit, e.val) else {
                    return;
                };
                let threshold = self.raw_vals(effect).1.unwrap_or(0.0) * 1000.0;
                if e.unit2.is_none_or(|u2| self.unit_visible(u2))
                    && self.add_unit_timer_remaining_ms(unit, threshold) == 0.0
                {
                    self.add_unit_count(unit, val);
                    self.set_add_unit_timer(unit);
                }
            }
            EffectKind::AddUnitRand => {
                let Some(unit) = e.unit else { return };
                // the TS fills in a missing `restarted` while rolling
                if self.state.dates.restarted.is_none() {
                    self.state.dates.restarted = Some(self.state.dates.started);
                }
                let out = self.rand_output(effect, level);
                if out.spawned {
                    if self.count(unit).is_zero() {
                        // first spawn: tutorial text, this session only
                        self.rt.first_spawn.insert(unit, self.rt.now_ms);
                    }
                    self.add_unit_count(unit, out.qty);
                }
            }
            EffectKind::AddUpgrade => {
                if let (Some(g), Some(out)) = (e.upgrade, self.effect_output(effect, None).num()) {
                    self.add_upgrade_count(g, out);
                }
            }
            EffectKind::SkipTime => {
                if let Some(out) = self.effect_output(effect, None).num() {
                    self.skip_ms(out.to_f64() * 1000.0);
                }
            }
            _ => {}
        }
    }

    /// Runs an effect for buying `num` of its unit (TS `onBuyUnit`; only
    /// `addUnit` has one).
    pub(crate) fn on_buy_unit(&mut self, effect: EffectId, num: Num) {
        let e = self.data.effect(effect);
        if e.kind == EffectKind::AddUnit {
            if let (Some(unit), Some(val)) = (e.unit, e.val) {
                let out = self.effect_power(effect) * val * num;
                self.add_unit_count(unit, out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn romanizes() {
        assert_eq!(romanize(2), "II");
        assert_eq!(romanize(6), "VI");
        assert_eq!(romanize(21), "XXI");
        assert_eq!(romanize(51), "LI");
        assert_eq!(romanize(100), "C");
        assert_eq!(romanize(1000), "M");
        assert_eq!(romanize(3999), "MMMCMXCIX");
        assert_eq!(romanize(0), "");
    }

    #[test]
    fn suffixes() {
        assert_eq!(suffix_for_level(Num::ZERO), "");
        assert_eq!(suffix_for_level(Num::ONE), "II");
        assert_eq!(suffix_for_level(Num::from(3999)), "4000");
    }
}
