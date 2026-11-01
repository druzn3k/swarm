//! Tabs, built once from the data (`engine/src/tab.ts` `buildTabs`).
//!
//! The tab *structure* is static. The order units are shown in is not:
//! `Tab.sortUnits` sorts by the runtime `empower` stat, so the view computes
//! it, starting from [`Tab::sorted_units`].

use crate::ids::{TabId, UnitId};
use crate::types::UnitType;

/// A tab: the units with that `tab` name that aren't disabled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tab {
    /// Tab name (the units' `tab`).
    pub name: String,
    /// The first unit listed, which decides whether the tab is visible.
    pub lead: UnitId,
    /// Units in table order.
    pub units: Vec<UnitId>,
}

impl Tab {
    /// The TS `sortedUnits`: the units in reverse order, highest tier first.
    /// `sortUnits` then stable-sorts these by `empower`, descending.
    pub fn sorted_units(&self) -> impl Iterator<Item = UnitId> + '_ {
        self.units.iter().rev().copied()
    }

    /// The unit after `unit` in this tab (TS `Tab.next`).
    pub fn next(&self, unit: UnitId) -> Option<UnitId> {
        let i = self.units.iter().position(|&u| u == unit)?;
        self.units.get(i + 1).copied()
    }

    /// The unit before `unit` in this tab (TS `Tab.prev`).
    pub fn prev(&self, unit: UnitId) -> Option<UnitId> {
        let i = self.units.iter().position(|&u| u == unit)?;
        i.checked_sub(1).map(|i| self.units[i])
    }
}

/// All tabs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tabs {
    /// The listed tabs, in the order their lead units appear.
    pub list: Vec<Tab>,
    /// The magic `all` tab, which isn't listed: every unit of every tab, in
    /// table order. Unlike the others, the TS engine shows it unsorted and
    /// in table order (it reverses its `sortedUnits` back).
    pub all: Tab,
    /// Each unit's tab, by unit index; `None` for units in no tab (no tab
    /// name, or disabled).
    pub by_unit: Vec<Option<TabId>>,
}

impl Tabs {
    /// The tab with this name; `"all"` isn't one of them.
    pub fn by_name(&self, name: &str) -> Option<TabId> {
        self.list
            .iter()
            .position(|t| t.name == name)
            .map(TabId::from_index)
    }

    /// The tab with this id.
    pub fn get(&self, id: TabId) -> &Tab {
        &self.list[id.index()]
    }

    /// The tab listing `unit`, if any.
    pub fn of_unit(&self, unit: UnitId) -> Option<TabId> {
        self.by_unit[unit.index()]
    }
}

/// `None` when no unit is in any tab (the TS engine would crash).
pub(crate) fn build(units: &[UnitType]) -> Option<Tabs> {
    let mut list: Vec<Tab> = Vec::new();
    let mut all: Option<Tab> = None;
    let mut by_unit = vec![None; units.len()];
    for unit in units {
        let Some(name) = unit.tab_name.as_deref() else {
            continue;
        };
        if unit.disabled {
            continue;
        }
        let i = match list.iter().position(|t| t.name == name) {
            Some(i) => {
                list[i].units.push(unit.id);
                i
            }
            None => {
                list.push(Tab {
                    name: name.to_owned(),
                    lead: unit.id,
                    units: vec![unit.id],
                });
                list.len() - 1
            }
        };
        by_unit[unit.id.index()] = Some(TabId::from_index(i));
        match &mut all {
            Some(all) => all.units.push(unit.id),
            None => {
                all = Some(Tab {
                    name: "all".to_owned(),
                    lead: unit.id,
                    units: vec![unit.id],
                })
            }
        }
    }
    Some(Tabs {
        list,
        all: all?,
        by_unit,
    })
}
