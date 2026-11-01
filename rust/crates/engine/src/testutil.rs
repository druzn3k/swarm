//! Helpers for the ported specs.

use swarm_data::{GameData, UnitId, UpgradeId};
use swarm_num::Num;

use crate::engine::Engine;
use crate::state::State;

/// Parses a number.
pub fn n(s: &str) -> Num {
    s.parse().unwrap()
}

/// The specs' `mkgame`: a game on a minimal state with these counts, every
/// date and the clock at epoch 0, no backfill.
pub fn mkgame(counts: &[(&str, &str)]) -> Engine {
    mkgame_at(counts, 0)
}

/// [`mkgame`] with the dates at `reified`.
pub fn mkgame_at(counts: &[(&str, &str)], reified: i64) -> Engine {
    let s = State::with_units(reified, counts.iter().map(|&(k, v)| (k, n(v))));
    let mut e = match Engine::from_state(GameData::embedded(), s, 0) {
        Ok(e) => e,
        Err((err, _)) => panic!("{err}"),
    };
    e.force_now_ms(0);
    e
}

/// A unit id by name.
pub fn u(name: &str) -> UnitId {
    GameData::embedded().unit_id(name).unwrap()
}

/// An upgrade id by name.
pub fn g(name: &str) -> UpgradeId {
    GameData::embedded().upgrade_id(name).unwrap()
}

/// `count().toNumber()`.
pub fn ct(e: &Engine, name: &str) -> f64 {
    e.count(u(name)).to_f64()
}
