//! The [`Engine`]: game data, [`State`] and the runtime (clock, caches,
//! undo, events). Its methods are spread over the modules that port each TS
//! class: [`time`](crate::time), [`production`](crate::production),
//! [`unit`](crate::unit), [`upgrade`](crate::upgrade),
//! [`effects`](crate::effects), [`achievement`](crate::achievement),
//! [`statistics`](crate::statistics), [`progression`](crate::progression),
//! [`backfill`](crate::backfill), [`estimate`](crate::estimate),
//! [`command`](crate::command) and [`view`](crate::view).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fmt;

use swarm_data::{GameData, UnitId};

use crate::cache::Cache;
use crate::command::UndoState;
use crate::events::Event;
use crate::state::State;
use crate::time::TimeError;

/// A running game. See the [crate docs](crate).
///
/// Queries take `&self` (caches use interior mutability, like the TS engine's
/// memoised getters); anything that changes the game takes `&mut self`.
#[derive(Debug)]
pub struct Engine {
    pub(crate) data: &'static GameData,
    pub(crate) state: State,
    pub(crate) rt: Runtime,
    pub(crate) cache: RefCell<Cache>,
}

/// Runtime state that is not saved.
#[derive(Clone, Debug)]
pub(crate) struct Runtime {
    /// The game clock (TS `game.now`), epoch ms.
    pub now_ms: i64,
    /// The injected clock (TS `cache.clock()` / `session.clock()`): equals
    /// `now_ms` except after a tick back in time, which moves the clock but
    /// not `now` (`game.ts:249-266`). Drives the periodic cache.
    pub clock_ms: i64,
    /// Milliseconds skipped since the last reify (TS `game.skippedMillis`).
    pub skipped_ms: i64,
    /// Debug speed multiplier (TS `game.gameSpeed`).
    pub game_speed: f64,
    pub undo: Option<UndoState>,
    pub events: Vec<Event>,
    pub offline: Option<OfflineReport>,
    /// TS `cache.firstSpawn`: tutorial flags, cleared on reload. Unit ->
    /// `now` of the first spawn.
    pub first_spawn: BTreeMap<UnitId, i64>,
    /// [`crate::view::View::seq`].
    pub view_seq: u64,
}

/// Time that passed while the game was closed or suspended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OfflineReport {
    /// When the game was last seen running, epoch ms.
    pub closed_ms: i64,
    /// When it resumed, epoch ms.
    pub resumed_ms: i64,
}

impl OfflineReport {
    /// Milliseconds away.
    pub fn away_ms(&self) -> i64 {
        self.resumed_ms - self.closed_ms
    }
}

/// The result of [`Engine::load`].
#[derive(Debug)]
pub struct LoadOutcome {
    /// The loaded game.
    pub engine: Engine,
    /// Time passed since the save was closed, if any.
    pub offline: Option<OfflineReport>,
    /// Problems that were repaired while loading.
    pub warnings: Vec<String>,
}

/// Why a state could not be loaded.
#[derive(Clone, Debug, PartialEq)]
pub enum LoadError {
    /// The clock is before the save's last reify by more than the tolerance.
    Time(TimeError),
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Time(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for LoadError {}

impl Engine {
    /// A new game at `wall_now_ms`, as `createGame()` makes one: a fresh
    /// state, every unit at its `init` count (`game.ts:413-422`), then
    /// backfill.
    pub fn new_game(data: &'static GameData, wall_now_ms: i64) -> Engine {
        let mut e = Engine::from_state_unchecked(data, State::new(wall_now_ms), wall_now_ms);
        e.init_unit_counts();
        e.run_backfill();
        e
    }

    /// Loads a state: anchors the clock at `wall_now_ms` (the save's offline
    /// time is then simply `wall_now - reified`, evaluated in O(1)), runs
    /// backfill, and reports the time away (`wall_now` minus the latest of
    /// the save's dates and `heartbeat_ms`).
    ///
    /// A clock before the save's `reified` is tolerated by up to 120 s like
    /// the TS engine (the game stays at `reified`); further back, the TS
    /// engine refused the save. Here the game also stays at `reified`, with
    /// a warning, so a player whose clock jumped back can still play.
    pub fn load(
        data: &'static GameData,
        mut state: State,
        wall_now_ms: i64,
        heartbeat_ms: Option<i64>,
    ) -> Result<LoadOutcome, LoadError> {
        let mut warnings = Vec::new();
        let closed = state.date_closed().max(heartbeat_ms.unwrap_or(0));
        state.dates.loaded = Some(wall_now_ms);
        let reified = state.dates.reified;
        let mut engine = match Engine::from_state(data, state, wall_now_ms) {
            Ok(e) => e,
            Err((err, state)) => {
                warnings.push(format!("{err}; resuming at the save's time"));
                Engine::from_state_unchecked_at(data, *state, reified, wall_now_ms)
            }
        };
        engine.run_backfill();
        let offline = (wall_now_ms > closed).then_some(OfflineReport {
            closed_ms: closed,
            resumed_ms: wall_now_ms,
        });
        engine.rt.offline = offline;
        Ok(LoadOutcome {
            engine,
            offline,
            warnings,
        })
    }

    /// Wraps a state without backfill, like the TS `new Game(session)` (and
    /// `game.importSave`): the clock ticks to `dates.reified`, then to
    /// `clock_ms`. Fails like the TS if `clock_ms` is more than 120 s before
    /// `reified`.
    pub fn from_state(
        data: &'static GameData,
        state: State,
        clock_ms: i64,
    ) -> Result<Engine, (TimeError, Box<State>)> {
        let reified = state.dates.reified;
        let mut e = Engine::from_state_unchecked_at(data, state, reified, clock_ms);
        match e.tick_to(clock_ms) {
            Ok(()) => Ok(e),
            Err(err) => Err((err, Box::new(e.state))),
        }
    }

    fn from_state_unchecked(data: &'static GameData, state: State, now_ms: i64) -> Engine {
        Engine::from_state_unchecked_at(data, state, now_ms, now_ms)
    }

    fn from_state_unchecked_at(
        data: &'static GameData,
        state: State,
        now_ms: i64,
        clock_ms: i64,
    ) -> Engine {
        Engine {
            data,
            cache: RefCell::new(Cache::new(data, clock_ms)),
            state,
            rt: Runtime {
                now_ms,
                clock_ms,
                skipped_ms: 0,
                game_speed: 1.0,
                undo: None,
                events: Vec::new(),
                offline: None,
                first_spawn: BTreeMap::new(),
                view_seq: 0,
            },
        }
    }

    /// TS `Game._init` after a state change of identity (import, undo,
    /// ascend): fresh caches and tutorial flags, no skipped time, and the
    /// clock re-ticked to `reified` then to the clock.
    pub(crate) fn reinit(&mut self) -> Result<(), TimeError> {
        *self.cache.get_mut() = Cache::new(self.data, self.rt.clock_ms);
        self.rt.first_spawn.clear();
        self.rt.skipped_ms = 0;
        self.rt.now_ms = self.state.dates.reified;
        self.tick_to(self.rt.clock_ms)
    }

    /// Replaces the state, like TS `game.importSave` without backfill: the
    /// runtime caches (sticky visibility included) are rebuilt. Undo is kept.
    pub fn import_state(&mut self, mut state: State) -> Result<(), TimeError> {
        state.dates.loaded = Some(self.rt.clock_ms);
        self.state = state;
        self.reinit()
    }

    /// Every unit at its `init` count (TS `game.reset`).
    pub(crate) fn init_unit_counts(&mut self) {
        for u in self.data.units() {
            self.set_unit_count(u.id, u.init);
        }
    }

    /// The game data.
    pub fn data(&self) -> &'static GameData {
        self.data
    }

    /// The state, for saving.
    pub fn state(&self) -> &State {
        &self.state
    }

    /// Records that the game was closed or hidden (`state.dates.closed`); used
    /// with heartbeats to compute offline time on the next load.
    pub fn mark_closed(&mut self, wall_now_ms: i64) {
        self.state.dates.closed = Some(wall_now_ms);
    }

    /// The pending welcome-back report, until dismissed.
    pub fn offline(&self) -> Option<OfflineReport> {
        self.rt.offline
    }

    /// Takes the queued events.
    pub fn drain_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.rt.events)
    }

    /// The queued events, without taking them.
    pub fn events(&self) -> &[Event] {
        &self.rt.events
    }

    /// TS `cache.firstSpawn`: units that spawned for the first time this
    /// session (and `ascension` after the first ascension), with when.
    pub fn first_spawn(&self) -> &BTreeMap<UnitId, i64> {
        &self.rt.first_spawn
    }

    /// TS `session.save()`: the dates a save writes. The save itself is the
    /// caller's job (read [`Engine::state`]); a [`Event::SaveRequested`] is
    /// queued once per batch.
    pub(crate) fn session_save(&mut self) {
        self.state.dates.saved = Some(self.rt.clock_ms);
        self.state.dates.loaded = None;
        if !matches!(self.rt.events.last(), Some(Event::SaveRequested)) {
            self.rt.events.push(Event::SaveRequested);
        }
    }
}
