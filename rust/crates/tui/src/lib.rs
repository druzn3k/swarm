//! `swarm-tui`: Swarm Simulator in the terminal (`rust/PLAN.md` M4).
//!
//! A ratatui + crossterm front end over [`swarm_engine::Engine`]. The loop
//! ([`run`]) ticks at 10 Hz on the monotonic clock ([`std::time::Instant`]),
//! advancing the engine by the measured delta; once a second it compares
//! the wall clock with the game clock ([`Engine::resync_wall`]) so a
//! suspended laptop catches up on resume. Each tick asks the engine only
//! for the visible tab ([`swarm_engine::ViewRequest::for_tab`]). The save
//! is the CLI's (see [`store`]), written every 30 s and on quit, and on
//! SIGTERM/SIGHUP/SIGINT ([`shutdown`]). The session holds the save's lock
//! ([`lock`]) so the `swarm` CLI can't write the same save underneath it,
//! and shares the CLI's undo snapshot ([`undo_file`]).
//!
//! [`Engine::resync_wall`]: swarm_engine::Engine::resync_wall
#![forbid(unsafe_code)]

pub mod app;
pub mod cmdline;
pub mod fmt;
pub mod keymap;
pub mod lock;
pub mod shutdown;
pub mod store;
pub mod ui;
pub mod undo_file;

use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use ratatui::crossterm::event::{self, DisableMouseCapture, EnableMouseCapture, Event};
use ratatui::crossterm::execute;
use swarm_data::GameData;
use swarm_engine::Engine;

pub use app::App;

/// The wall clock, epoch ms. `$SWARM_NOW_MS` pins the start (for
/// reproducible sessions, like the CLI); time then runs on from it.
#[derive(Clone, Copy, Debug)]
pub struct WallClock {
    fixed: Option<(i64, Instant)>,
}

impl WallClock {
    /// From the environment.
    pub fn from_env() -> Result<WallClock, String> {
        let fixed = match std::env::var("SWARM_NOW_MS").ok().filter(|v| !v.is_empty()) {
            Some(v) => Some((
                v.parse::<i64>()
                    .map_err(|_| format!("SWARM_NOW_MS: not an integer: {v}"))?,
                Instant::now(),
            )),
            None => None,
        };
        Ok(WallClock { fixed })
    }

    /// Now, epoch ms.
    pub fn now_ms(&self) -> i64 {
        if let Some((base, at)) = self.fixed {
            return base + at.elapsed().as_millis() as i64;
        }
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
}

/// Command-line options.
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// `--save <path>`.
    pub save: Option<PathBuf>,
    /// `--force`: take over the save lock from a running holder.
    pub force: bool,
    /// `--help`.
    pub help: bool,
}

/// Parses `std::env::args`.
pub fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Options, String> {
    let mut o = Options::default();
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-h" | "--help" => o.help = true,
            "--force" => o.force = true,
            "--save" => o.save = Some(PathBuf::from(it.next().ok_or("--save needs a path")?)),
            s if s.starts_with("--save=") => o.save = Some(PathBuf::from(&s[7..])),
            s => return Err(format!("unknown argument: {s} (see --help)")),
        }
    }
    Ok(o)
}

/// `--help` text.
pub const USAGE: &str = "\
swarm-tui: Swarm Simulator in the terminal

Usage: swarm-tui [--save <path>] [--force]

The save is shared with the `swarm` CLI: --save, else $SWARM_SAVE, else
$XDG_DATA_HOME/swarm/save.txt (default ~/.local/share/swarm/save.txt).
A missing save starts a new game. Press ? in the game for keys and commands.

The session locks the save (save.lock next to it): `swarm` commands that
write the save, and a second swarm-tui, refuse while it runs. --force takes
the lock over from a running holder (a stale lock of a dead process is taken
over without it). SIGTERM, SIGHUP and SIGINT save and quit cleanly.
";

/// Loads the save at `path` (a new game if there is none). Returns the
/// engine and any warnings.
pub fn load(path: &std::path::Path, wall_ms: i64) -> Result<(Engine, Vec<String>), String> {
    let data = GameData::embedded();
    match store::read_opt(path)? {
        None => Ok((Engine::new_game(data, wall_ms), Vec::new())),
        Some(text) => {
            let decoded =
                swarm_save::decode_any(&text).map_err(|e| format!("{}: {e}", path.display()))?;
            // a save whose clock is ahead (after `swarm advance`) resumes at its time
            let now = wall_ms.max(decoded.state.dates.reified);
            let out = Engine::load(data, decoded.state, now, None)
                .map_err(|e| format!("{}: {e}", path.display()))?;
            let mut w = decoded.warnings;
            w.extend(out.warnings);
            Ok((out.engine, w))
        }
    }
}

/// Loads the save at `path` like [`load`], plus the shared undo snapshot
/// (`save.undo.txt`, see [`undo_file`]) if its window is still open, so an
/// undo spans a hand-off from the `swarm` CLI. `mono` is the monotonic
/// clock for [`App::new`].
pub fn open(
    path: &std::path::Path,
    wall_ms: i64,
    mono: Instant,
) -> Result<(App, Vec<String>), String> {
    let (engine, warnings) = load(path, wall_ms)?;
    let snap = store::read_opt(&store::undo_path(path))?
        .and_then(|t| undo_file::Snapshot::parse(&t))
        .filter(|s| !s.expired(engine.now_ms()));
    let mut app = App::new(engine, Some(path.to_owned()), mono);
    if let Some(snap) = snap {
        // an undecodable snapshot is dropped; the next save deletes the file
        let _ = app.set_handoff_undo(&snap);
    }
    Ok((app, warnings))
}

fn set_mouse(on: bool) {
    let mut out = std::io::stdout();
    let _ = if on {
        execute!(out, EnableMouseCapture)
    } else {
        execute!(out, DisableMouseCapture)
    };
    let _ = out.flush();
}

/// Leaves raw mode, the alternate screen and mouse capture before a panic
/// message prints, so it lands on a usable terminal. (The lock is released by
/// unwinding.)
fn install_panic_hook() {
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        set_mouse(false);
        ratatui::restore();
        hook(info);
    }));
}

/// Runs the game until quit or a shutdown signal. Saves on the way out, even
/// after an error.
pub fn run(opts: Options) -> Result<(), String> {
    let path = store::save_path(opts.save.as_deref(), |k| std::env::var(k).ok())?;
    // held until the session ends (also on error and panic)
    let _lock = lock::Lock::acquire(&path, "swarm-tui", opts.force).map_err(|e| e.to_string())?;
    let wall = WallClock::from_env()?;
    let (mut app, warnings) = open(&path, wall.now_ms(), Instant::now())?;
    if let Some(w) = warnings.first() {
        app.error(format!("warning: {w}"));
    }
    if !app.save(false) {
        return Err(app.save_error.clone().unwrap_or_default());
    }
    let shutdown = shutdown::Shutdown::install().map_err(|e| format!("signals: {e}"))?;

    install_panic_hook();
    let mut terminal = ratatui::try_init().map_err(|e| format!("terminal: {e}"))?;
    set_mouse(app.mouse);
    let res = event_loop(&mut terminal, &mut app, wall, &shutdown);
    // the final save: `mark_closed`, the save, the undo snapshot
    app.save(false);
    set_mouse(false);
    ratatui::restore();
    if let Some(e) = &app.save_error {
        eprintln!("swarm-tui: save failed: {e}");
    }
    res
}

/// The loop runs until the player quits or a shutdown is requested.
fn running(app: &App, shutdown: &shutdown::Shutdown) -> bool {
    !app.quit && !shutdown.requested()
}

fn event_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    wall: WallClock,
    shutdown: &shutdown::Shutdown,
) -> Result<(), String> {
    let io = |e: std::io::Error| format!("terminal: {e}");
    let mut next_tick = Instant::now() + app::TICK;
    let mut dirty = true;
    while running(app, shutdown) {
        if dirty {
            if app.redraw {
                app.redraw = false;
                terminal.clear().map_err(io)?;
            }
            terminal.draw(|f| ui::draw(f, app)).map_err(io)?;
            dirty = false;
        }
        let now = Instant::now();
        let timeout = next_tick.saturating_duration_since(now);
        if event::poll(timeout).map_err(io)? {
            let now = Instant::now();
            match event::read().map_err(io)? {
                Event::Key(k) => app.key(k, now),
                Event::Mouse(m) => app.mouse_event(m, now),
                Event::Resize(..) => {}
                _ => {}
            }
            if app.mouse_changed {
                app.mouse_changed = false;
                set_mouse(app.mouse);
            }
            dirty = true;
            continue;
        }
        let now = Instant::now();
        if now >= next_tick {
            app.tick(now, wall.now_ms());
            next_tick += app::TICK;
            // after a stall (suspend, debugger) don't replay missed ticks
            if next_tick < now {
                next_tick = now + app::TICK;
            }
            dirty = true;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_force() {
        let o = parse_args(["--force".into(), "--save=/x".into()]).unwrap();
        assert!(o.force);
        assert_eq!(o.save.as_deref(), Some(std::path::Path::new("/x")));
        assert!(!parse_args([]).unwrap().force);
    }

    #[test]
    fn a_shutdown_request_stops_the_loop_and_the_exit_path_saves() {
        let dir = std::env::temp_dir().join(format!("swarm-tui-shutdown-{}", std::process::id()));
        let path = dir.join("save.txt");
        let (mut app, _) = open(&path, 1_700_000_000_000, Instant::now()).unwrap();
        let shutdown = shutdown::Shutdown::new();
        assert!(running(&app, &shutdown));
        shutdown.request();
        assert!(!running(&app, &shutdown));
        // what `run` does next
        assert!(app.save(false));
        let (e, _) = load(&path, 1_700_000_001_000).unwrap();
        assert!(e.state().dates.closed.is_some());
        app.quit = true;
        assert!(!running(&app, &shutdown::Shutdown::new()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
