//! The tutorial hint to show: a port of the app's `app/src/game/tutorial.ts`
//! (the old `tutStep()` from `directives/tutorial.coffee`), moved into the
//! engine because it reads the runtime's first-spawn flags (TS
//! `cache.firstSpawn`), which are not saved.

use swarm_data::UnitId;
use swarm_num::Num;

use crate::engine::Engine;

/// No hint.
pub const TUTORIAL_NONE: u32 = 0;
/// The hint after the first ascension.
pub const TUTORIAL_ASCENDED: u32 = 100;

impl Engine {
    /// The tutorial step, `0` for none. The numbers are the old game's: 1-9
    /// in order, 11 between 3 and 4 (enough meat for a hatchery), 10 after
    /// the first mutagen spawn and 100 after the first ascension (both only
    /// in the session they happened, like `cache.firstSpawn`).
    ///
    /// The TS memoises it per tick; it reads only a few counts, so it is
    /// computed on each call.
    pub fn tutorial_step(&self) -> u32 {
        let data = self.data;
        let wk = data.well_known();
        let unit = |name: &str| -> Num { data.unit_id(name).map_or(Num::ZERO, |u| self.count(u)) };
        let spawned = |u: UnitId| self.rt.first_spawn.contains_key(&u);
        if !self.count(wk.ascension).is_zero() {
            // (almost) no tutorial after the first ascension
            return if spawned(wk.ascension) {
                TUTORIAL_ASCENDED
            } else {
                TUTORIAL_NONE
            };
        }
        if spawned(wk.premutagen) {
            return 10;
        }
        let expansion = self.upgrade_count(wk.expansion);
        if expansion >= Num::from(5) {
            return TUTORIAL_NONE;
        }
        if expansion.is_positive() {
            return 9;
        }
        let hatchery = self.upgrade_count(wk.hatchery).is_positive();
        if hatchery {
            let queen = unit("queen");
            if queen >= Num::from(5) {
                let territory = unit("territory");
                return if territory > Num::from(5) {
                    8
                } else if territory.is_positive() {
                    7
                } else {
                    6
                };
            }
            if queen.is_positive() {
                return 5;
            }
        }
        let drone = unit("drone");
        if drone >= Num::from(10) {
            if hatchery {
                return 4;
            }
            if unit("meat") >= Num::from(300) {
                return 11;
            }
            return 3;
        }
        if drone.is_positive() {
            return 2;
        }
        1
    }
}
