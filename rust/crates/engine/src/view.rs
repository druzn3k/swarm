//! A first, minimal view: what a frontend or test reads each tick, index
//! aligned with the data (no names). The full view of plan section 4
//! (tabs, ascension, statistics, effects, estimates, hints) comes with the
//! TUI milestone.

use serde::Serialize;
use swarm_data::{StatId, UnitId};
use swarm_num::Num;

use crate::engine::{Engine, OfflineReport};
use crate::events::Event;

/// What to compute.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ViewRequest {
    /// Units whose stats to include.
    pub focus: Vec<UnitId>,
}

/// One tick's view of the game.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct View {
    /// Bumps on every view.
    pub seq: u64,
    /// The game clock.
    pub now_ms: i64,
    /// Per unit, in data order.
    pub units: Vec<UnitView>,
    /// Per upgrade, in data order.
    pub upgrades: Vec<UpgradeView>,
    /// Per achievement, in data order.
    pub achievements: Vec<AchievementView>,
    /// Achievement points earned.
    pub achievement_points: u32,
    /// The welcome-back report, until dismissed.
    pub offline: Option<OfflineReport>,
    /// Events since the last view.
    pub events: Vec<Event>,
}

/// A unit.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UnitView {
    /// Count now.
    pub count: Num,
    /// Per second.
    pub velocity: Num,
    /// Shown.
    pub visible: bool,
    /// Roman-numeral suffix.
    pub suffix: String,
    /// Buyable now.
    pub buyable: bool,
    /// Buy buttons shown.
    pub buy_button_visible: bool,
    /// At least one affordable.
    pub cost_met: bool,
    /// Affordable count ([`Num::MAX`] without costs).
    pub max_cost_met: Num,
    /// Affordable with a quarter of the resources.
    pub max_cost_met_quarter: Num,
    /// Units per purchase.
    pub twin_mult: Num,
    /// Cost of one, `(unit index, amount)`.
    pub each_cost: Vec<(u16, Num)>,
    /// Cap, if capped.
    pub cap: Option<Num>,
    /// Stats, for focused units.
    pub stats: Option<Vec<(u16, Num)>>,
}

/// An upgrade.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UpgradeView {
    /// Level.
    pub count: Num,
    /// Shown.
    pub visible: bool,
    /// Buyable now.
    pub buyable: bool,
    /// The upgrade arrow (watched and affordable).
    pub newly_upgradable: bool,
    /// Watch level.
    pub watched: i32,
    /// Affordable levels.
    pub max_cost_met: Num,
    /// Progress to the next level, 0..=1.
    pub cost_met_percent: Num,
    /// Cost of the next level, `(unit index, amount)`.
    pub total_cost: Vec<(u16, Num)>,
}

/// An achievement.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AchievementView {
    /// Milliseconds after the start when earned.
    pub earned_at: Option<i64>,
    /// Not masked.
    pub unmasked: bool,
    /// Sort key: 2 earned, -2 masked, progress, or -1.
    pub progress_order: f64,
}

/// Names and labels, sent once.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StaticView {
    /// Unit names, by index.
    pub units: Vec<String>,
    /// Upgrade names, by index.
    pub upgrades: Vec<String>,
    /// Achievement names, by index.
    pub achievements: Vec<String>,
    /// Stat names, by index.
    pub stats: Vec<String>,
}

impl Engine {
    /// Computes the view and drains the events. Units are queried before
    /// upgrades (visibility is sticky, so query order matters).
    pub fn view(&mut self, req: &ViewRequest) -> View {
        let data = self.data;
        let units = data
            .units()
            .iter()
            .map(|u| {
                let id = u.id;
                let visible = self.unit_visible(id);
                UnitView {
                    count: self.count(id),
                    velocity: self.velocity(id),
                    visible,
                    suffix: self.suffix(id),
                    buyable: visible && self.unit_is_buyable(id, false),
                    buy_button_visible: visible && self.is_buy_button_visible(id),
                    cost_met: self.unit_is_cost_met(id),
                    max_cost_met: self.unit_max_cost_met(id, Num::ONE),
                    max_cost_met_quarter: self.unit_max_cost_met(id, Num::from(0.25)),
                    twin_mult: self.twin_mult(id),
                    each_cost: self
                        .each_cost(id)
                        .into_iter()
                        .map(|c| (c.unit.0, c.val))
                        .collect(),
                    cap: self.cap(id),
                    stats: req.focus.contains(&id).then(|| {
                        self.stats(id)
                            .into_iter()
                            .map(|(s, v): (StatId, Num)| (s.0, v))
                            .collect()
                    }),
                }
            })
            .collect();
        let upgrades = data
            .upgrades()
            .iter()
            .map(|g| {
                let id = g.id;
                let visible = self.upgrade_visible(id);
                UpgradeView {
                    count: self.upgrade_count(id),
                    visible,
                    buyable: visible && self.upgrade_is_buyable(id),
                    newly_upgradable: visible && self.upgrade_is_newly_upgradable(id, 1.0),
                    watched: self.watched_at(id),
                    max_cost_met: self.upgrade_max_cost_met(id, Num::ONE),
                    cost_met_percent: self.upgrade_cost_met_percent(id),
                    total_cost: self
                        .total_cost(id)
                        .into_iter()
                        .map(|c| (c.unit.0, c.val))
                        .collect(),
                }
            })
            .collect();
        let achievements = data
            .achievements()
            .iter()
            .map(|a| AchievementView {
                earned_at: self.achievement_earned_at(a.id),
                unmasked: self.achievement_unmasked(a.id),
                progress_order: self.achievement_progress_order(a.id),
            })
            .collect();
        self.rt.view_seq += 1;
        View {
            seq: self.rt.view_seq,
            now_ms: self.rt.now_ms,
            units,
            upgrades,
            achievements,
            achievement_points: self.achievement_points(),
            offline: self.rt.offline,
            events: self.drain_events(),
        }
    }

    /// Names, by index.
    pub fn static_view(&self) -> StaticView {
        let d = self.data;
        StaticView {
            units: d.units().iter().map(|u| u.name.clone()).collect(),
            upgrades: d.upgrades().iter().map(|g| g.name.clone()).collect(),
            achievements: d.achievements().iter().map(|a| a.name.clone()).collect(),
            stats: d.stat_names().to_vec(),
        }
    }
}
