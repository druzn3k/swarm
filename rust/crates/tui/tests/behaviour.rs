//! The app's behaviour: keys, the command line, the mouse, the clock,
//! options and saving.

mod common;

use std::time::{Duration, Instant};

use ratatui::crossterm::event::{
    KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
use swarm_data::UnitId;
use swarm_num::Num;
use swarm_tui::app::{BuyAmt, Hit, Overlay, Screen, OPT_ANIM, OPT_MOUSE, OPT_NUMFORMAT};
use swarm_tui::keymap::{Action, TAB_DIGIT_TIMEOUT};
use swarm_tui::App;

fn keys(a: &mut App, s: &str, t: Instant) {
    for c in s.chars() {
        let code = match c {
            '\n' => KeyCode::Enter,
            '\t' => KeyCode::Tab,
            '\x1b' => KeyCode::Esc,
            c => KeyCode::Char(c),
        };
        a.key(KeyEvent::new(code, KeyModifiers::NONE), t);
    }
}

fn unit(a: &App, name: &str) -> u16 {
    a.sv.units.iter().position(|u| u.name == name).unwrap() as u16
}

fn count(a: &App, name: &str) -> Num {
    a.engine.count(UnitId(unit(a, name)))
}

/// The early fixture with the drone selected, welcome back dismissed.
fn early_on_drone(t: Instant) -> App {
    let mut a = common::app("v1", t);
    keys(&mut a, "\x1b", t);
    assert!(a.overlay.is_none());
    let i = a
        .tab_units()
        .iter()
        .position(|&u| u == unit(&a, "drone"))
        .unwrap();
    keys(&mut a, "g", t);
    for _ in 0..i {
        keys(&mut a, "j", t);
    }
    assert_eq!(a.selected_unit(), Some(unit(&a, "drone")));
    a
}

#[test]
fn numeric_prefix_buys_and_undo_reverts() {
    let t = Instant::now();
    let mut a = early_on_drone(t);
    let before = count(&a, "drone");
    keys(&mut a, "100b", t);
    assert_eq!(count(&a, "drone"), before + Num::from_f64(100.0));
    let msg = a.message.as_ref().unwrap();
    assert!(
        !msg.error && msg.text.contains("+100 Drones"),
        "{}",
        msg.text
    );
    assert!(a.view.undo.is_some_and(|u| u.undoable));
    keys(&mut a, "b", t);
    assert_eq!(count(&a, "drone"), before + Num::from_f64(101.0));
    keys(&mut a, "z", t);
    assert_eq!(count(&a, "drone"), before + Num::from_f64(100.0));
    keys(&mut a, "z", t); // redo
    assert_eq!(count(&a, "drone"), before + Num::from_f64(101.0));
    // B buys the max
    keys(&mut a, "B", t);
    assert!(count(&a, "drone") > before + Num::from_f64(1000.0));
}

#[test]
fn command_line_buys_with_parse_number() {
    let t = Instant::now();
    let mut a = early_on_drone(t);
    let before = count(&a, "drone");
    keys(&mut a, ":buy drone 1.5k\n", t);
    assert_eq!(count(&a, "drone"), before + Num::from_f64(1500.0));
    // completion
    keys(&mut a, ":buy dr\t", t);
    assert_eq!(a.keys.line, "buy drone ");
    keys(&mut a, "@2000\n", t);
    assert_eq!(count(&a, "drone"), Num::from_f64(2000.0));
    // % opens the prompt for the selected unit
    keys(&mut a, "%", t);
    assert_eq!(a.keys.line, "buy drone ");
    keys(&mut a, "10\n", t);
    assert_eq!(count(&a, "drone"), Num::from_f64(2010.0));
    // errors are shown, not fatal
    keys(&mut a, ":buy nosuchbug 1\n", t);
    assert!(a.message.as_ref().unwrap().error);
    keys(&mut a, ":upgrade nosuch\n", t);
    assert!(a.message.as_ref().unwrap().error);
    keys(&mut a, ":buy drone lots\n", t);
    assert!(a.message.as_ref().unwrap().error);
}

#[test]
fn upgrades_with_u_and_command() {
    let t = Instant::now();
    let mut a = common::app("v1", t);
    keys(&mut a, "\x1b", t);
    a.command_line("tab larva");
    let larva = unit(&a, "larva");
    assert_eq!(a.selected_unit(), Some(larva));
    keys(&mut a, "\n", t); // focus the upgrades
    let hatchery =
        a.sv.upgrades
            .iter()
            .position(|g| g.name == "hatchery")
            .unwrap() as u16;
    assert_eq!(a.selected_upgrade(), Some(hatchery));
    let lv = |a: &App| a.upgrade_view(hatchery).unwrap().count;
    keys(&mut a, "2u", t);
    assert_eq!(lv(&a), Num::from_f64(2.0));
    keys(&mut a, "U", t);
    assert!(lv(&a) > Num::from_f64(2.0));
    let l = lv(&a);
    a.command_line("upgrade hatchery 1");
    assert!(a.message.as_ref().unwrap().error, "can't afford another");
    assert_eq!(lv(&a), l);
}

#[test]
fn tabs_by_digit_tab_key_and_alt() {
    let t = Instant::now();
    let mut a = common::midgame(t);
    keys(&mut a, "\x1b", t);
    assert_eq!(a.screen, Screen::Tab(0));
    keys(&mut a, "2", t);
    assert_eq!(a.screen, Screen::Tab(0), "waits for a possible count");
    a.tick(t + TAB_DIGIT_TIMEOUT, common::NOW);
    assert_ne!(a.screen, Screen::Tab(0));
    let second = a.screen;
    assert_eq!(a.screens()[1], second);
    keys(&mut a, "\t", t);
    assert_eq!(a.screen, a.screens()[2]);
    a.key(KeyEvent::new(KeyCode::BackTab, KeyModifiers::SHIFT), t);
    assert_eq!(a.screen, second);
    a.key(KeyEvent::new(KeyCode::Char('6'), KeyModifiers::ALT), t);
    assert_eq!(a.screen, Screen::Achievements);
    keys(&mut a, "1\n", t);
    assert_eq!(a.screen, Screen::Tab(0));
}

#[test]
fn options_persist_in_the_save() {
    let t = Instant::now();
    let mut a = early_on_drone(t);
    assert!(a.anim && a.mouse && !a.fmt.long);
    keys(&mut a, "A", t);
    keys(&mut a, "m", t);
    assert!(a.mouse_changed);
    a.command_line("long");
    assert!(!a.anim && !a.mouse && a.fmt.long);
    let opts = &a.engine.state().options;
    assert_eq!(opts[OPT_ANIM], false);
    assert_eq!(opts[OPT_MOUSE], false);
    assert_eq!(opts[OPT_NUMFORMAT], "long");
    // round trip through a v2 save
    let text = swarm_save::export_v2(&a.engine, a.engine.now_ms());
    let out = swarm_save::load(
        swarm_data::GameData::embedded(),
        &text,
        a.engine.now_ms(),
        None,
    )
    .unwrap();
    let b = App::new(out.engine, None, t);
    assert!(!b.anim && !b.mouse && b.fmt.long);
    a.command_line("anim on");
    a.command_line("mouse on");
    a.command_line("short");
    assert!(a.anim && a.mouse && !a.fmt.long);
}

#[test]
fn suspend_triggers_a_resync() {
    let t = Instant::now();
    let mut a = common::midgame(t);
    keys(&mut a, "\x1b", t);
    let start = a.engine.now_ms();
    // normal ticks: the wall clock keeps pace with the monotonic one
    for i in 1..=20u64 {
        a.tick(t + Duration::from_millis(100 * i), start + 100 * i as i64);
    }
    assert_eq!(a.resyncs, 0);
    assert_eq!(a.engine.now_ms(), start + 2000);
    // suspend: the wall clock jumps an hour; the monotonic clock only
    // moves on to the next once-a-second check
    let wall = start + 3000 + 3_600_000;
    let before = count(&a, "meat");
    a.tick(t + Duration::from_millis(2100), start + 2100);
    a.tick(t + Duration::from_millis(3000), wall);
    assert_eq!(a.resyncs, 1);
    assert_eq!(a.engine.now_ms(), wall);
    assert!(count(&a, "meat") > before);
    assert!(a.message.as_ref().unwrap().text.contains("Resumed"));
    assert!(matches!(a.overlay, Some(Overlay::WelcomeBack(_))));
    // and only once
    a.tick(t + Duration::from_millis(4000), wall + 1000);
    assert_eq!(a.resyncs, 1);
}

#[test]
fn small_wall_drift_is_not_a_suspend() {
    let t = Instant::now();
    let mut a = common::midgame(t);
    let start = a.engine.now_ms();
    a.tick(t + Duration::from_secs(1), start + 4_000);
    assert_eq!(a.resyncs, 0);
    assert_eq!(a.engine.now_ms(), start + 1000);
}

#[test]
fn mouse_clicks_and_wheel() {
    let t = Instant::now();
    let mut a = early_on_drone(t);
    common::render(&mut a, 120, 40);
    let at = |a: &App, hit: Hit| {
        let (r, _) = a.hits.iter().find(|(_, h)| *h == hit).copied().unwrap();
        MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: r.x,
            row: r.y,
            modifiers: KeyModifiers::NONE,
        }
    };
    // buy buttons
    let before = count(&a, "drone");
    a.mouse_event(at(&a, Hit::BuyUnit(BuyAmt::N(10))), t);
    assert_eq!(count(&a, "drone"), before + Num::from_f64(10.0));
    // a unit row selects it
    let queen = unit(&a, "queen");
    common::render(&mut a, 120, 40);
    a.mouse_event(at(&a, Hit::Unit(queen)), t);
    assert_eq!(a.selected_unit(), Some(queen));
    // the wheel over the unit list moves the selection
    common::render(&mut a, 120, 40);
    let (r, _) = *a.hits.iter().find(|(_, h)| *h == Hit::UnitList).unwrap();
    a.mouse_event(
        MouseEvent {
            kind: MouseEventKind::ScrollDown,
            column: r.x + 1,
            row: r.y + 1,
            modifiers: KeyModifiers::NONE,
        },
        t,
    );
    assert_ne!(a.selected_unit(), Some(queen));
    // tab headers
    common::render(&mut a, 120, 40);
    a.mouse_event(at(&a, Hit::Screen(Screen::Statistics)), t);
    assert_eq!(a.screen, Screen::Statistics);
}

#[test]
fn ascend_from_the_panel() {
    let t = Instant::now();
    let mut a = common::midgame(t);
    keys(&mut a, "\x1b", t);
    let asc = a.view.ascension.as_ref().unwrap().ascensions;
    keys(&mut a, "a", t);
    assert_eq!(a.overlay, Some(Overlay::Ascend));
    keys(&mut a, "y", t);
    assert!(a.overlay.is_none());
    assert_eq!(
        a.view.ascension.as_ref().unwrap().ascensions,
        asc + Num::ONE
    );
}

#[test]
fn respec_asks_first() {
    let t = Instant::now();
    let mut a = common::midgame(t);
    keys(&mut a, "\x1b", t);
    keys(&mut a, "r", t);
    assert_eq!(a.overlay, Some(Overlay::ConfirmRespec));
    keys(&mut a, "n", t);
    assert!(a.overlay.is_none());
    let free = a.view.ascension.as_ref().unwrap().free_respecs;
    keys(&mut a, "ry", t);
    assert_eq!(
        a.view.ascension.as_ref().unwrap().free_respecs,
        free - Num::ONE
    );
}

#[test]
fn welcome_back_is_dismissed_in_the_engine() {
    let t = Instant::now();
    let mut a = common::midgame(t);
    assert!(a.view.welcome_back.is_some());
    a.act(Action::Open, t);
    assert!(a.overlay.is_none());
    assert!(a.view.welcome_back.is_none());
    assert!(a.engine.offline().is_none());
}

#[test]
fn quit_and_help_keys() {
    let t = Instant::now();
    let mut a = early_on_drone(t);
    keys(&mut a, "?", t);
    assert_eq!(a.overlay, Some(Overlay::Help));
    keys(&mut a, "?", t);
    assert!(a.overlay.is_none());
    keys(&mut a, ":help\n", t);
    assert_eq!(a.overlay, Some(Overlay::Help));
    keys(&mut a, "q", t);
    assert!(a.quit);
}

#[test]
fn saves_export_and_import_through_files() {
    let t = Instant::now();
    let dir = std::env::temp_dir().join(format!("swarm-tui-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("save.txt");
    std::fs::write(swarm_tui::store::undo_path(&path), "undo\nstale").unwrap();
    let mut a = early_on_drone(t);
    a.path = Some(path.clone());
    keys(&mut a, "5b", t);
    keys(&mut a, ":save\n", t);
    assert!(a.message.as_ref().unwrap().text.starts_with("Saved to"));
    // the stale snapshot is replaced by this session's own (5b is undoable)
    let snap = std::fs::read_to_string(swarm_tui::store::undo_path(&path)).unwrap();
    assert!(snap.starts_with("undo "), "{snap}");
    assert!(!snap.contains("stale"));
    let (e, warnings) = swarm_tui::load(&path, common::NOW + 1000).unwrap();
    assert!(warnings.is_empty());
    assert_eq!(e.count(UnitId(unit(&a, "drone"))), count(&a, "drone"));
    assert!(e.state().dates.closed.is_some());
    // export to a file, then import it
    let out = dir.join("export.txt");
    a.command_line(&format!("export {}", out.display()));
    assert!(std::fs::read_to_string(&out).unwrap().starts_with("SW2|"));
    keys(&mut a, "100b", t);
    a.command_line(&format!("import {}", out.display()));
    assert!(
        a.message.as_ref().unwrap().text.starts_with("Imported"),
        "{:?}",
        a.message
    );
    assert_eq!(a.path.as_deref(), Some(path.as_path()));
    assert_eq!(count(&a, "drone"), e.count(UnitId(unit(&a, "drone"))));
    // a missing save starts a new game
    let (fresh, _) = swarm_tui::load(&dir.join("none.txt"), common::NOW).unwrap();
    assert!(fresh.count(UnitId(unit(&a, "drone"))).is_zero());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn autosaves_every_30_seconds() {
    let t = Instant::now();
    let dir = std::env::temp_dir().join(format!("swarm-tui-auto-{}", std::process::id()));
    let path = dir.join("save.txt");
    let mut a = common::midgame(t);
    a.path = Some(path.clone());
    let w = a.engine.now_ms();
    a.tick(t + Duration::from_secs(10), w + 10_000);
    assert!(!path.exists());
    a.tick(t + Duration::from_secs(31), w + 31_000);
    assert!(path.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn args() {
    let o = swarm_tui::parse_args(["--save".to_string(), "/x".into()]).unwrap();
    assert_eq!(o.save.as_deref(), Some(std::path::Path::new("/x")));
    assert!(swarm_tui::parse_args(["-h".to_string()]).unwrap().help);
    assert!(swarm_tui::parse_args(["--bogus".to_string()]).is_err());
}
