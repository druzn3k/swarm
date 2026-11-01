//! Load-time fixes for old saves (`engine/src/backfill.ts`). Runs after
//! every load and import, outside `with_save` like the TS.

use swarm_num::Num;

use crate::engine::Engine;

impl Engine {
    /// Runs the three backfills:
    ///
    /// 1. a save with hatcheries or expansions at their spawn minimum but no
    ///    premutagen and no ascension predates mutagen: replay every level's
    ///    effects (O(levels));
    /// 2. a save without a `freeRespec` count gets its `init`;
    /// 3. a lost ascension count is restored from statistics
    ///    (erosson/swarm#431).
    pub fn run_backfill(&mut self) {
        let data = self.data;
        let wk = data.well_known();
        let ih = wk.invisible_hatchery;
        let min_hatch = self.stat_opt(ih, data.upgrade(wk.hatchery).random_minlevel_stat);
        let min_expo = self.stat_opt(ih, data.upgrade(wk.expansion).random_minlevel_stat);
        let reached =
            |e: &Engine, up, min: Option<Num>| min.is_some_and(|m| e.upgrade_count(up) >= m);
        if self.count(wk.premutagen).is_zero()
            && self.count(wk.ascension).is_zero()
            && (reached(self, wk.hatchery, min_hatch) || reached(self, wk.expansion, min_expo))
        {
            for up in [wk.hatchery, wk.expansion] {
                let n = self.upgrade_count(up).to_f64();
                let mut i = 0.0;
                while i < n {
                    for &e in &data.upgrade(up).effects {
                        self.on_buy(e, Num::from_f64(i + 1.0));
                    }
                    i += 1.0;
                }
            }
        }

        if !self.is_count_initialized(wk.free_respec) {
            self.set_unit_count(wk.free_respec, data.unit(wk.free_respec).init);
        }

        let num = self
            .unit_statistics(wk.ascension)
            .map_or(Num::ZERO, |s| s.num);
        let count = self.count(wk.ascension);
        if num > count && count.is_zero() {
            self.set_unit_count(wk.ascension, num);
        }
    }
}
