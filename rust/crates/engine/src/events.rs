//! Events the engine queues for the frontend (formerly the TS event bus,
//! `engineevents.ts`). There are no listeners: [`Engine::apply`] runs
//! statistics and achievements itself, in the TS listener order, and the
//! frontend drains the queue (`Engine::drain_events`, or the view).
//!
//! [`Engine::apply`]: crate::Engine::apply

use serde::Serialize;
use swarm_data::{AchievementId, UnitId, UpgradeId};

use crate::command::CommandEvent;

/// Something that happened.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    /// A command ran (TS `'command'`): the statistics/achievements payload.
    Command(CommandEvent),
    /// First purchase of a unit or upgrade (TS `'buyFirst'`).
    BuyFirst {
        /// The unit, if a unit was bought.
        #[serde(skip_serializing_if = "Option::is_none", serialize_with = "ser_unit")]
        unit: Option<UnitId>,
        /// The upgrade, if an upgrade was bought.
        #[serde(
            skip_serializing_if = "Option::is_none",
            serialize_with = "ser_upgrade"
        )]
        upgrade: Option<UpgradeId>,
    },
    /// An achievement was earned (TS `'achieve'`).
    Achieved(#[serde(serialize_with = "ser_achievement")] AchievementId),
    /// A command failed, with the TS error message.
    CommandFailed(String),
    /// The state changed and should be saved (TS `session.save()`).
    SaveRequested,
}

fn ser_unit<S: serde::Serializer>(u: &Option<UnitId>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_u16(u.map_or(0, |u| u.0))
}
fn ser_upgrade<S: serde::Serializer>(u: &Option<UpgradeId>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_u16(u.map_or(0, |u| u.0))
}
fn ser_achievement<S: serde::Serializer>(a: &AchievementId, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_u16(a.0)
}
