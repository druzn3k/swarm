//! Locks and undo across the `swarm` CLI and `swarm-tui`, which share one
//! save directory.

mod common;

use std::path::PathBuf;
use std::time::Instant;

use swarm_cli::{Env, EXIT_IO};
use swarm_tui::keymap::Action;
use swarm_tui::lock::Lock;

const T0: i64 = 1_700_000_000_000;

struct Sandbox {
    dir: PathBuf,
    env: Env,
}

impl Sandbox {
    fn new(name: &str) -> Sandbox {
        let dir = std::env::temp_dir().join(format!("swarm-handoff-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut env = Env::default();
        env.set("XDG_DATA_HOME", dir.to_str().unwrap());
        env.set("SWARM_NOW_MS", T0.to_string());
        Sandbox { dir, env }
    }

    fn save(&self) -> PathBuf {
        self.dir.join("swarm").join("save.txt")
    }

    fn at(&mut self, ms: i64) {
        self.env.set("SWARM_NOW_MS", ms.to_string());
    }

    fn swarm(&self, args: &[&str]) -> swarm_cli::Output {
        swarm_cli::run(
            std::iter::once("swarm").chain(args.iter().copied()),
            &self.env,
        )
    }

    fn drones(&self) -> String {
        let o = self.swarm(&["show", "--json"]);
        let v: serde_json::Value = serde_json::from_str(&o.stdout).unwrap();
        v["tabs"][0]["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["name"] == "drone")
            .unwrap()["count"]
            .as_str()
            .unwrap()
            .to_owned()
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn drones_in(app: &swarm_tui::App) -> String {
    let id = app.sv.units.iter().position(|u| u.name == "drone").unwrap();
    app.engine.count(swarm_data::UnitId(id as u16)).to_string()
}

#[test]
fn cli_undo_is_undone_in_the_tui_and_back() {
    let sb = Sandbox::new("undo");
    assert_eq!(sb.swarm(&["new"]).code, 0);
    assert_eq!(sb.swarm(&["buy", "drone", "2"]).code, 0);
    assert_eq!(sb.drones(), "2");

    // the TUI starts 5 s later and sees the CLI's undo
    let t = Instant::now();
    let (mut app, _) = swarm_tui::open(&sb.save(), T0 + 5_000, t).unwrap();
    let u = app.view.undo.expect("the CLI's undo is offered");
    assert!(u.undoable && !u.is_redo && u.secs_left > 0, "{u:?}");
    assert_eq!(drones_in(&app), "2");
    app.act(Action::Undo, t);
    assert_eq!(drones_in(&app), "0");
    assert!(app.view.undo.is_some_and(|u| u.is_redo));
    assert!(app.save(false));

    // back in the CLI: the TUI's save has the undone state, and `undo` redoes
    assert_eq!(sb.drones(), "0");
    let o = sb.swarm(&["undo"]);
    assert!(o.stdout.starts_with("Redone"), "{o:?}");
    assert_eq!(sb.drones(), "2");
}

#[test]
fn tui_purchases_are_undoable_in_the_cli() {
    let mut sb = Sandbox::new("tui-to-cli");
    sb.swarm(&["new"]);
    let t = Instant::now();
    let (mut app, _) = swarm_tui::open(&sb.save(), T0, t).unwrap();
    app.buy_unit(
        app.sv.units.iter().position(|u| u.name == "drone").unwrap() as u16,
        Some("3".into()),
    );
    assert_eq!(drones_in(&app), "3");
    // written right after the command, before any save
    assert!(swarm_tui::store::undo_path(&sb.save()).exists());
    assert!(app.save(false));
    sb.at(T0 + 1_000);
    assert_eq!(sb.drones(), "3");
    assert!(sb.swarm(&["undo"]).stdout.starts_with("Undone"));
    assert_eq!(sb.drones(), "0");
}

#[test]
fn an_expired_undo_is_ignored_and_deleted_by_both() {
    let mut sb = Sandbox::new("expired");
    sb.swarm(&["new"]);
    sb.swarm(&["buy", "drone", "2"]);
    let undo = swarm_tui::store::undo_path(&sb.save());
    assert!(undo.exists());

    // CLI: 31 s later `undo` finds nothing and the file goes
    sb.at(T0 + 31_000);
    assert_eq!(sb.swarm(&["undo"]).code, 1);
    assert!(!undo.exists());

    // TUI: same, on start and on save
    sb.at(T0);
    sb.swarm(&["buy", "drone", "1"]);
    assert!(undo.exists());
    let (mut app, _) = swarm_tui::open(&sb.save(), T0 + 31_000, Instant::now()).unwrap();
    assert!(app.view.undo.is_none());
    assert!(app.save(false));
    assert!(!undo.exists());
}

#[test]
fn a_fresh_undo_in_the_tui_expires_at_save_time() {
    let sb = Sandbox::new("tui-expiry");
    sb.swarm(&["new"]);
    let t = Instant::now();
    let (mut app, _) = swarm_tui::open(&sb.save(), T0, t).unwrap();
    app.buy_unit(
        app.sv.units.iter().position(|u| u.name == "drone").unwrap() as u16,
        Some("1".into()),
    );
    let undo = swarm_tui::store::undo_path(&sb.save());
    assert!(undo.exists());
    // 31 s of play later the window has closed: saving removes the file
    for i in 1..=310 {
        app.tick(
            t + std::time::Duration::from_millis(100 * i),
            T0 + 100 * i as i64,
        );
    }
    assert!(app.save(false));
    assert!(!undo.exists());
}

#[test]
fn the_cli_refuses_while_the_tui_holds_the_save() {
    let sb = Sandbox::new("lock");
    assert_eq!(sb.swarm(&["new"]).code, 0);
    let lock = Lock::acquire(&sb.save(), "swarm-tui", false).unwrap();
    let o = sb.swarm(&["buy", "drone", "1"]);
    assert_eq!(o.code, EXIT_IO, "{o:?}");
    assert!(
        o.stderr.contains(&format!("pid {}", std::process::id())),
        "{o:?}"
    );
    assert!(o.stderr.contains("swarm-tui"), "{o:?}");
    // nothing was written
    assert_eq!(sb.drones(), "0");
    // --force overrides, and does not remove the TUI's lock when done
    assert_eq!(sb.swarm(&["--force", "buy", "drone", "1"]).code, 0);
    assert_eq!(sb.drones(), "1");
    drop(lock);
    assert_eq!(sb.swarm(&["buy", "drone", "1"]).code, 0);
    assert!(!swarm_tui::store::lock_path(&sb.save()).exists());
}

#[test]
fn a_second_tui_is_refused_and_a_stale_lock_is_ignored() {
    let sb = Sandbox::new("two-tuis");
    sb.swarm(&["new"]);
    let first = Lock::acquire(&sb.save(), "swarm-tui", false).unwrap();
    assert!(Lock::acquire(&sb.save(), "swarm-tui", false).is_err());
    assert!(Lock::acquire(&sb.save(), "swarm-tui", true).is_ok());
    drop(first);
    std::fs::write(
        swarm_tui::store::lock_path(&sb.save()),
        "pid 4000000000\nstarted 1\nwho swarm-tui\n",
    )
    .unwrap();
    assert_eq!(sb.swarm(&["buy", "drone", "1"]).code, 0, "stale lock");
}
