//! The welcome-back report: what the swarm produced while the game was
//! closed. A port of the app's `app/src/game/welcomeback.ts` (itself the old
//! `WelcomeBackCtrl`), moved into the engine so every frontend shows the
//! same numbers.
//!
//! [`Engine::load`] computes it once, right after loading (later, the
//! counts would include time played since), and [`Engine::resync_wall`]
//! after a suspend of at least [`WELCOME_BACK_MIN_MS`]. It stays pending until
//! [`Command::DismissWelcomeBack`](crate::Command::DismissWelcomeBack), and
//! the view carries it as [`View::welcome_back`](crate::View::welcome_back).

use serde::{Deserialize, Serialize};
use swarm_data::UnitId;
use swarm_num::Num;

use crate::engine::{Engine, OfflineReport};

/// Shown only after at least this long away, so a page refresh shows
/// nothing (`WELCOME_BACK_MINUTES = 3`).
pub const WELCOME_BACK_MIN_MS: i64 = 3 * 60_000;

/// How many of the meat tab's producing units are listed.
const MEAT_LEADERS: usize = 3;

/// What was produced while away.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WelcomeBack {
    /// How long the game was closed, ms (never negative).
    pub away_ms: i64,
    /// When it was closed (the latest of the save's dates and the
    /// heartbeat), epoch ms.
    pub closed_ms: i64,
    /// The positive gains, in [`Engine::interesting_units`] order.
    pub gains: Vec<OfflineGain>,
}

/// One unit's offline gain.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct OfflineGain {
    /// The unit's index (see [`OfflineGain::unit_id`]).
    pub unit: u16,
    /// How many more there are now than when the game was closed.
    pub val: Num,
}

impl OfflineGain {
    /// The unit, as an id.
    pub fn unit_id(&self) -> UnitId {
        UnitId(self.unit)
    }
}

impl Engine {
    /// The units worth listing in the welcome-back report
    /// (`interestingUnits`): the meat tab's first three units with a
    /// nonzero velocity, in its `sortedUnits` order (highest tier first,
    /// *not* sorted by empower), then every tab's lead unit, without
    /// repeats.
    pub fn interesting_units(&self) -> Vec<UnitId> {
        let tabs = self.data.tabs();
        let mut list = Vec::new();
        if let Some(meat) = tabs.by_name("meat") {
            list.extend(
                tabs.get(meat)
                    .sorted_units()
                    .filter(|&u| !self.velocity(u).is_zero())
                    .take(MEAT_LEADERS),
            );
        }
        list.extend(tabs.list.iter().map(|t| t.lead));
        let mut seen = vec![false; self.data.units().len()];
        list.retain(|u| !std::mem::replace(&mut seen[u.index()], true));
        list
    }

    /// Computes a welcome-back report for a game closed at `closed_ms`
    /// (`computeWelcomeBack`): `None` if it was closed for less than
    /// [`WELCOME_BACK_MIN_MS`], unless `force`. Each interesting unit's
    /// gain is its count now minus its count at `closed_ms` (the
    /// polynomial from the last reify), kept if positive. Call it right
    /// after loading or importing; [`Engine::load`] already does.
    pub fn compute_welcome_back(&self, closed_ms: i64, force: bool) -> Option<WelcomeBack> {
        let away_ms = self.rt.now_ms - closed_ms;
        if away_ms < WELCOME_BACK_MIN_MS && !force {
            return None;
        }
        let reified_to_close = (closed_ms - self.state.dates.reified) as f64 / 1000.0;
        let gains = self
            .interesting_units()
            .into_iter()
            .filter_map(|u| {
                let then = self.count_in_secs_from_reified(u, Num::from_f64(reified_to_close));
                let diff = self.count(u) - then;
                diff.is_positive().then_some(OfflineGain {
                    unit: u.0,
                    val: diff,
                })
            })
            .collect();
        Some(WelcomeBack {
            away_ms: away_ms.max(0),
            closed_ms,
            gains,
        })
    }

    /// [`Engine::compute_welcome_back`] for `offline`, leaving the caches
    /// as they were: memoised stats would otherwise capture this moment's
    /// counts (PARITY(cache)) where later queries would not.
    pub(crate) fn welcome_back_cache_neutral(
        &mut self,
        offline: OfflineReport,
    ) -> Option<WelcomeBack> {
        let caches = self.cache.borrow().clone();
        let wb = self.compute_welcome_back(offline.closed_ms, false);
        *self.cache.get_mut() = caches;
        wb
    }

    /// The pending welcome-back report: computed at load (and by
    /// [`Engine::resync_wall`] after a long suspend), `None` when the
    /// game was away for less than [`WELCOME_BACK_MIN_MS`] or after
    /// [`Command::DismissWelcomeBack`](crate::Command::DismissWelcomeBack).
    pub fn welcome_back(&self) -> Option<&WelcomeBack> {
        self.rt.offline?;
        self.rt.welcome_back.as_ref()
    }
}
