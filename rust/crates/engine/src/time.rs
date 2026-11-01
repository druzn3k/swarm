//! The game clock (`game.ts:205-266`, `374-411`).
//!
//! A unit's count is a polynomial in the seconds since the last *reify*
//! ([`Engine::diff_seconds`]); moving the clock changes nothing in the
//! state. Only [`Engine::with_save`] (every command) reifies: it writes the
//! current counts back and moves `reified` to now.

use core::fmt;
use core::time::Duration;

use crate::engine::{Engine, OfflineReport};
use crate::seedrand::utc_date_string;

/// How far back in time a tick may go before it is an error
/// (`game.ts:255-264`); smaller steps back are ignored.
pub const BACK_IN_TIME_TOLERANCE_MS: i64 = 120_000;

/// The wall clock must be ahead of the game clock by more than this for
/// [`Engine::resync_wall`] to add the gap.
pub const RESYNC_THRESHOLD_MS: i64 = 5_000;

/// A tick went back in time by more than [`BACK_IN_TIME_TOLERANCE_MS`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeError {
    /// The game clock.
    pub now_ms: i64,
    /// The requested time.
    pub to_ms: i64,
}

impl fmt::Display for TimeError {
    /// The TS assertion message, byte for byte.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "tick tried to go back in time. System clock problem?,{},{},{}",
            utc_date_string(self.now_ms),
            utc_date_string(self.to_ms),
            self.now_ms - self.to_ms
        )
    }
}

impl std::error::Error for TimeError {}

impl Engine {
    /// The game clock, epoch ms (TS `game.now`).
    pub fn now_ms(&self) -> i64 {
        self.rt.now_ms
    }

    /// When the counts were last written back (`state.dates.reified`).
    pub fn reified_ms(&self) -> i64 {
        self.state.dates.reified
    }

    /// Milliseconds skipped since the last reify (TS `game.skippedMillis`).
    pub fn skipped_ms(&self) -> i64 {
        self.rt.skipped_ms
    }

    /// Total milliseconds skipped (TS `totalSkippedMillis`).
    pub fn total_skipped_ms(&self) -> i64 {
        self.state.skipped_ms
    }

    /// The debug speed multiplier.
    pub fn game_speed(&self) -> f64 {
        self.rt.game_speed
    }

    /// Sets the debug speed multiplier, reifying first (`game.ts:231-234`).
    pub fn set_game_speed(&mut self, speed: f64) {
        self.reify();
        self.rt.game_speed = speed;
    }

    fn real_diff_ms(&self) -> f64 {
        (self.rt.now_ms - self.state.dates.reified).max(0) as f64
    }

    /// Game milliseconds since the last reify: real time (never negative)
    /// times the game speed, plus skipped time (`game.ts:205-211`).
    pub fn diff_ms(&self) -> f64 {
        self.real_diff_ms() * self.rt.game_speed + self.rt.skipped_ms as f64
    }

    /// [`Engine::diff_ms`] in seconds: the polynomial's `t`.
    pub fn diff_seconds(&self) -> f64 {
        self.diff_ms() / 1000.0
    }

    /// Milliseconds since the game started (TS `elapsedStartMillis`).
    pub fn elapsed_start_ms(&self) -> i64 {
        self.rt.now_ms - self.state.dates.started
    }

    /// TS `timestampMillis`: elapsed plus skipped.
    pub fn timestamp_ms(&self) -> i64 {
        self.elapsed_start_ms() + self.total_skipped_ms()
    }

    /// Skips game time (swarmwarp): `ms` is floored (`game.ts:216-220`).
    pub fn skip_ms(&mut self, ms: f64) {
        let ms = ms.floor() as i64;
        self.rt.skipped_ms += ms;
        self.state.skipped_ms += ms;
    }

    /// TS `game.tick(now)`: moves the clock. A step back of at most 120 s is
    /// ignored (the game clock stays; only the periodic-cache clock moves);
    /// further back is an error.
    pub(crate) fn tick_to(&mut self, to_ms: i64) -> Result<(), TimeError> {
        self.rt.clock_ms = to_ms;
        if self.rt.now_ms <= to_ms {
            self.rt.now_ms = to_ms;
            self.cache.get_mut().on_tick(to_ms);
            Ok(())
        } else if self.rt.now_ms - to_ms <= BACK_IN_TIME_TOLERANCE_MS {
            Ok(())
        } else {
            Err(TimeError {
                now_ms: self.rt.now_ms,
                to_ms,
            })
        }
    }

    /// Advances live time by a monotonic delta.
    pub fn advance(&mut self, dt: Duration) {
        let ms = i64::try_from(dt.as_millis()).unwrap_or(i64::MAX / 4);
        let to = self.rt.now_ms.max(self.rt.clock_ms).saturating_add(ms);
        // forward, so this can't fail
        let _ = self.tick_to(to);
    }

    /// After a suspend or a hidden tab, monotonic clocks may have stopped:
    /// if the wall clock is more than 5 s ahead of the game clock, jump to it
    /// and report the gap. Never moves the clock back.
    pub fn resync_wall(&mut self, wall_now_ms: i64) -> Option<OfflineReport> {
        if wall_now_ms - self.rt.now_ms > RESYNC_THRESHOLD_MS {
            let report = OfflineReport {
                closed_ms: self.rt.now_ms,
                resumed_ms: wall_now_ms,
            };
            let _ = self.tick_to(wall_now_ms);
            Some(report)
        } else {
            None
        }
    }

    /// Sets the clock like the TS `game.tick(new Date(ms))`, including the
    /// 120 s back-in-time tolerance. For parity tools and tests.
    #[cfg(any(test, feature = "parity"))]
    pub fn set_now_ms(&mut self, ms: i64) -> Result<(), TimeError> {
        self.tick_to(ms)
    }

    /// Forces the game clock without a tick (the TS specs' `game.now = ...`):
    /// no caches are cleared. For parity tools and tests.
    #[cfg(any(test, feature = "parity"))]
    pub fn force_now_ms(&mut self, ms: i64) {
        self.rt.now_ms = ms;
    }

    /// Writes the current counts back to the state and restarts the
    /// polynomial at now (`game.ts:374-382`). Every unit is written, so
    /// afterwards every unit counts as initialised.
    pub fn reify(&mut self) {
        let counts: Vec<_> = self
            .data
            .units()
            .iter()
            .map(|u| (u.name.clone(), self.count(u.id)))
            .collect();
        for (name, n) in counts {
            self.state.units.insert(name, n);
        }
        self.rt.skipped_ms = 0;
        // `diffMillis() - realDiffMillis()` with skippedMillis already zeroed:
        // only a game speed other than 1 adds anything
        let extra = self.diff_ms() - self.real_diff_ms();
        self.state.skipped_ms += extra as i64;
        self.state.dates.reified = self.rt.now_ms;
        self.on_update();
        debug_assert_eq!(self.diff_seconds(), 0.0, "diffseconds != 0 after reify!");
    }

    /// Clears the update-generation caches (TS `cache.onUpdate()`).
    pub(crate) fn on_update(&mut self) {
        let clock = self.rt.clock_ms;
        self.cache.get_mut().on_update(clock);
    }

    /// TS `game.withSave(fn)`: reify, run `f`, reify again (for swarmwarp,
    /// erosson/swarm#241), save. If `f` fails, its changes so far are kept
    /// and nothing more happens, like the TS exception.
    pub fn with_save<T, E>(&mut self, f: impl FnOnce(&mut Engine) -> Result<T, E>) -> Result<T, E> {
        self.reify();
        let ret = f(self)?;
        self.reify();
        self.session_save();
        self.on_update();
        Ok(ret)
    }

    /// TS `game.withUnreifiedSave(fn)`: change something that doesn't
    /// affect counts, then save. No reify, and **no cache clear**.
    pub(crate) fn with_unreified_save<T>(&mut self, f: impl FnOnce(&mut Engine) -> T) -> T {
        let ret = f(self);
        self.session_save();
        ret
    }

    /// TS `game.save()`.
    pub fn save(&mut self) {
        let _: Result<(), ()> = self.with_save(|_| Ok(()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::State;
    use swarm_data::GameData;

    #[test]
    fn diffs_seconds() {
        let mut s = State::with_units(0, []);
        s.dates.reified = 1000;
        let mut e = Engine::from_state(GameData::embedded(), s, 0).unwrap();
        e.force_now_ms(0);
        e.set_now_ms(1000).unwrap();
        assert_eq!(e.diff_ms(), 0.0);
        e.set_now_ms(2000).unwrap();
        assert_eq!(e.diff_ms(), 1000.0);
        assert_eq!(e.diff_seconds(), 1.0);
        e.set_now_ms(3500).unwrap();
        assert_eq!(e.diff_seconds(), 2.5);
    }

    #[test]
    fn ignores_small_clock_skews_but_errors_for_big_ones() {
        let mut e = Engine::from_state(GameData::embedded(), State::with_units(0, []), 0).unwrap();
        e.set_now_ms(200_000).unwrap();
        e.set_now_ms(200_000 - 120_000).unwrap();
        assert_eq!(e.now_ms(), 200_000);
        let err = e.set_now_ms(200_000 - 120_001).unwrap_err();
        assert_eq!(
            err.to_string(),
            "tick tried to go back in time. System clock problem?,Thu Jan 01 1970 00:03:20 GMT+0000 (Coordinated Universal Time),Thu Jan 01 1970 00:01:19 GMT+0000 (Coordinated Universal Time),120001"
        );
        assert_eq!(e.now_ms(), 200_000);
    }

    #[test]
    fn advance_and_resync() {
        let mut e = Engine::new_game(GameData::embedded(), 1_000_000);
        e.advance(Duration::from_millis(1500));
        assert_eq!(e.now_ms(), 1_001_500);
        assert_eq!(e.resync_wall(1_003_000), None);
        let r = e.resync_wall(1_101_500).unwrap();
        assert_eq!(r.away_ms(), 100_000);
        assert_eq!(e.now_ms(), 1_101_500);
        assert_eq!(e.resync_wall(0), None);
    }
}
