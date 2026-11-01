//! Purchase statistics (`engine/src/statistics.ts`). Recorded for each
//! command event before achievements are checked, since unit achievements
//! count the `twinnum` statistic.

use swarm_num::Num;

use crate::command::CommandEvent;
use crate::engine::Engine;
use crate::events::Event;
use crate::state::{UnitStatistics, UpgradeStatistics};

impl Engine {
    /// Records a command (TS `StatisticsListener.push`), queueing
    /// [`Event::BuyFirst`] for a first purchase.
    pub(crate) fn record_statistics(&mut self, cmd: &CommandEvent) {
        let data = self.data;
        let stats = &mut self.state.statistics;
        stats.clicks += 1;
        if let Some(u) = cmd.unit {
            let name = &data.unit(u).name;
            let s = stats.by_unit.entry(name.clone()).or_insert_with(|| {
                self.rt.events.push(Event::BuyFirst {
                    unit: Some(u),
                    upgrade: None,
                });
                UnitStatistics {
                    clicks: 0,
                    num: Num::ZERO,
                    twinnum: Num::ZERO,
                    elapsed_first: Some(cmd.elapsed_ms),
                }
            });
            s.clicks += 1;
            s.num += cmd.num.unwrap_or(Num::ZERO);
            s.twinnum += cmd.twinnum.unwrap_or(Num::ZERO);
        }
        if let Some(g) = cmd.upgrade {
            let name = &data.upgrade(g).name;
            let s = stats.by_upgrade.entry(name.clone()).or_insert_with(|| {
                self.rt.events.push(Event::BuyFirst {
                    unit: None,
                    upgrade: Some(g),
                });
                UpgradeStatistics {
                    clicks: 0,
                    num: Num::ZERO,
                    elapsed_first: Some(cmd.elapsed_ms),
                }
            });
            s.clicks += 1;
            s.num += cmd.num.unwrap_or(Num::ZERO);
        }
        self.session_save();
    }
}
