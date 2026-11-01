//! Swarm Simulator game engine.
//!
//! A port of the TypeScript engine (`engine/src`). See `rust/PLAN.md`
//! sections 1 and 4 for the module map and public API.
//!
//! The [`Engine`] holds the game data, the persisted [`State`] and a
//! runtime (clock, caches, undo, event queue). A unit's count is a
//! closed-form polynomial in the time since the last *reify*
//! ([`production`]); moving the clock ([`Engine::advance`]) changes nothing
//! in the state, so offline catch-up is exact and O(1). Commands
//! ([`Engine::apply`]) reify, change the state and record statistics and
//! achievements.
//!
//! Some caches change game behaviour (sticky visibility, 3 s stale
//! "upgradable" flags, stats that miss achievements until the next
//! purchase). They are kept for parity with the TS engine and marked
//! `PARITY(cache)`; see [`cache`].
//!
//! Where the TS uses `Infinity` or NaN as values, this crate uses
//! `Option`, [`Estimate`] or [`Num::MAX`](swarm_num::Num::MAX); each is
//! documented where it occurs. The crate is wasm-portable: all times are
//! arguments.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod achievement;
pub mod backfill;
pub mod cache;
pub mod command;
pub mod effects;
pub mod engine;
pub mod estimate;
pub mod events;
pub mod parse_number;
pub mod production;
pub mod progression;
pub mod seedrand;
pub mod state;
pub mod statistics;
pub mod time;
pub mod unit;
pub mod upgrade;
pub mod view;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod testutil;

pub use command::{
    Amount, Command, CommandError, CommandEvent, CommandOutcome, UndoState, UnitRef, UpgradeRef,
    UpgradeSet,
};
pub use effects::{EffectOutput, RandOutput};
pub use engine::{Engine, LoadError, LoadOutcome, OfflineReport};
pub use estimate::Estimate;
pub use events::Event;
pub use state::State;
pub use time::TimeError;
pub use unit::Bought;
pub use upgrade::{UpgradeCostVal, UpgradeEstimate};
pub use view::{StaticView, View, ViewRequest};
