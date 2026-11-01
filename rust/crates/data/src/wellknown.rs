//! Handles for the units, upgrades and tab the engine refers to by name.
//! Resolved, and so asserted to exist, at load.

use std::collections::HashMap;

use crate::error::{invalid, DataError};
use crate::ids::{TabId, UnitId, UpgradeId};
use crate::tabs::Tabs;

macro_rules! well_known {
    (
        units { $($u:ident = $uname:literal, $udoc:literal;)* }
        upgrades { $($g:ident = $gname:literal, $gdoc:literal;)* }
        tabs { $($t:ident = $tname:literal, $tdoc:literal;)* }
    ) => {
        /// The units, upgrades and tabs hard-coded in the engine.
        #[derive(Clone, Copy, Debug)]
        pub struct WellKnown {
            $(#[doc = concat!("Unit `", $uname, "`: ", $udoc)] pub $u: UnitId,)*
            $(#[doc = concat!("Upgrade `", $gname, "`: ", $gdoc)] pub $g: UpgradeId,)*
            $(#[doc = concat!("Tab `", $tname, "`: ", $tdoc)] pub $t: TabId,)*
        }

        impl WellKnown {
            pub(crate) fn resolve(
                units: &HashMap<String, UnitId>,
                upgrades: &HashMap<String, UpgradeId>,
                tabs: &Tabs,
            ) -> Result<WellKnown, DataError> {
                Ok(WellKnown {
                    $($u: match units.get($uname) {
                        Some(&id) => id,
                        None => return invalid(concat!("well-known unit `", $uname, "` is missing")),
                    },)*
                    $($g: match upgrades.get($gname) {
                        Some(&id) => id,
                        None => return invalid(concat!("well-known upgrade `", $gname, "` is missing")),
                    },)*
                    $($t: match tabs.by_name($tname) {
                        Some(id) => id,
                        None => return invalid(concat!("well-known tab `", $tname, "` is missing")),
                    },)*
                })
            }
        }
    };
}

well_known! {
    units {
        energy = "energy", "abilities' currency; ascension and respec costs.";
        mtx_energy = "mtxEnergy", "buying energy also adds to it (`unit.ts` buy).";
        mutagen = "mutagen", "ascension currency; its `ascendCost` stat.";
        premutagen = "premutagen", "becomes mutagen when ascending.";
        ascension = "ascension", "ascension count.";
        free_respec = "freeRespec", "free respecs left.";
        respec_energy = "respecEnergy", "energy refunded by respecs.";
        invisible_hatchery = "invisiblehatchery", "holds the `random.minlevel.*` stats backfill reads.";
    }
    upgrades {
        hatchery = "hatchery", "backfill replays its premutagen spawns.";
        expansion = "expansion", "backfill replays its premutagen spawns.";
        mutatehidden = "mutatehidden", "subtracted from mutagen spent (respec).";
        swarmwarp = "swarmwarp", "skips time; `with_save` reifies twice for it.";
    }
    tabs {
        mutagen_tab = "mutagen", "upgrades of its units survive ascension.";
    }
}
