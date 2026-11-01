//! Renders every screen of a fixture with ratatui's `TestBackend`.

mod common;

use std::time::Instant;

use common::{midgame, render};
use swarm_tui::app::{Overlay, Screen};
use swarm_tui::keymap::Action;
use swarm_tui::ui::{COMMANDS, KEYS};

fn dismissed(t: Instant) -> swarm_tui::App {
    let mut a = midgame(t);
    a.act(Action::Back, t);
    a
}

/// Selects the drone on the meat tab and opens its upgrades.
fn on_drones(t: Instant) -> swarm_tui::App {
    let mut a = dismissed(t);
    a.command_line("tab meat");
    let i = a
        .tab_units()
        .iter()
        .position(|&u| a.sv.units[u as usize].name == "drone")
        .unwrap();
    a.act(Action::Top, t);
    a.act(Action::Move(i as i64), t);
    a.act(Action::Open, t);
    a
}

#[test]
fn welcome_back_on_load() {
    let t = Instant::now();
    let mut a = midgame(t);
    assert!(matches!(a.overlay, Some(Overlay::WelcomeBack(_))));
    let s = render(&mut a, 120, 40);
    assert!(s.contains("Welcome back!"), "{s}");
    assert!(s.contains("While you were away for"), "{s}");
    assert!(s.contains("Overminds"), "{s}");
}

#[test]
fn unit_list_and_detail() {
    let t = Instant::now();
    let mut a = on_drones(t);
    let s = render(&mut a, 120, 40);
    for want in [
        " 1 Meat",
        "Achievements",
        "Options",
        "Overmind IIIs",
        "Drones",
        "Drone─", // the detail pane's title
        "Count 3.77e605",
        "Cost  10 meat, 1 larva",
        "[1] [10] [100] [25%:",
        "[Max:",
        "[Qty…]",
        "Upgrades & abilities",
        "Faster drones",
        "Twin drones",
        "Drones gather more meat.",
        "[Buy 1]",
        "? help",
        "mouse on",
        "anim on",
    ] {
        assert!(s.contains(want), "missing {want:?}:\n{s}");
    }
    // affordable markers
    assert!(s.contains('●') || s.contains('↑'), "{s}");
}

#[test]
fn stacks_panes_when_narrow() {
    let t = Instant::now();
    let mut a = on_drones(t);
    let wide = render(&mut a, 120, 40);
    let row_of = |s: &str, pat: &str| s.lines().position(|l| l.contains(pat)).unwrap();
    assert_eq!(row_of(&wide, "┌Meat"), row_of(&wide, "┌Drone"));
    let narrow = render(&mut a, 80, 40);
    assert!(
        row_of(&narrow, "┌Drone") > row_of(&narrow, "┌Meat"),
        "{narrow}"
    );
    assert!(narrow.contains("[Max:"), "{narrow}");
}

#[test]
fn ascension_panel() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.act(Action::Ascend, t);
    let s = render(&mut a, 120, 40);
    for want in [
        "Ascension",
        "Ascensions so far: 9",
        "needed",
        "You can ascend now.",
        "mutagen",
        "[Ascend (y)]",
        "[Respec (r)]",
        "[Cancel (Esc)]",
    ] {
        assert!(s.contains(want), "missing {want:?}:\n{s}");
    }
    a.act(Action::Respec, t);
    let s = render(&mut a, 120, 40);
    assert!(s.contains("Respec?"), "{s}");
    assert!(s.contains("free respec"), "{s}");
}

#[test]
fn achievements_screen() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.command_line("tab achievements");
    assert_eq!(a.screen, Screen::Achievements);
    let s = render(&mut a, 120, 40);
    assert!(
        s.contains("Achievements: 93 earned, 1660 / 2410 points"),
        "{s}"
    );
    assert!(s.contains("✓ "), "{s}");
    assert!(s.contains("Hatch your first drone"), "{s}");
    // scrolls
    a.act(Action::Page(1), t);
    let s2 = render(&mut a, 120, 40);
    assert_ne!(s, s2);
}

#[test]
fn statistics_screen() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.command_line("tab stats");
    assert_eq!(a.screen, Screen::Statistics);
    let s = render(&mut a, 120, 40);
    for want in [
        "Statistics",
        "Played",
        "Ascensions      9",
        "Buy clicks",
        "Unit",
        "received",
    ] {
        assert!(s.contains(want), "missing {want:?}:\n{s}");
    }
}

#[test]
fn options_screen() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.command_line("tab options");
    let s = render(&mut a, 100, 30);
    for want in [
        "Animation        on",
        "Mouse capture    on",
        "Numbers          short",
        "Save now",
        "Export save",
    ] {
        assert!(s.contains(want), "missing {want:?}:\n{s}");
    }
    a.act(Action::Open, t); // toggles animation
    let s = render(&mut a, 100, 30);
    assert!(s.contains("Animation        off"), "{s}");
    assert!(s.contains("anim off"), "{s}");
}

#[test]
fn help_lists_every_key_and_command() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.act(Action::Help, t);
    let s = render(&mut a, 140, 70);
    for (k, _) in KEYS.iter().chain(COMMANDS) {
        assert!(s.contains(k), "missing {k:?}:\n{s}");
    }
}

#[test]
fn tutorial_hint_and_early_game() {
    let t = Instant::now();
    let mut a = common::app("v1", t);
    a.act(Action::Back, t);
    assert!(a.view.tutorial_step > 0);
    let s = render(&mut a, 100, 30);
    assert!(s.contains("Tip:"), "{s}");
    assert!(s.contains("Queens"), "{s}");
    assert!(s.contains("Drones"), "{s}");
}

#[test]
fn command_line_and_messages() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.keys.open_line("buy dro");
    let s = render(&mut a, 100, 30);
    assert!(s.lines().last().unwrap().starts_with(":buy dro"), "{s}");
    a.key(
        ratatui::crossterm::event::KeyEvent::new(
            ratatui::crossterm::event::KeyCode::Esc,
            ratatui::crossterm::event::KeyModifiers::NONE,
        ),
        t,
    );
    a.command_line("frobnicate");
    let s = render(&mut a, 100, 30);
    assert!(s.contains("unknown command: frobnicate"), "{s}");
}

#[test]
fn export_overlay() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.command_line("export");
    let s = render(&mut a, 100, 30);
    assert!(s.contains("Export"), "{s}");
    assert!(s.contains("SW2|"), "{s}");
}

#[test]
fn never_panics_on_small_sizes() {
    let t = Instant::now();
    let sizes = [
        (1, 1),
        (5, 3),
        (23, 7),
        (24, 8),
        (30, 10),
        (40, 12),
        (60, 15),
        (99, 20),
        (100, 20),
        (100, 9),
        (200, 60),
    ];
    let mut a = on_drones(t);
    let setups: Vec<fn(&mut swarm_tui::App)> = vec![
        |_| {},
        |a| a.act(Action::Ascend, Instant::now()),
        |a| a.act(Action::Respec, Instant::now()),
        |a| a.act(Action::Help, Instant::now()),
        |a| a.command_line("export"),
        |a| a.command_line("tab achievements"),
        |a| a.command_line("tab statistics"),
        |a| a.command_line("tab options"),
        |a| a.command_line("tab energy"),
    ];
    for setup in &setups {
        setup(&mut a);
        for (w, h) in sizes {
            let s = render(&mut a, w, h);
            if w < 24 || h < 8 {
                assert!(s.contains("Term") || w * h < 10, "{s}");
            }
        }
        a.overlay = None;
    }
    let mut early = common::app("v1", t);
    for (w, h) in sizes {
        render(&mut early, w, h);
    }
}

#[test]
fn snapshot_options_screen() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.command_line("tab options");
    a.message = None;
    insta::assert_snapshot!(render(&mut a, 80, 16));
}

#[test]
fn live_upgrade_description() {
    let t = Instant::now();
    let mut a = dismissed(t);
    a.command_line("tab larva");
    let larva = a
        .tab_units()
        .iter()
        .position(|&u| a.sv.units[u as usize].name == "larva")
        .unwrap();
    a.act(Action::Top, t);
    a.act(Action::Move(larva as i64), t);
    a.act(Action::Open, t); // focus the upgrades: the hatchery
    let s = render(&mut a, 120, 50);
    // the engine's rendered template, not a copied static string
    assert!(
        s.contains("Each hatchery produces") && s.contains("larvae per second."),
        "{s}"
    );
}
