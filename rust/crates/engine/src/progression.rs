//! Ascension and respec (`game.ts:424-564`).

use swarm_data::json_num;
use swarm_num::Num;

use crate::command::CommandError;
use crate::engine::Engine;
use crate::estimate::Estimate;

/// The share of the ascension cost a respec costs (`game.ts:159`).
pub const RESPEC_COST_RATE: f64 = 0.3;

impl Engine {
    /// Energy spent on what is owned now (TS `ascendEnergySpent`).
    pub fn ascend_energy_spent(&self) -> Num {
        self.spent(self.data.well_known().energy, &[])
    }

    /// `ceil(1.12^ascensions · 5e6 / 2^(spent / (50000 · ascendCost)))`:
    /// 5 million, halved for every 50k energy spent, 12% more per past
    /// ascension (`game.ts:428-441`). `spent` defaults to
    /// [`Engine::ascend_energy_spent`].
    pub fn ascend_cost(&self, spent: Option<Num>) -> Num {
        let wk = self.data.well_known();
        let spent = spent.unwrap_or_else(|| self.ascend_energy_spent());
        let ascends = self.count(wk.ascension);
        let penalty = json_num(1.12).pow_num(&ascends);
        let velocity =
            Num::from(50000) * self.stat(wk.mutagen, self.data.stats().ascend_cost, Num::ONE);
        (penalty * Num::from(5e6_f64) / Num::TWO.pow_num(&(spent / velocity))).ceil()
    }

    /// Cost minus the energy cap (TS `ascendCostCapDiff`).
    pub fn ascend_cost_cap_diff(&self, cost: Num) -> Num {
        let energy = self.data.well_known().energy;
        cost - self.cap(energy).unwrap_or(crate::production::UNIT_LIMIT)
    }

    /// `min(1, energy / cost)`.
    pub fn ascend_cost_percent(&self, cost: Num) -> Num {
        Num::ONE.min(self.count(self.data.well_known().energy) / cost)
    }

    /// Seconds until energy reaches `cost`, if `cost` is below the energy cap
    /// (`game.ts:454-464`). [`Estimate::Reached`] is where the TS throws
    /// [`crate::estimate::ASCEND_ESTIMATE_TYPE_ERROR`].
    pub fn ascend_cost_duration(&self, cost: Num) -> Option<Estimate> {
        let energy = self.data.well_known().energy;
        let cap = self.cap(energy)?;
        (cost < cap).then(|| self.estimate_secs_until_earned(energy, cost))
    }

    /// Ascends (`game.ts:465-500`): premutagen becomes mutagen, the ascension
    /// count goes up (a free respec every 3rd), `restarted` moves to now,
    /// the runtime is rebuilt, units not `ascendPreserve` go back to `init`
    /// and upgrades outside the mutagen tab to 0. Unless `free`, the energy
    /// must cover [`Engine::ascend_cost`].
    pub fn ascend(&mut self, free: bool) -> Result<(), CommandError> {
        if !free && self.ascend_cost_percent(self.ascend_cost(None)) < Num::ONE {
            return Err(CommandError::AscendCost);
        }
        self.with_save(|e| {
            let wk = e.data.well_known();
            let pre = e.count(wk.premutagen);
            e.add_unit_count(wk.mutagen, pre);
            e.set_unit_count(wk.premutagen, Num::ZERO);
            e.add_unit_count(wk.ascension, Num::ONE);
            e.state.dates.restarted = Some(e.rt.now_ms);
            if (e.count(wk.ascension) % Num::from(3)).is_zero() {
                e.add_unit_count(wk.free_respec, Num::ONE);
            }
            e.reinit()?;
            if e.count(wk.ascension) == Num::ONE {
                // tutorial message for the first ascension
                e.rt.first_spawn.insert(wk.ascension, e.rt.now_ms);
            }
            let data = e.data;
            for u in data.units() {
                if !u.ascend_preserve {
                    e.set_unit_count(u.id, u.init);
                }
            }
            for g in data.upgrades() {
                if data.unit(g.unit).tab != Some(wk.mutagen_tab) {
                    e.set_upgrade_count(g.id, Num::ZERO);
                }
            }
            Ok(())
        })
    }

    /// `ceil(ascend cost · 0.3)`.
    pub fn respec_cost(&self) -> Num {
        (self.ascend_cost(None) * json_num(RESPEC_COST_RATE)).ceil()
    }

    /// Energy covers the respec cost.
    pub fn is_respec_cost_met(&self) -> bool {
        self.count(self.data.well_known().energy) >= self.respec_cost()
    }

    /// Mutagen a respec refunds: spent on units, plus the hidden mutation
    /// cost tracker, minus its free units (`game.ts:520-530`).
    pub fn respec_spent(&self) -> Num {
        let wk = self.data.well_known();
        let ignores = &self.data.unit(wk.mutagen).upgrades;
        self.spent(wk.mutagen, ignores) - self.upgrade_count(wk.mutatehidden)
    }

    /// Respec for energy (`game.ts:531-543`). Spent energy is wiped, except
    /// the respec's own cost.
    pub fn respec(&mut self) -> Result<(), CommandError> {
        self.with_save(|e| {
            if !e.is_respec_cost_met() {
                return Err(CommandError::InsufficientResources);
            }
            let wk = e.data.well_known();
            let cost = e.respec_cost();
            e.subtract_unit_count(wk.energy, cost);
            let spent = e.ascend_energy_spent() - cost;
            e.add_unit_count(wk.respec_energy, spent);
            e.respec_inner()
        })
    }

    /// Respec using a free respec (`game.ts:545-553`).
    pub fn respec_free(&mut self) -> Result<(), CommandError> {
        self.with_save(|e| {
            let wk = e.data.well_known();
            if !e.count(wk.free_respec).is_positive() {
                return Err(CommandError::InsufficientResources);
            }
            e.subtract_unit_count(wk.free_respec, Num::ONE);
            e.respec_inner()
        })
    }

    fn respec_inner(&mut self) -> Result<(), CommandError> {
        let mutagen = self.data.well_known().mutagen;
        let spent = self.respec_spent();
        for r in self.spent_resources(mutagen) {
            match r {
                swarm_data::Resource::Unit(u) => self.set_unit_count(u, Num::ZERO),
                swarm_data::Resource::Upgrade(g) => self.set_upgrade_count(g, Num::ZERO),
            }
        }
        self.add_unit_count(mutagen, (spent * Num::ONE).floor());
        self.cache.get_mut().on_respec();
        if !self.spent(mutagen, &[]).is_zero() {
            return Err(CommandError::Assertion(
                "respec didn't refund all mutagen!".to_owned(),
            ));
        }
        Ok(())
    }
}
