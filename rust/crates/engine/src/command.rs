//! Player commands (`engine/src/command.ts`): the one way frontends change
//! the game. [`Engine::apply`] runs, in order: the undo snapshot, the
//! action, statistics, achievements; and queues [`Event`]s.

use core::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use swarm_data::{json_num, UnitId, UpgradeId};
use swarm_num::Num;

use crate::engine::Engine;
use crate::events::Event;
use crate::parse_number::parse_number;
use crate::state::State;
use crate::time::TimeError;
use crate::unit::Bought;

/// A unit, by name at the boundary or by id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UnitRef {
    /// By name.
    Name(String),
    /// By id (not serialisable).
    #[serde(skip)]
    Id(UnitId),
}

/// An upgrade, by name at the boundary or by id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpgradeRef {
    /// By name.
    Name(String),
    /// By id (not serialisable).
    #[serde(skip)]
    Id(UpgradeId),
}

impl From<&str> for UnitRef {
    fn from(s: &str) -> UnitRef {
        UnitRef::Name(s.to_owned())
    }
}
impl From<UnitId> for UnitRef {
    fn from(id: UnitId) -> UnitRef {
        UnitRef::Id(id)
    }
}
impl From<&str> for UpgradeRef {
    fn from(s: &str) -> UpgradeRef {
        UpgradeRef::Name(s.to_owned())
    }
}
impl From<UpgradeId> for UpgradeRef {
    fn from(id: UpgradeId) -> UpgradeRef {
        UpgradeRef::Id(id)
    }
}

/// How many to buy.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Amount {
    /// A number.
    Num(Num),
    /// Player input for [`parse_number`] (`"1.5k"`, `"50%"`, `"=10"`, `"@100"`).
    Input(String),
}

impl From<Num> for Amount {
    fn from(n: Num) -> Amount {
        Amount::Num(n)
    }
}

/// Which upgrades "buy all" buys.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpgradeSet {
    /// What the button buys: [`Engine::available_autobuy_upgrades`].
    Autobuyable,
    /// These, in order.
    Explicit(Vec<UpgradeRef>),
}

/// A player command. See the [module docs](self).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "do")]
pub enum Command {
    /// Buy units (at most what is affordable).
    BuyUnit {
        /// What.
        unit: UnitRef,
        /// How many.
        amount: Amount,
        /// The UI element, kept in the command event.
        #[serde(default)]
        ui: Option<String>,
    },
    /// Buy as many units as `percent` of the resources allow.
    BuyMaxUnit {
        /// What.
        unit: UnitRef,
        /// 0..=1.
        percent: f64,
        /// The UI element.
        #[serde(default)]
        ui: Option<String>,
    },
    /// Buy upgrade levels.
    BuyUpgrade {
        /// What.
        upgrade: UpgradeRef,
        /// How many.
        amount: Amount,
        /// The UI element.
        #[serde(default)]
        ui: Option<String>,
    },
    /// Buy as many levels as `percent` of the resources allow.
    BuyMaxUpgrade {
        /// What.
        upgrade: UpgradeRef,
        /// 0..=1.
        percent: f64,
        /// The UI element.
        #[serde(default)]
        ui: Option<String>,
    },
    /// Buy the max of each upgrade, `percent` over its watch level. An empty
    /// set does nothing (the app skips it: it would invalidate undo).
    BuyAllUpgrades {
        /// 0..=1.
        percent: f64,
        /// Which upgrades.
        which: UpgradeSet,
    },
    /// Ascend.
    Ascend,
    /// Respec, paying energy.
    Respec,
    /// Respec, using a free respec.
    RespecFree,
    /// Restore the state before the last command; again to redo.
    Undo,
    /// Set an upgrade's watch level: -1 hidden, 0 off, `n` notify at `1/n`.
    Watch {
        /// What.
        upgrade: UpgradeRef,
        /// The level.
        level: i32,
    },
    /// Set a key of the UI's options bag.
    SetOption {
        /// Key.
        key: String,
        /// Value.
        value: Value,
    },
    /// A UI event achievements listen for (`achieveclick`, `konami`,
    /// `import`, `changelog`, `debugPage`, `therightquestion`, ...).
    UiEvent {
        /// Event name.
        name: String,
        /// Payload.
        #[serde(default)]
        params: Value,
    },
    /// Clear the welcome-back report.
    DismissWelcomeBack,
    /// Start over (achievements and statistics too).
    Reset,
    /// Test and scenario cheats.
    #[cfg(feature = "parity")]
    Cheat(Cheat),
}

/// Scenario cheats (`engine/oracle/scenario.ts` setup actions), each in a
/// `with_save`.
#[cfg(feature = "parity")]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cheat {
    /// Set a unit's count.
    SetUnitCount {
        /// What.
        unit: UnitRef,
        /// The count.
        val: Num,
    },
    /// Set an upgrade's level.
    SetUpgradeCount {
        /// What.
        upgrade: UpgradeRef,
        /// The level.
        val: Num,
    },
    /// Skip game time.
    SkipMs(f64),
}

/// The payload of a TS `'command'` event, which statistics and
/// achievements read.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CommandEvent {
    /// `buyUnit`, `buyMaxUnit`, `buyUpgrade`, `buyMaxUpgrade`,
    /// `buyAllUpgrades`, `ascension` or `respec`.
    pub name: &'static str,
    /// The unit bought.
    #[serde(skip)]
    pub unit: Option<UnitId>,
    /// Its name.
    pub unitname: Option<String>,
    /// The upgrade bought.
    #[serde(skip)]
    pub upgrade: Option<UpgradeId>,
    /// Its name.
    pub upgradename: Option<String>,
    /// The game clock when it ran, epoch ms (TS `now`).
    pub now_ms: i64,
    /// Milliseconds since the game started.
    pub elapsed_ms: i64,
    /// The amount asked for (`buyUnit`).
    pub attempt: Option<Num>,
    /// Bought.
    pub num: Option<Num>,
    /// Received.
    pub twinnum: Option<Num>,
    /// The percent asked for.
    pub percent: Option<f64>,
    /// The UI element.
    pub ui: Option<String>,
}

/// What a successful command did.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CommandOutcome {
    /// The command events it emitted, in order.
    pub commands: Vec<CommandEvent>,
    /// Units bought (`BuyUnit`, `BuyMaxUnit`).
    pub bought: Option<Bought>,
    /// Levels bought (`BuyUpgrade`, `BuyMaxUpgrade`).
    pub levels: Option<Num>,
    /// The upgrades `BuyAllUpgrades` tried, in order.
    pub upgrades: Vec<UpgradeId>,
}

/// Why a command failed. `Display` gives the TS error message. A failed
/// command keeps the changes it made before failing, like the TS.
#[derive(Clone, Debug, PartialEq)]
pub enum CommandError {
    /// "We require more resources".
    InsufficientResources,
    /// "Cannot buy that unit".
    CannotBuyUnit,
    /// "Cannot buy that upgrade".
    CannotBuyUpgrade,
    /// "We require more resources (ascension cost)".
    AscendCost,
    /// "no undostate available".
    NoUndo,
    /// No unit of that name.
    UnknownUnit(String),
    /// No upgrade of that name.
    UnknownUpgrade(String),
    /// Unparseable number input.
    BadNumber(String),
    /// More levels than [`crate::upgrade::MAX_LEVELS_PER_BUY`] at once.
    TooManyLevels,
    /// The clock went back in time.
    Time(TimeError),
    /// An internal consistency check failed (TS `assert`).
    Assertion(String),
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CommandError::InsufficientResources => f.write_str("We require more resources"),
            CommandError::CannotBuyUnit => f.write_str("Cannot buy that unit"),
            CommandError::CannotBuyUpgrade => f.write_str("Cannot buy that upgrade"),
            CommandError::AscendCost => f.write_str("We require more resources (ascension cost)"),
            CommandError::NoUndo => f.write_str("no undostate available"),
            CommandError::UnknownUnit(n) => write!(f, "no such unit: {n}"),
            CommandError::UnknownUpgrade(n) => write!(f, "no such upgrade: {n}"),
            CommandError::BadNumber(s) => write!(f, "not a number: {s}"),
            CommandError::TooManyLevels => f.write_str("too many levels to buy at once"),
            CommandError::Time(e) => e.fmt(f),
            CommandError::Assertion(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for CommandError {}

impl From<TimeError> for CommandError {
    fn from(e: TimeError) -> CommandError {
        CommandError::Time(e)
    }
}

/// The state before the last command (TS `commands._undo`). Undo restores a
/// clone of the state, not a save string, and rebuilds every cache.
#[derive(Clone, Debug, PartialEq)]
pub struct UndoState {
    /// The state to restore.
    pub state: State,
    /// When it was taken.
    pub date_ms: i64,
    /// Restoring it redoes an undone command.
    pub is_redo: bool,
}

impl Engine {
    /// Runs a command. See the [module docs](self). On failure an
    /// [`Event::CommandFailed`] is queued too.
    pub fn apply(&mut self, cmd: Command) -> Result<CommandOutcome, CommandError> {
        let before = self.rt.events.len();
        let mut outcome = CommandOutcome::default();
        let res = self.apply_inner(cmd, &mut outcome);
        outcome.commands = self.rt.events[before..]
            .iter()
            .filter_map(|e| match e {
                Event::Command(c) => Some(c.clone()),
                _ => None,
            })
            .collect();
        match res {
            Ok(()) => Ok(outcome),
            Err(e) => {
                self.rt.events.push(Event::CommandFailed(e.to_string()));
                Err(e)
            }
        }
    }

    /// The undo state, if any.
    pub fn undo_state(&self) -> Option<&UndoState> {
        self.rt.undo.as_ref()
    }

    /// Resolves a unit reference.
    pub fn resolve_unit(&self, r: &UnitRef) -> Result<UnitId, CommandError> {
        match r {
            UnitRef::Id(id) => Ok(*id),
            UnitRef::Name(n) => self
                .data
                .unit_id(n)
                .ok_or_else(|| CommandError::UnknownUnit(n.clone())),
        }
    }

    /// Resolves an upgrade reference.
    pub fn resolve_upgrade(&self, r: &UpgradeRef) -> Result<UpgradeId, CommandError> {
        match r {
            UpgradeRef::Id(id) => Ok(*id),
            UpgradeRef::Name(n) => self
                .data
                .upgrade_id(n)
                .ok_or_else(|| CommandError::UnknownUpgrade(n.clone())),
        }
    }

    fn resolve_amount(&self, unit: Option<UnitId>, a: &Amount) -> Result<Num, CommandError> {
        match a {
            Amount::Num(n) => Ok(*n),
            Amount::Input(s) => {
                let handle = unit.map(|u| self.unit_handle(u));
                parse_number(s, handle.as_ref().map(|h| h as _))
                    .ok_or_else(|| CommandError::BadNumber(s.clone()))
            }
        }
    }

    /// TS `_setUndo`: the **last saved** state (`session.exportSave()`),
    /// which is not the current one after a failed command or backfill.
    fn set_undo(&mut self, is_redo: bool) {
        self.rt.undo = Some(UndoState {
            state: self.exported_state().clone(),
            date_ms: self.rt.now_ms,
            is_redo,
        });
    }

    fn command_event(&self, name: &'static str) -> CommandEvent {
        CommandEvent {
            name,
            unit: None,
            unitname: None,
            upgrade: None,
            upgradename: None,
            now_ms: self.rt.now_ms,
            elapsed_ms: self.elapsed_start_ms(),
            attempt: None,
            num: None,
            twinnum: None,
            percent: None,
            ui: None,
        }
    }

    fn unit_event(&self, name: &'static str, unit: UnitId) -> CommandEvent {
        let mut c = self.command_event(name);
        c.unit = Some(unit);
        c.unitname = Some(self.data.unit(unit).name.clone());
        c
    }

    fn upgrade_event(&self, name: &'static str, upgrade: UpgradeId) -> CommandEvent {
        let mut c = self.command_event(name);
        c.upgrade = Some(upgrade);
        c.upgradename = Some(self.data.upgrade(upgrade).name.clone());
        c
    }

    /// TS `Commands._emit`: queue the event, then the listeners in their
    /// order: statistics, then achievements.
    fn emit(&mut self, cmd: CommandEvent) {
        self.rt.events.push(Event::Command(cmd.clone()));
        self.record_statistics(&cmd);
        if cmd.unit.is_some() {
            self.achieve_units(false);
        }
        if cmd.upgrade.is_some() {
            self.achieve_upgrades();
        }
        if cmd.name == "ascension" {
            self.achieve_units(true);
        }
    }

    fn apply_inner(&mut self, cmd: Command, out: &mut CommandOutcome) -> Result<(), CommandError> {
        match cmd {
            Command::BuyUnit { unit, amount, ui } => {
                let u = self.resolve_unit(&unit)?;
                let num = self.resolve_amount(Some(u), &amount)?;
                self.set_undo(false);
                let bought = self.buy_unit(u, num)?;
                let mut c = self.unit_event("buyUnit", u);
                c.attempt = Some(num);
                c.num = Some(bought.num);
                c.twinnum = Some(bought.twinnum);
                c.ui = ui;
                self.emit(c);
                out.bought = Some(bought);
            }
            Command::BuyMaxUnit { unit, percent, ui } => {
                let u = self.resolve_unit(&unit)?;
                self.set_undo(false);
                let bought = self.buy_max_unit(u, json_num(percent))?;
                let mut c = self.unit_event("buyMaxUnit", u);
                c.num = Some(bought.num);
                c.twinnum = Some(bought.twinnum);
                c.percent = Some(percent);
                c.ui = ui;
                self.emit(c);
                out.bought = Some(bought);
            }
            Command::BuyUpgrade {
                upgrade,
                amount,
                ui,
            } => {
                let g = self.resolve_upgrade(&upgrade)?;
                let num = self.resolve_amount(None, &amount)?;
                self.set_undo(false);
                let n = self.buy_upgrade(g, num)?;
                let mut c = self.upgrade_event("buyUpgrade", g);
                c.num = Some(n);
                c.ui = ui;
                self.emit(c);
                out.levels = Some(n);
            }
            Command::BuyMaxUpgrade {
                upgrade,
                percent,
                ui,
            } => {
                let g = self.resolve_upgrade(&upgrade)?;
                self.set_undo(false);
                let n = self.buy_max_upgrade(g, json_num(percent))?;
                let mut c = self.upgrade_event("buyMaxUpgrade", g);
                c.num = Some(n);
                c.percent = Some(percent);
                c.ui = ui;
                self.emit(c);
                out.levels = Some(n);
            }
            Command::BuyAllUpgrades { percent, which } => {
                let list = match which {
                    UpgradeSet::Autobuyable => {
                        self.available_autobuy_upgrades(Some(json_num(percent)))
                    }
                    UpgradeSet::Explicit(refs) => refs
                        .iter()
                        .map(|r| self.resolve_upgrade(r))
                        .collect::<Result<_, _>>()?,
                };
                out.upgrades = list.clone();
                if list.is_empty() {
                    return Ok(());
                }
                self.set_undo(false);
                // earlier purchases are kept if a later one fails
                for &g in &list {
                    let pct = percent / f64::from(self.watched_divisor(g));
                    let n = self.buy_max_upgrade(g, json_num(pct))?;
                    let mut c = self.upgrade_event("buyMaxUpgrade", g);
                    c.num = Some(n);
                    c.percent = Some(percent);
                    c.ui = Some("buyAllUpgrades".to_owned());
                    self.emit(c);
                }
                let mut c = self.command_event("buyAllUpgrades");
                c.percent = Some(percent);
                self.emit(c);
            }
            Command::Ascend => {
                self.set_undo(false);
                self.ascend(false)?;
                let ascension = self.data.well_known().ascension;
                let mut c = self.unit_event("ascension", ascension);
                c.num = Some(Num::ONE);
                c.twinnum = Some(Num::ONE);
                self.emit(c);
            }
            Command::Respec => {
                self.set_undo(false);
                self.respec()?;
                let c = self.command_event("respec");
                self.emit(c);
            }
            Command::RespecFree => {
                self.set_undo(false);
                self.respec_free()?;
                let c = self.command_event("respec");
                self.emit(c);
            }
            Command::Undo => {
                let undo = self.rt.undo.clone().ok_or(CommandError::NoUndo)?;
                self.set_undo(true);
                self.import_state(undo.state)?;
            }
            Command::Watch { upgrade, level } => {
                let g = self.resolve_upgrade(&upgrade)?;
                self.watch(g, level);
            }
            Command::SetOption { key, value } => {
                self.with_unreified_save(|e| {
                    e.state.options.insert(key, value);
                });
            }
            Command::UiEvent { name, params } => self.ui_event(&name, &params),
            Command::DismissWelcomeBack => self.rt.offline = None,
            Command::Reset => self.reset()?,
            #[cfg(feature = "parity")]
            Command::Cheat(cheat) => self.cheat(cheat)?,
        }
        Ok(())
    }

    /// Starts over at the current clock (TS `game.reset()`): a fresh state,
    /// fresh caches, every unit at its `init` count, saved. Undo is kept.
    pub fn reset(&mut self) -> Result<(), CommandError> {
        self.state = State::new(self.rt.clock_ms);
        self.reinit()?;
        self.init_unit_counts();
        self.save();
        Ok(())
    }

    #[cfg(feature = "parity")]
    fn cheat(&mut self, cheat: Cheat) -> Result<(), CommandError> {
        match cheat {
            Cheat::SetUnitCount { unit, val } => {
                let u = self.resolve_unit(&unit)?;
                self.with_save(|e| {
                    e.set_unit_count(u, val);
                    Ok(())
                })
            }
            Cheat::SetUpgradeCount { upgrade, val } => {
                let g = self.resolve_upgrade(&upgrade)?;
                self.with_save(|e| {
                    e.set_upgrade_count(g, val);
                    Ok(())
                })
            }
            Cheat::SkipMs(ms) => self.with_save(|e| {
                e.skip_ms(ms);
                Ok(())
            }),
        }
    }
}
