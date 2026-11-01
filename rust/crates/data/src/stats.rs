//! Interned stat names.
//!
//! The TS engine keys unit stats by string (`stats[effect.stat]`). Here every
//! stat name that can ever be set or read gets a [`StatId`], so stats can be
//! a dense array: the stats the effects write, the fixed names the engine
//! reads, and the per-unit and per-upgrade families (`cost.<unit>`,
//! `power.<upgrade>`, `upgradecostmult.<upgrade>`,
//! `random.minlevel.<upgrade>`). A stat no effect writes always reads as the
//! caller's default.

use std::collections::HashMap;

use crate::ids::StatId;

/// The stat-name table.
#[derive(Clone, Debug, Default)]
pub(crate) struct StatTable {
    pub(crate) names: Vec<String>,
    pub(crate) by_name: HashMap<String, StatId>,
}

impl StatTable {
    pub(crate) fn intern(&mut self, name: &str) -> StatId {
        if let Some(&id) = self.by_name.get(name) {
            return id;
        }
        let id = StatId::from_index(self.names.len());
        self.names.push(name.to_owned());
        self.by_name.insert(name.to_owned(), id);
        id
    }
}

macro_rules! well_known_stats {
    ($($field:ident = $name:literal, $doc:literal;)*) => {
        /// The stats the engine reads by a fixed name.
        #[derive(Clone, Copy, Debug)]
        pub struct WellKnownStats {
            $(#[doc = concat!("`", $name, "`: ", $doc)] pub $field: StatId,)*
        }

        impl WellKnownStats {
            pub(crate) fn intern(table: &mut StatTable) -> WellKnownStats {
                WellKnownStats { $($field: table.intern($name),)* }
            }
        }
    };
}

well_known_stats! {
    prod = "prod", "multiplies a unit's production (`unit.ts` prodEach).";
    base = "base", "added to each prod.val along a producer path.";
    power = "power", "multiplies every effect's output (`effect.ts` power()).";
    cost = "cost", "multiplies a unit's costs.";
    cap_base = "capBase", "unit cap base.";
    cap_mult = "capMult", "unit cap multiplier.";
    cap_flat = "capFlat", "added to the unit cap.";
    twin = "twin", "units gained per unit bought.";
    twinbase = "twinbase", "twin base.";
    empower = "empower", "written by the suffix effect; sorts tabs.";
    upgradecost = "upgradecost", "added to an upgrade's level in its cost.";
    upgradecostmult = "upgradecostmult", "multiplies the costs of all of a unit's upgrades.";
    ascend_cost = "ascendCost", "mutagen's ascension cost multiplier.";
    random_each = "random.each", "addUnitRand quantity multiplier.";
    random_freq = "random.freq", "addUnitRand probability multiplier.";
}
