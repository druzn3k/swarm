//! Achievements (`engine/src/achievement.ts`): earning, masking, progress,
//! and the listener that checks them after each command.

use serde_json::Value;
use swarm_data::{AchievementId, AchievementRequire, Resource};
use swarm_num::Num;

use crate::engine::Engine;
use crate::events::Event;

impl Engine {
    /// Earned.
    pub fn achievement_earned(&self, a: AchievementId) -> bool {
        self.state
            .achievements
            .contains_key(&self.data.achievement(a).name)
    }

    /// Milliseconds after the game started when it was earned.
    pub fn achievement_earned_at(&self, a: AchievementId) -> Option<i64> {
        self.state
            .achievements
            .get(&self.data.achievement(a).name)
            .copied()
    }

    /// Earns an achievement, if not yet earned, at `elapsed_ms` after the
    /// start (default: now). No reify and no cache clear (TS
    /// `withUnreifiedSave`): PARITY(cache) stats that count achievement
    /// points (`multStatPerAchievementPoint`) only see it after the next
    /// state change. Queues [`Event::Achieved`].
    pub fn earn_achievement(&mut self, a: AchievementId, elapsed_ms: Option<i64>) {
        if self.achievement_earned(a) {
            return;
        }
        let elapsed = elapsed_ms.unwrap_or_else(|| self.elapsed_start_ms());
        let name = self.data.achievement(a).name.clone();
        self.with_unreified_save(|e| {
            e.state.achievements.insert(name, elapsed);
        });
        self.rt.events.push(Event::Achieved(a));
    }

    /// Points of this achievement if earned, else 0.
    pub fn achievement_points_earned(&self, a: AchievementId) -> u32 {
        if self.achievement_earned(a) {
            self.data.achievement(a).points
        } else {
            0
        }
    }

    /// Total points earned.
    pub fn achievement_points(&self) -> u32 {
        self.data
            .achievements()
            .iter()
            .map(|a| self.achievement_points_earned(a.id))
            .sum()
    }

    /// Points earned over points possible.
    pub fn achievement_percent(&self) -> f64 {
        f64::from(self.achievement_points()) / f64::from(self.data.achievement_points_possible())
    }

    /// Shown unmasked: has visibility requirements and all are met. No
    /// requirements means forever masked.
    pub fn achievement_unmasked(&self, a: AchievementId) -> bool {
        let vis = &self.data.achievement(a).visible;
        !vis.is_empty() && vis.iter().all(|&(r, val)| self.resource_count(r) >= val)
    }

    /// Requires a count (so has a progress bar).
    pub fn achievement_has_progress(&self, a: AchievementId) -> bool {
        self.data
            .achievement(a)
            .requires
            .iter()
            .any(|r| matches!(r, AchievementRequire::Count { .. }))
    }

    /// The count required.
    pub fn achievement_progress_max(&self, a: AchievementId) -> Option<Num> {
        match self.data.achievement(a).requires.first()? {
            AchievementRequire::Count { val, .. } => Some(*val),
            AchievementRequire::Event { .. } => None,
        }
    }

    /// The count so far: an upgrade's level, an unbuyable unit's count, or
    /// a unit's bought `twinnum` statistic.
    pub fn achievement_progress_val(&self, a: AchievementId) -> Option<Num> {
        match self.data.achievement(a).requires.first()? {
            AchievementRequire::Count {
                resource: Resource::Upgrade(g),
                ..
            } => Some(self.upgrade_count(*g)),
            AchievementRequire::Count {
                resource: Resource::Unit(u),
                ..
            } => Some(if self.data.unit(*u).unbuyable {
                self.count(*u)
            } else {
                self.unit_statistics(*u).map_or(Num::ZERO, |s| s.twinnum)
            }),
            AchievementRequire::Event { .. } => None,
        }
    }

    /// Sort key for the achievements screen: 2 earned, -2 masked, the
    /// progress fraction, or -1.
    pub fn achievement_progress_order(&self, a: AchievementId) -> f64 {
        if self.achievement_earned(a) {
            return 2.0;
        }
        if !self.achievement_unmasked(a) {
            return -2.0;
        }
        if self.achievement_has_progress(a) {
            if let (Some(max), Some(val)) = (
                self.achievement_progress_max(a),
                self.achievement_progress_val(a),
            ) {
                if max.is_positive() {
                    return (val / max).to_f64();
                }
            }
        }
        -1.0
    }

    /// Earns every unit achievement whose count is reached: the bought
    /// `twinnum` statistic, or the current count if `rawcount` (ascension)
    /// (`achievement.ts:149-171`).
    pub(crate) fn achieve_units(&mut self, rawcount: bool) {
        let data = self.data;
        for a in data.achievements() {
            for r in &a.requires {
                if let AchievementRequire::Count {
                    resource: Resource::Unit(u),
                    val,
                } = r
                {
                    if val.is_zero() {
                        continue;
                    }
                    let count = if rawcount {
                        self.count(*u)
                    } else {
                        self.unit_statistics(*u).map_or(Num::ZERO, |s| s.twinnum)
                    };
                    if count >= *val {
                        self.earn_achievement(a.id, None);
                    }
                }
            }
        }
    }

    /// Earns every upgrade achievement whose level is reached.
    pub(crate) fn achieve_upgrades(&mut self) {
        let data = self.data;
        for a in data.achievements() {
            for r in &a.requires {
                if let AchievementRequire::Count {
                    resource: Resource::Upgrade(g),
                    val,
                } = r
                {
                    if !val.is_zero() && self.upgrade_count(*g) >= *val {
                        self.earn_achievement(a.id, None);
                    }
                }
            }
        }
    }

    /// A UI event (`achieveclick`, `konami`, `import`, ...): earns the
    /// achievements for it whose params all appear, equal, in `params`
    /// (`achievement.ts:195-211`).
    pub fn ui_event(&mut self, name: &str, params: &Value) {
        let data = self.data;
        for a in data.achievements() {
            for r in &a.requires {
                if let AchievementRequire::Event {
                    event,
                    params: want,
                } = r
                {
                    if event != name {
                        continue;
                    }
                    let ok = match want {
                        None => true,
                        Some(want) => want.iter().all(|(k, v)| params.get(k) == Some(v)),
                    };
                    if ok {
                        self.earn_achievement(a.id, None);
                    }
                }
            }
        }
    }
}
