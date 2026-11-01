//! The application state: the engine, the current view, what is selected
//! and open, and what each [`Action`], mouse event and `:` command does.
//! Drawing is in [`crate::ui`]; the terminal loop in [`crate::run`].

use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use ratatui::crossterm::event::{KeyEvent, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};
use serde_json::Value;
use swarm_data::{GameData, TabId, UnitId, UpgradeId};
use swarm_engine::view::{Sections, StaticView, UndoView, UnitView, UpgradeView, UNDO_LIMIT_SECS};
use swarm_engine::{
    Amount, Command, CommandError, CommandOutcome, Engine, OfflineReport, State, View, ViewEvent,
    ViewRequest, WelcomeBack,
};
use swarm_num::Num;

use crate::cmdline::{self, Cmd};
use crate::fmt::{self, Fmt};
use crate::keymap::{Action, Keymap};
use crate::store;
use crate::undo_file::{Kind, Snapshot, WINDOW_MS as WINDOW};

/// Ticks per second.
pub const TICK: Duration = Duration::from_millis(100);
/// How often the wall clock is compared with the game clock.
pub const RESYNC_EVERY: Duration = Duration::from_secs(1);
/// Autosave period.
pub const AUTOSAVE_EVERY: Duration = Duration::from_secs(30);
/// How long a status message stays.
const MESSAGE_TTL: Duration = Duration::from_secs(6);
/// Sparkline samples kept (one per [`SAMPLE_EVERY`]).
pub const HISTORY_LEN: usize = 120;
const SAMPLE_EVERY: Duration = Duration::from_millis(500);

/// Options-bag keys (`Command::SetOption`), saved with the game.
pub const OPT_ANIM: &str = "tui.anim";
/// Mouse capture.
pub const OPT_MOUSE: &str = "tui.mouse";
/// `"short"` or `"long"`.
pub const OPT_NUMFORMAT: &str = "tui.numformat";

/// A screen in the tab bar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    /// A game tab, by index.
    Tab(usize),
    /// Achievements.
    Achievements,
    /// Statistics.
    Statistics,
    /// Options.
    Options,
}

/// Which list in a tab screen has the keyboard.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    /// The unit list.
    Units,
    /// The selected unit's upgrades and abilities.
    Upgrades,
}

/// A window over the screen.
#[derive(Clone, Debug, PartialEq)]
pub enum Overlay {
    /// Keys and commands.
    Help,
    /// Offline gains.
    WelcomeBack(WelcomeBack),
    /// The ascension panel.
    Ascend,
    /// "Respec?".
    ConfirmRespec,
    /// A block of text (an export).
    Text {
        /// Title.
        title: String,
        /// Text.
        body: String,
    },
}

/// How many a button buys.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuyAmt {
    /// That many.
    N(u64),
    /// As many as affordable.
    Max,
    /// A quarter of the resources.
    Quarter,
}

/// A clickable or scrollable region, recorded while drawing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hit {
    /// A tab header.
    Screen(Screen),
    /// A unit row.
    Unit(u16),
    /// An upgrade row.
    Upgrade(u16),
    /// A unit buy button.
    BuyUnit(BuyAmt),
    /// An upgrade buy button.
    BuyUpgrade(u16, BuyAmt),
    /// The quantity button: opens `:buy <unit> `.
    Qty,
    /// An options row.
    OptionRow(usize),
    /// Confirm the open overlay.
    Confirm,
    /// Close the open overlay.
    Close,
    /// Respec, from the ascension panel.
    Respec,
    /// The unit list (wheel).
    UnitList,
    /// The upgrade list (wheel).
    UpgradeList,
    /// A scrolling page (wheel).
    Page,
}

/// A status-bar message.
#[derive(Clone, Debug)]
pub struct Message {
    /// Text.
    pub text: String,
    /// Shown as an error.
    pub error: bool,
    at: Instant,
}

/// Rows on the options screen.
pub const OPTION_ROWS: usize = 5;

/// An undo snapshot that came from outside this session (`swarm`, or an
/// earlier `swarm-tui`), used while the engine has no undo of its own.
struct Handoff {
    kind: Kind,
    date_ms: i64,
    state: State,
}

/// The app.
pub struct App {
    /// The game.
    pub engine: Engine,
    /// Names and structure.
    pub sv: StaticView,
    /// The last view.
    pub view: View,
    /// The save file; `None` never writes (tests).
    pub path: Option<PathBuf>,
    /// The current screen.
    pub screen: Screen,
    /// Keyboard focus on tab screens.
    pub focus: Focus,
    /// The selected unit, per tab.
    sel_unit: Vec<Option<u16>>,
    /// The selected upgrade (index into [`App::upgrade_list`]).
    pub sel_upgrade: usize,
    /// First row shown in the unit list.
    pub unit_scroll: usize,
    /// First row shown in the upgrade list.
    pub upgrade_scroll: usize,
    /// Scroll of achievements, statistics, help and text overlays.
    pub page_scroll: usize,
    /// Selected options row.
    pub option_sel: usize,
    /// What is open on top.
    pub overlay: Option<Overlay>,
    /// Keys.
    pub keys: Keymap,
    /// Status message.
    pub message: Option<Message>,
    /// Animation on.
    pub anim: bool,
    /// Mouse capture on.
    pub mouse: bool,
    /// Set when `mouse` changed; the loop applies it.
    pub mouse_changed: bool,
    /// Number format.
    pub fmt: Fmt,
    /// Ticks so far (drives the animation).
    pub frame: u64,
    /// log10 samples of the selected unit's count, for the sparkline.
    pub history: VecDeque<f64>,
    history_unit: Option<u16>,
    last_sample: Instant,
    /// Clickable regions from the last draw.
    pub hits: Vec<(Rect, Hit)>,
    last_mono: Instant,
    last_resync: Instant,
    last_save: Instant,
    /// Resyncs that found a gap (suspends), for tests and the status bar.
    pub resyncs: u32,
    /// The save failed last time.
    pub save_error: Option<String>,
    /// Quit requested.
    pub quit: bool,
    /// Full repaint requested.
    pub redraw: bool,
    handoff: Option<Handoff>,
    /// Last mouse click, for double clicks.
    last_click: Option<(Hit, Instant)>,
}

fn opt_bool(e: &Engine, key: &str, default: bool) -> bool {
    e.state()
        .options
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

impl App {
    /// Wraps a loaded engine. `now` is the monotonic clock.
    pub fn new(mut engine: Engine, path: Option<PathBuf>, now: Instant) -> App {
        let sv = engine.static_view();
        let anim = opt_bool(&engine, OPT_ANIM, true);
        let mouse = opt_bool(&engine, OPT_MOUSE, true);
        let long = engine
            .state()
            .options
            .get(OPT_NUMFORMAT)
            .and_then(Value::as_str)
            == Some("long");
        let view = engine.view(&ViewRequest {
            sections: Sections {
                tabs: true,
                ..Sections::NONE
            },
            ..ViewRequest::default()
        });
        let ntabs = sv.tabs.len();
        let mut app = App {
            engine,
            sv,
            view,
            path,
            screen: Screen::Tab(0),
            focus: Focus::Units,
            sel_unit: vec![None; ntabs],
            sel_upgrade: 0,
            unit_scroll: 0,
            upgrade_scroll: 0,
            page_scroll: 0,
            option_sel: 0,
            overlay: None,
            keys: Keymap::new(),
            message: None,
            anim,
            mouse,
            mouse_changed: false,
            fmt: Fmt { long },
            frame: 0,
            history: VecDeque::new(),
            history_unit: None,
            last_sample: now,
            hits: Vec::new(),
            last_mono: now,
            last_resync: now,
            last_save: now,
            resyncs: 0,
            save_error: None,
            quit: false,
            redraw: false,
            handoff: None,
            last_click: None,
        };
        app.refresh();
        if let Some(wb) = app.view.welcome_back.clone() {
            app.overlay = Some(Overlay::WelcomeBack(wb));
        }
        app
    }

    fn data(&self) -> &'static GameData {
        self.engine.data()
    }

    // ------------------------------------------------------------ clock

    /// One loop tick: advance by the monotonic time since the last tick,
    /// resync with the wall clock once a second (after a suspend the
    /// monotonic clock has stopped), autosave, refresh the view.
    pub fn tick(&mut self, mono: Instant, wall_ms: i64) {
        let dt = mono.saturating_duration_since(self.last_mono);
        self.last_mono = mono;
        self.engine.advance(dt);
        if mono.saturating_duration_since(self.last_resync) >= RESYNC_EVERY {
            self.last_resync = mono;
            if let Some(r) = self.engine.resync_wall(wall_ms) {
                self.resumed(r);
            }
        }
        self.frame = self.frame.wrapping_add(1);
        if let Some(a) = self.keys.tick(mono) {
            self.act(a, mono);
        }
        if let Some(m) = &self.message {
            if mono.saturating_duration_since(m.at) > MESSAGE_TTL {
                self.message = None;
            }
        }
        if mono.saturating_duration_since(self.last_save) >= AUTOSAVE_EVERY {
            self.last_save = mono;
            self.save(false);
        }
        self.refresh();
        if mono.saturating_duration_since(self.last_sample) >= SAMPLE_EVERY {
            self.last_sample = mono;
            self.sample();
        }
    }

    fn resumed(&mut self, r: OfflineReport) {
        self.resyncs += 1;
        let away = fmt::duration(r.away_ms() as f64 / 1000.0);
        // the engine sets the welcome back after a long enough suspend
        if let Some(wb) = self.engine.welcome_back().cloned() {
            if self.overlay.is_none() {
                self.overlay = Some(Overlay::WelcomeBack(wb));
            }
        }
        self.info(format!("Resumed: caught up {away} of game time"));
    }

    fn sample(&mut self) {
        let Some(u) = self.selected_unit() else {
            return;
        };
        if self.history_unit != Some(u) {
            self.history.clear();
            self.history_unit = Some(u);
        }
        let c = self.engine.count(UnitId(u));
        let v = if c.is_positive() { c.log10() } else { 0.0 };
        self.history.push_back(if v.is_finite() { v } else { 0.0 });
        while self.history.len() > HISTORY_LEN {
            self.history.pop_front();
        }
    }

    // ------------------------------------------------------------ view

    /// The screens in the tab bar: visible game tabs, then the meta screens.
    pub fn screens(&self) -> Vec<Screen> {
        let mut out: Vec<Screen> = self
            .view
            .tabs
            .iter()
            .filter(|t| t.visible)
            .map(|t| Screen::Tab(t.id as usize))
            .collect();
        if out.is_empty() {
            out.push(Screen::Tab(0));
        }
        out.extend([Screen::Achievements, Screen::Statistics, Screen::Options]);
        out
    }

    /// The visible units of the current tab, in display order.
    pub fn tab_units(&self) -> &[u16] {
        match self.screen {
            Screen::Tab(t) => self
                .view
                .tabs
                .iter()
                .find(|v| v.id as usize == t)
                .map_or(&[], |v| v.units.as_slice()),
            _ => &[],
        }
    }

    /// The selected unit on the current tab.
    pub fn selected_unit(&self) -> Option<u16> {
        let Screen::Tab(t) = self.screen else {
            return None;
        };
        let units = self.tab_units();
        match self.sel_unit.get(t).copied().flatten() {
            Some(u) if units.contains(&u) => Some(u),
            _ => units.first().copied(),
        }
    }

    fn selected_unit_pos(&self) -> usize {
        let units = self.tab_units();
        self.selected_unit()
            .and_then(|u| units.iter().position(|&x| x == u))
            .unwrap_or(0)
    }

    /// A unit's view, if in the current view.
    pub fn unit_view(&self, id: u16) -> Option<&UnitView> {
        self.view.units.iter().find(|u| u.id == id)
    }

    /// An upgrade's view, if in the current view.
    pub fn upgrade_view(&self, id: u16) -> Option<&UpgradeView> {
        self.view.upgrades.iter().find(|u| u.id == id)
    }

    /// The selected unit's visible upgrades, then its abilities (with its
    /// `showparent`'s).
    pub fn upgrade_list(&self) -> Vec<u16> {
        let Some(u) = self.selected_unit() else {
            return Vec::new();
        };
        let su = &self.sv.units[u as usize];
        let mut ids: Vec<u16> = su.upgrades.clone();
        if let Some(p) = su.showparent {
            ids.extend(self.sv.units[p as usize].upgrades.iter().copied());
        }
        let mut seen = std::collections::BTreeSet::new();
        ids.retain(|g| seen.insert(*g) && self.upgrade_view(*g).is_some_and(|v| v.visible));
        let (mut ups, abil): (Vec<u16>, Vec<u16>) = ids
            .into_iter()
            .partition(|g| !self.sv.upgrades[*g as usize].ability);
        ups.extend(abil);
        ups
    }

    /// The selected upgrade.
    pub fn selected_upgrade(&self) -> Option<u16> {
        let list = self.upgrade_list();
        list.get(self.sel_upgrade.min(list.len().saturating_sub(1)))
            .copied()
    }

    fn request(&self, focus: Option<u16>) -> ViewRequest {
        let data = self.data();
        match self.screen {
            Screen::Tab(t) if t < data.tabs().list.len() => ViewRequest::for_tab(
                data,
                TabId(t as u8),
                focus.map(UnitId).into_iter().collect(),
            ),
            Screen::Tab(_) | Screen::Options => ViewRequest {
                sections: Sections {
                    tabs: true,
                    ascension: true,
                    ..Sections::NONE
                },
                ..ViewRequest::default()
            },
            Screen::Achievements => ViewRequest {
                sections: Sections {
                    tabs: true,
                    ascension: true,
                    achievements: true,
                    ..Sections::NONE
                },
                ..ViewRequest::default()
            },
            Screen::Statistics => ViewRequest {
                sections: Sections {
                    tabs: true,
                    ascension: true,
                    statistics: true,
                    achievements: true,
                    ..Sections::NONE
                },
                ..ViewRequest::default()
            },
        }
    }

    /// Recomputes the view for the current screen (only that tab's units,
    /// the selected one in detail) and handles its events.
    pub fn refresh(&mut self) {
        let focus = self.selected_unit();
        let req = self.request(focus);
        self.view = self.engine.view(&req);
        let mut events = std::mem::take(&mut self.view.events);
        if !self.screens().contains(&self.screen) {
            self.screen = self.screens()[0];
        }
        if let Screen::Tab(_) = self.screen {
            if self.selected_unit() != focus {
                let req = self.request(self.selected_unit());
                self.view = self.engine.view(&req);
                events.append(&mut self.view.events);
            }
        }
        for e in events {
            if let ViewEvent::Achieved(a) = e {
                let label = self
                    .sv
                    .achievements
                    .get(a as usize)
                    .map(|x| x.label.clone().unwrap_or_else(|| x.name.clone()))
                    .unwrap_or_default();
                self.info(format!("Achievement unlocked: {label}"));
            }
        }
        self.sync_handoff_view();
        let n = self.upgrade_list().len();
        if self.sel_upgrade >= n {
            self.sel_upgrade = n.saturating_sub(1);
        }
    }

    // ------------------------------------------------------------ messages

    /// Shows a message.
    pub fn info(&mut self, text: impl Into<String>) {
        self.message = Some(Message {
            text: text.into(),
            error: false,
            at: self.last_mono,
        });
    }

    /// Shows an error.
    pub fn error(&mut self, text: impl Into<String>) {
        self.message = Some(Message {
            text: text.into(),
            error: true,
            at: self.last_mono,
        });
    }

    // ------------------------------------------------------------ saving

    /// Writes the save (heartbeat: `dates.closed` is now). Returns false on
    /// failure, which is also shown.
    pub fn save(&mut self, announce: bool) -> bool {
        let Some(path) = self.path.clone() else {
            return true;
        };
        let now = self.engine.now_ms();
        self.engine.mark_closed(now);
        let text = swarm_save::export_v2(&self.engine, now);
        let res = store::write_save(&path, &text).and_then(|()| self.sync_undo_file());
        match res {
            Ok(()) => {
                self.save_error = None;
                if announce {
                    self.info(format!("Saved to {}", path.display()));
                }
                true
            }
            Err(e) => {
                self.error(format!("save failed: {e}"));
                self.save_error = Some(e);
                false
            }
        }
    }

    // ------------------------------------------------------------ undo file

    /// Adopts an undo snapshot read from `save.undo.txt` (see
    /// [`crate::undo_file`]) so that `z` undoes what `swarm` did. Ignored
    /// once the engine has an undo of its own.
    pub fn set_handoff_undo(&mut self, snap: &Snapshot) -> Result<(), String> {
        let state = swarm_save::decode_any(&snap.save)
            .map_err(|e| format!("undo file: {e}"))?
            .state;
        self.handoff = Some(Handoff {
            kind: snap.kind,
            date_ms: snap.date_ms,
            state,
        });
        self.refresh();
        Ok(())
    }

    /// The undo to show and write: the engine's, else the hand-off's. Drops a
    /// hand-off that the engine's undo replaced or whose window closed.
    fn sync_handoff_view(&mut self) {
        let now = self.engine.now_ms();
        if self.engine.undo_state().is_some() {
            self.handoff = None;
        }
        let expired = |h: &Handoff| h.kind == Kind::Undo && now.saturating_sub(h.date_ms) >= WINDOW;
        if self.handoff.as_ref().is_some_and(expired) {
            self.handoff = None;
        }
        if let Some(h) = &self.handoff {
            let secs_since = (now - h.date_ms) as f64 / 1000.0;
            let undoable = h.kind == Kind::Undo;
            self.view.undo = Some(UndoView {
                undoable,
                secs_since,
                secs_left: if undoable {
                    (UNDO_LIMIT_SECS - secs_since + 0.5).floor().max(0.0) as u32
                } else {
                    0
                },
                is_redo: h.kind == Kind::Redo,
            });
        }
    }

    /// Makes `save.undo.txt` match the undo state: the snapshot while its
    /// window is open (a redo has none), no file otherwise. Called after
    /// each successful command and on each save.
    fn sync_undo_file(&self) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let snap = match (self.engine.undo_state(), &self.handoff) {
            (Some(u), _) => Some((
                if u.is_redo { Kind::Redo } else { Kind::Undo },
                u.date_ms,
                &u.state,
            )),
            (None, Some(h)) => Some((h.kind, h.date_ms, &h.state)),
            (None, None) => None,
        }
        .map(|(kind, date_ms, state)| Snapshot {
            kind,
            date_ms,
            save: swarm_save::encode_v2(state),
        })
        .filter(|s| !s.expired(self.engine.now_ms()));
        let file = store::undo_path(path);
        match snap {
            Some(s) => store::write_atomic(&file, &s.encode()),
            None => store::remove_opt(&file),
        }
    }

    // ------------------------------------------------------------ commands

    fn apply(&mut self, cmd: Command) -> Option<CommandOutcome> {
        match self.engine.apply(cmd) {
            Ok(o) => {
                self.refresh();
                if let Err(e) = self.sync_undo_file() {
                    self.error(format!("undo file: {e}"));
                }
                Some(o)
            }
            Err(e) => {
                let msg = match &e {
                    CommandError::InsufficientResources => "Not enough resources".to_owned(),
                    _ => e.to_string(),
                };
                self.error(msg);
                self.refresh();
                None
            }
        }
    }

    fn set_option(&mut self, key: &str, value: Value) {
        let _ = self.engine.apply(Command::SetOption {
            key: key.to_owned(),
            value,
        });
    }

    /// Turns animation on or off (saved).
    pub fn set_anim(&mut self, on: bool) {
        self.anim = on;
        self.set_option(OPT_ANIM, Value::Bool(on));
        self.info(format!("Animation {}", if on { "on" } else { "off" }));
    }

    /// Turns mouse capture on or off (saved).
    pub fn set_mouse(&mut self, on: bool) {
        self.mouse = on;
        self.mouse_changed = true;
        self.set_option(OPT_MOUSE, Value::Bool(on));
        self.info(if on {
            "Mouse on (hold Shift to select text)"
        } else {
            "Mouse off: terminal text selection works"
        });
    }

    /// Short or long numbers (saved).
    pub fn set_long(&mut self, long: bool) {
        self.fmt.long = long;
        self.set_option(
            OPT_NUMFORMAT,
            Value::String(if long { "long" } else { "short" }.into()),
        );
        self.info(if long {
            "Long numbers"
        } else {
            "Short numbers"
        });
    }

    fn bought_msg(&self, unit: u16, o: &CommandOutcome) -> String {
        match &o.bought {
            Some(b) => format!(
                "+{} {}",
                self.fmt.num(&b.twinnum),
                fmt::unit_label(&self.sv, unit, b.twinnum != Num::ONE)
            ),
            None => "Bought".into(),
        }
    }

    /// Buys units: `amount` is `parse_number` input (`None` for 1).
    pub fn buy_unit(&mut self, unit: u16, amount: Option<String>) {
        let o = self.apply(Command::BuyUnit {
            unit: UnitId(unit).into(),
            amount: Amount::Input(amount.unwrap_or_else(|| "1".into())),
            ui: None,
        });
        if let Some(o) = o {
            let m = self.bought_msg(unit, &o);
            self.info(m);
        }
    }

    /// Buys the max of a unit with `percent` of the resources.
    pub fn buy_unit_max(&mut self, unit: u16, percent: f64) {
        let o = self.apply(Command::BuyMaxUnit {
            unit: UnitId(unit).into(),
            percent,
            ui: None,
        });
        if let Some(o) = o {
            let m = self.bought_msg(unit, &o);
            self.info(m);
        }
    }

    fn levels_msg(&mut self, up: u16, o: Option<CommandOutcome>) {
        if let Some(o) = o {
            let n = o.levels.unwrap_or(Num::ONE);
            let m = format!("{} +{}", fmt::upgrade_label(&self.sv, up), self.fmt.num(&n));
            self.info(m);
        }
    }

    /// Buys upgrade levels.
    pub fn buy_upgrade(&mut self, up: u16, amount: Option<String>) {
        let o = self.apply(Command::BuyUpgrade {
            upgrade: UpgradeId(up).into(),
            amount: Amount::Input(amount.unwrap_or_else(|| "1".into())),
            ui: None,
        });
        self.levels_msg(up, o);
    }

    /// Buys the max of an upgrade.
    pub fn buy_upgrade_max(&mut self, up: u16, percent: f64) {
        let o = self.apply(Command::BuyMaxUpgrade {
            upgrade: UpgradeId(up).into(),
            percent,
            ui: None,
        });
        self.levels_msg(up, o);
    }

    fn buy_amt_unit(&mut self, amt: BuyAmt) {
        let Some(u) = self.selected_unit() else {
            return;
        };
        match amt {
            BuyAmt::N(n) => self.buy_unit(u, Some(n.to_string())),
            BuyAmt::Max => self.buy_unit_max(u, 1.0),
            BuyAmt::Quarter => self.buy_unit_max(u, 0.25),
        }
    }

    fn buy_amt_upgrade(&mut self, up: u16, amt: BuyAmt) {
        match amt {
            BuyAmt::N(n) => self.buy_upgrade(up, Some(n.to_string())),
            BuyAmt::Max => self.buy_upgrade_max(up, 1.0),
            BuyAmt::Quarter => self.buy_upgrade_max(up, 0.25),
        }
    }

    /// Ascends.
    pub fn ascend(&mut self) {
        if self.apply(Command::Ascend).is_some() {
            self.overlay = None;
            self.screen = Screen::Tab(0);
            self.focus = Focus::Units;
            let m = self.engine.count(self.data().well_known().mutagen);
            let msg = format!("Ascended! You have {} mutagen", self.fmt.num(&m));
            self.info(msg);
            self.save(false);
        }
    }

    /// Respecs: free if possible, else paying energy.
    pub fn respec(&mut self) {
        let free = self
            .view
            .ascension
            .as_ref()
            .is_some_and(|a| a.can_respec_free);
        let cmd = if free {
            Command::RespecFree
        } else {
            Command::Respec
        };
        if self.apply(cmd).is_some() {
            self.overlay = None;
            self.info(if free {
                "Respec done (free)"
            } else {
                "Respec done: mutagen refunded"
            });
            self.save(false);
        }
    }

    /// Undo or redo.
    pub fn undo(&mut self) {
        if let Some(h) = self.handoff.take() {
            // the engine has no undo yet: do what `swarm undo` does
            let now = self.engine.now_ms();
            let current = self.engine.exported_state().clone();
            match self.engine.import_state(h.state) {
                Ok(()) => {
                    let (kind, msg) = match h.kind {
                        Kind::Undo => (Kind::Redo, "Undone (z again to redo)"),
                        Kind::Redo => (Kind::Undo, "Redone"),
                    };
                    self.handoff = Some(Handoff {
                        kind,
                        date_ms: now,
                        state: current,
                    });
                    self.info(msg);
                }
                Err(e) => self.error(e.to_string()),
            }
            self.refresh();
            if let Err(e) = self.sync_undo_file() {
                self.error(format!("undo file: {e}"));
            }
            return;
        }
        if self.view.undo.is_some_and(|u| !u.is_redo && !u.undoable) {
            self.error("Too late to undo (30 s)");
            return;
        }
        let redo = self.view.undo.is_some_and(|u| u.is_redo);
        if self.apply(Command::Undo).is_some() {
            self.info(if redo {
                "Redone"
            } else {
                "Undone (z again to redo)"
            });
        }
    }

    fn dismiss_welcome(&mut self) {
        self.overlay = None;
        let _ = self.engine.apply(Command::DismissWelcomeBack);
        self.refresh();
    }

    // ------------------------------------------------------------ names

    /// Resolves a unit typed by name, slug or label (case-insensitive).
    pub fn find_unit(&self, s: &str) -> Option<u16> {
        let s = s.to_lowercase();
        self.sv
            .units
            .iter()
            .position(|u| {
                u.name.to_lowercase() == s
                    || u.slug.as_deref().is_some_and(|x| x.to_lowercase() == s)
                    || u.label.as_deref().is_some_and(|x| x.to_lowercase() == s)
                    || u.plural.as_deref().is_some_and(|x| x.to_lowercase() == s)
            })
            .map(|i| i as u16)
    }

    /// Resolves an upgrade typed by name or label.
    pub fn find_upgrade(&self, s: &str) -> Option<u16> {
        let s = s.to_lowercase();
        self.sv
            .upgrades
            .iter()
            .position(|g| {
                g.name.to_lowercase() == s
                    || g.label.as_deref().is_some_and(|x| x.to_lowercase() == s)
            })
            .map(|i| i as u16)
    }

    /// Names to complete: visible units, upgrades of visible units, tabs.
    fn completions(&self) -> (Vec<String>, Vec<String>, Vec<String>) {
        let data = self.data();
        let visible: Vec<UnitId> = data
            .units()
            .iter()
            .map(|u| u.id)
            .filter(|&u| self.engine.unit_visible(u))
            .collect();
        let units = visible.iter().map(|u| data.unit(*u).name.clone()).collect();
        let upgrades = data
            .upgrades()
            .iter()
            .filter(|g| self.engine.upgrade_visible(g.id))
            .map(|g| g.name.clone())
            .collect();
        let tabs = self
            .screens()
            .iter()
            .filter_map(|s| match s {
                Screen::Tab(t) => Some(self.sv.tabs[*t].name.clone()),
                _ => None,
            })
            .chain(["achievements", "statistics", "options"].map(String::from))
            .collect();
        (units, upgrades, tabs)
    }

    // ------------------------------------------------------------ input

    /// A key press.
    pub fn key(&mut self, k: KeyEvent, now: Instant) {
        for a in self.keys.key(k, now) {
            self.act(a, now);
        }
    }

    fn goto_screen(&mut self, s: Screen) {
        if self.screen != s {
            self.screen = s;
            self.focus = Focus::Units;
            self.unit_scroll = 0;
            self.upgrade_scroll = 0;
            self.page_scroll = 0;
            self.sel_upgrade = 0;
            self.refresh();
        }
    }

    fn cycle_screen(&mut self, by: i64) {
        let screens = self.screens();
        let i = screens.iter().position(|s| *s == self.screen).unwrap_or(0) as i64;
        let n = screens.len() as i64;
        self.goto_screen(screens[(i + by).rem_euclid(n) as usize]);
    }

    fn select_unit(&mut self, u: u16) {
        if let Screen::Tab(t) = self.screen {
            if self.selected_unit() != Some(u) {
                self.sel_unit[t] = Some(u);
                self.sel_upgrade = 0;
                self.upgrade_scroll = 0;
                self.refresh();
            }
        }
    }

    fn move_sel(&mut self, by: i64) {
        match (self.screen, self.focus) {
            (Screen::Tab(_), Focus::Units) => {
                let units = self.tab_units().to_vec();
                if units.is_empty() {
                    return;
                }
                let i = (self.selected_unit_pos() as i64 + by).clamp(0, units.len() as i64 - 1);
                self.select_unit(units[i as usize]);
            }
            (Screen::Tab(_), Focus::Upgrades) => {
                let n = self.upgrade_list().len() as i64;
                if n > 0 {
                    self.sel_upgrade = (self.sel_upgrade as i64 + by).clamp(0, n - 1) as usize;
                }
            }
            (Screen::Options, _) => {
                self.option_sel =
                    (self.option_sel as i64 + by).clamp(0, OPTION_ROWS as i64 - 1) as usize;
            }
            _ => self.page_scroll = (self.page_scroll as i64 + by).max(0) as usize,
        }
    }

    fn overlay_scrolls(&self) -> bool {
        matches!(self.overlay, Some(Overlay::Help | Overlay::Text { .. }))
    }

    /// Runs an action.
    pub fn act(&mut self, a: Action, _now: Instant) {
        // overlays first
        if let Some(ov) = self.overlay.clone() {
            match (&ov, &a) {
                (_, Action::Quit) => {}
                (_, Action::Redraw) => {}
                (_, Action::Submit(_) | Action::Complete) => {}
                (Overlay::WelcomeBack(_), _) => {
                    self.dismiss_welcome();
                    return;
                }
                (Overlay::Ascend, Action::Yes | Action::Open) => {
                    self.ascend();
                    return;
                }
                (Overlay::Ascend, Action::Respec) => {
                    self.overlay = Some(Overlay::ConfirmRespec);
                    return;
                }
                (Overlay::ConfirmRespec, Action::Yes | Action::Open) => {
                    self.respec();
                    return;
                }
                (_, Action::Move(n)) if self.overlay_scrolls() => {
                    self.page_scroll = (self.page_scroll as i64 + n).max(0) as usize;
                    return;
                }
                (_, Action::Page(n)) if self.overlay_scrolls() => {
                    self.page_scroll = (self.page_scroll as i64 + n * 10).max(0) as usize;
                    return;
                }
                (_, Action::Top) if self.overlay_scrolls() => {
                    self.page_scroll = 0;
                    return;
                }
                (Overlay::Help, Action::Help)
                | (_, Action::Back | Action::No | Action::Open | Action::Yes) => {
                    self.overlay = None;
                    self.page_scroll = 0;
                    return;
                }
                (_, Action::ToggleMouse | Action::ToggleAnim | Action::ToggleFormat) => {}
                _ => return,
            }
        }
        match a {
            Action::Quit => self.quit = true,
            Action::Redraw => self.redraw = true,
            Action::NextTab => self.cycle_screen(1),
            Action::PrevTab => self.cycle_screen(-1),
            Action::GotoTab(n) => {
                let screens = self.screens();
                match screens.get(n.wrapping_sub(1)) {
                    Some(s) => self.goto_screen(*s),
                    None => self.error(format!("No tab {n}")),
                }
            }
            Action::Move(n) => self.move_sel(n),
            Action::Page(n) => self.move_sel(n * 10),
            Action::Top => self.move_sel(-1_000_000),
            Action::Bottom => self.move_sel(1_000_000),
            Action::Open => match self.screen {
                Screen::Tab(_) if self.focus == Focus::Units => {
                    if !self.upgrade_list().is_empty() {
                        self.focus = Focus::Upgrades;
                    }
                }
                Screen::Tab(_) => {
                    if let Some(g) = self.selected_upgrade() {
                        self.buy_upgrade(g, None);
                    }
                }
                Screen::Options => self.toggle_option(self.option_sel),
                _ => {}
            },
            Action::Back => match self.screen {
                Screen::Tab(_) if self.focus == Focus::Upgrades => self.focus = Focus::Units,
                _ => {}
            },
            Action::BuyUnit(n) => {
                if let Some(u) = self.selected_unit() {
                    self.buy_unit(u, n);
                }
            }
            Action::BuyUnitMax => self.buy_amt_unit(BuyAmt::Max),
            Action::BuyUpgrade(n) => match self.selected_upgrade() {
                Some(g) => self.buy_upgrade(g, n),
                None => self.error("No upgrade selected"),
            },
            Action::BuyUpgradeMax => match self.selected_upgrade() {
                Some(g) => self.buy_upgrade_max(g, 1.0),
                None => self.error("No upgrade selected"),
            },
            Action::QtyPrompt => {
                if let Some(u) = self.selected_unit() {
                    let name = self.sv.units[u as usize].name.clone();
                    self.keys.open_line(&format!("buy {name} "));
                }
            }
            Action::Ascend => self.overlay = Some(Overlay::Ascend),
            Action::Respec => self.overlay = Some(Overlay::ConfirmRespec),
            Action::Undo => self.undo(),
            Action::Help => {
                self.page_scroll = 0;
                self.overlay = Some(Overlay::Help);
            }
            Action::ToggleMouse => self.set_mouse(!self.mouse),
            Action::ToggleAnim => self.set_anim(!self.anim),
            Action::ToggleFormat => self.set_long(!self.fmt.long),
            Action::Yes | Action::No => {}
            Action::Submit(line) => self.command_line(&line),
            Action::Complete => {
                let (u, g, t) = self.completions();
                let line = cmdline::complete(&self.keys.line, &u, &g, &t);
                self.keys.set_line(line);
            }
        }
    }

    fn toggle_option(&mut self, row: usize) {
        match row {
            0 => self.set_anim(!self.anim),
            1 => self.set_mouse(!self.mouse),
            2 => self.set_long(!self.fmt.long),
            3 => {
                self.save(true);
            }
            4 => self.command_line("export"),
            _ => {}
        }
    }

    /// Runs a `:` command line.
    pub fn command_line(&mut self, line: &str) {
        let cmd = match cmdline::parse(line) {
            Ok(c) => c,
            Err(e) => return self.error(e),
        };
        match cmd {
            Cmd::Buy { unit, amount } => {
                let Some(u) = self.find_unit(&unit) else {
                    return self.error(format!("No such unit: {unit}"));
                };
                match amount.as_deref() {
                    Some("max") => self.buy_unit_max(u, 1.0),
                    _ => self.buy_unit(u, amount),
                }
            }
            Cmd::Upgrade { name, amount } => {
                let Some(g) = self.find_upgrade(&name) else {
                    return self.error(format!("No such upgrade: {name}"));
                };
                match amount.as_deref() {
                    Some("max") => self.buy_upgrade_max(g, 1.0),
                    _ => self.buy_upgrade(g, amount),
                }
            }
            Cmd::Ascend => self.ascend(),
            Cmd::Respec => self.respec(),
            Cmd::Undo => self.undo(),
            Cmd::Export(None) => {
                let text = swarm_save::export_v2(&self.engine, self.engine.now_ms());
                self.page_scroll = 0;
                self.overlay = Some(Overlay::Text {
                    title: "Export (v2 save; press m to turn mouse capture off to select)".into(),
                    body: text,
                });
            }
            Cmd::Export(Some(p)) => {
                let text = swarm_save::export_v2(&self.engine, self.engine.now_ms());
                match store::write_atomic(&p, &format!("{text}\n")) {
                    Ok(()) => self.info(format!("Exported to {}", p.display())),
                    Err(e) => self.error(e),
                }
            }
            Cmd::Import(p) => self.import(&p),
            Cmd::Anim(v) => self.set_anim(v.unwrap_or(!self.anim)),
            Cmd::Mouse(v) => self.set_mouse(v.unwrap_or(!self.mouse)),
            Cmd::Format { long } => self.set_long(long),
            Cmd::Save => {
                self.save(true);
            }
            Cmd::Quit => self.quit = true,
            Cmd::Help => {
                self.page_scroll = 0;
                self.overlay = Some(Overlay::Help);
            }
            Cmd::Tab(name) => {
                let screens = self.screens();
                let n = name.to_lowercase();
                let found = n
                    .parse::<usize>()
                    .ok()
                    .and_then(|i| screens.get(i.wrapping_sub(1)).copied())
                    .or_else(|| {
                        screens.iter().copied().find(|s| match s {
                            Screen::Tab(t) => self.sv.tabs[*t].name.starts_with(&n),
                            Screen::Achievements => "achievements".starts_with(&n),
                            Screen::Statistics => "statistics".starts_with(&n) || n == "stats",
                            Screen::Options => "options".starts_with(&n),
                        })
                    });
                match found {
                    Some(s) => self.goto_screen(s),
                    None => self.error(format!("No tab {name}")),
                }
            }
        }
    }

    fn import(&mut self, p: &std::path::Path) {
        let text = match std::fs::read_to_string(p) {
            Ok(t) => t,
            Err(e) => return self.error(format!("{}: {e}", p.display())),
        };
        let now = self.engine.now_ms();
        let decoded = match swarm_save::decode_any(&text) {
            Ok(d) => d,
            Err(e) => return self.error(format!("{}: {e}", p.display())),
        };
        let at = now.max(decoded.state.dates.reified);
        match Engine::load(self.data(), decoded.state, at, None) {
            Ok(out) => {
                let mouse = self.mouse;
                let path = self.path.take();
                let mono = self.last_mono;
                *self = App::new(out.engine, path, mono);
                if self.mouse != mouse {
                    self.mouse_changed = true;
                }
                self.save(false);
                let warn = decoded.warnings.len() + out.warnings.len();
                self.info(format!(
                    "Imported {}{}",
                    p.display(),
                    if warn > 0 {
                        format!(" ({warn} warnings)")
                    } else {
                        String::new()
                    }
                ));
            }
            Err(e) => self.error(format!("{}: {e}", p.display())),
        }
    }

    // ------------------------------------------------------------ mouse

    fn hit_at(&self, col: u16, row: u16) -> Option<Hit> {
        let p = Position::new(col, row);
        // later regions are drawn on top
        self.hits
            .iter()
            .rev()
            .find(|(r, h)| {
                r.contains(p) && !matches!(h, Hit::UnitList | Hit::UpgradeList | Hit::Page)
            })
            .map(|(_, h)| *h)
    }

    fn scroll_region_at(&self, col: u16, row: u16) -> Option<Hit> {
        let p = Position::new(col, row);
        self.hits
            .iter()
            .rev()
            .find(|(r, h)| {
                r.contains(p) && matches!(h, Hit::UnitList | Hit::UpgradeList | Hit::Page)
            })
            .map(|(_, h)| *h)
    }

    /// A mouse event.
    pub fn mouse_event(&mut self, m: MouseEvent, now: Instant) {
        match m.kind {
            MouseEventKind::ScrollDown | MouseEventKind::ScrollUp => {
                let by = if m.kind == MouseEventKind::ScrollDown {
                    3
                } else {
                    -3
                };
                if self.overlay_scrolls() {
                    self.page_scroll = (self.page_scroll as i64 + by).max(0) as usize;
                    return;
                }
                match self.scroll_region_at(m.column, m.row) {
                    Some(Hit::UnitList) => {
                        self.focus = Focus::Units;
                        self.move_sel(by);
                    }
                    Some(Hit::UpgradeList) => {
                        self.focus = Focus::Upgrades;
                        self.move_sel(by);
                    }
                    Some(Hit::Page) | None if !matches!(self.screen, Screen::Tab(_)) => {
                        self.move_sel(by)
                    }
                    _ => {}
                }
            }
            MouseEventKind::Down(MouseButton::Left) => {
                let Some(hit) = self.hit_at(m.column, m.row) else {
                    if self.overlay.is_some() && !self.overlay_scrolls() {
                        // a click outside a dialog closes it
                        self.act(Action::Back, now);
                    }
                    return;
                };
                let double = self.last_click.is_some_and(|(h, at)| {
                    h == hit && now.duration_since(at) < Duration::from_millis(400)
                });
                self.last_click = Some((hit, now));
                self.click(hit, double, now);
            }
            _ => {}
        }
    }

    fn click(&mut self, hit: Hit, double: bool, now: Instant) {
        match hit {
            Hit::Confirm => self.act(Action::Yes, now),
            Hit::Close => self.act(Action::Back, now),
            Hit::Respec => self.overlay = Some(Overlay::ConfirmRespec),
            _ if self.overlay.is_some() => {}
            Hit::Screen(s) => self.goto_screen(s),
            Hit::Unit(u) => {
                self.select_unit(u);
                self.focus = if double && !self.upgrade_list().is_empty() {
                    Focus::Upgrades
                } else {
                    Focus::Units
                };
            }
            Hit::Upgrade(g) => {
                self.focus = Focus::Upgrades;
                if let Some(i) = self.upgrade_list().iter().position(|&x| x == g) {
                    self.sel_upgrade = i;
                }
            }
            Hit::BuyUnit(amt) => self.buy_amt_unit(amt),
            Hit::BuyUpgrade(g, amt) => {
                if let Some(i) = self.upgrade_list().iter().position(|&x| x == g) {
                    self.sel_upgrade = i;
                }
                self.buy_amt_upgrade(g, amt);
            }
            Hit::Qty => self.act(Action::QtyPrompt, now),
            Hit::OptionRow(i) => {
                self.option_sel = i;
                self.toggle_option(i);
            }
            Hit::UnitList | Hit::UpgradeList | Hit::Page => {}
        }
    }
}
