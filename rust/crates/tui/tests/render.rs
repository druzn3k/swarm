//! Renders every screen of a fixture with ratatui's `TestBackend`.

mod common;

use std::time::Instant;

use common::{midgame, render};
use ratatui::backend::TestBackend;
use ratatui::buffer::Buffer;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::style::Modifier;
use ratatui::Terminal;
use swarm_tui::app::Hit;
use swarm_tui::app::{Overlay, Screen};
use swarm_tui::keymap::Action;
use swarm_tui::ui::{wild_layout, CMDLINE_KEYS, COMMANDS, KEYS};

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
    for (k, _) in KEYS.iter().chain(COMMANDS).chain(CMDLINE_KEYS) {
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

// ---------------------------------------------------------------- wildmenu

fn draw(a: &mut swarm_tui::App, w: u16, h: u16) -> Buffer {
    let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
    term.draw(|f| swarm_tui::ui::draw(f, a)).unwrap();
    term.backend().buffer().clone()
}

fn row(b: &Buffer, y: u16) -> String {
    (0..b.area.width).map(|x| b[(x, y)].symbol()).collect()
}

fn type_keys(a: &mut swarm_tui::App, s: &str, t: Instant) {
    for c in s.chars() {
        let code = match c {
            '\t' => KeyCode::Tab,
            '\x1b' => KeyCode::Esc,
            c => KeyCode::Char(c),
        };
        a.key(KeyEvent::new(code, KeyModifiers::NONE), t);
    }
}

/// The columns of row `y` drawn reversed.
fn reversed(b: &Buffer, y: u16) -> String {
    (0..b.area.width)
        .filter(|&x| b[(x, y)].modifier.contains(Modifier::REVERSED))
        .map(|x| b[(x, y)].symbol())
        .collect()
}

#[test]
fn wildmenu_shows_matches_above_the_command_line() {
    let t = Instant::now();
    let mut a = dismissed(t);
    type_keys(&mut a, ":buy hive\t", t);
    let b = draw(&mut a, 100, 30);
    assert_eq!(row(&b, 29).trim_end(), ":buy hive");
    let menu = row(&b, 28);
    assert!(
        menu.starts_with("hive mind  hive network  hive neuron  hive empress  hive queen  hive "),
        "{menu:?}"
    );
    assert!(menu.trim_end().ends_with("-/6"), "{menu:?}");
    assert_eq!(reversed(&b, 28), "");
    type_keys(&mut a, "\t\t", t);
    let b = draw(&mut a, 100, 30);
    assert_eq!(reversed(&b, 28), "hive network");
    assert!(row(&b, 28).trim_end().ends_with("2/6"));
    assert_eq!(row(&b, 29).trim_end(), ":buy hive network");
    // closed by typing: the line above is the screen again
    type_keys(&mut a, " ", t);
    let b = draw(&mut a, 100, 30);
    assert!(!row(&b, 28).contains("hive mind  hive network"));
    assert!(!a.hits.iter().any(|(_, h)| matches!(h, Hit::Wild(_))));
}

#[test]
fn wildmenu_scrolls_with_markers() {
    let t = Instant::now();
    let mut a = dismissed(t);
    type_keys(&mut a, ":buy \t", t);
    let n = a.keys.wild.as_ref().unwrap().items.len();
    assert!(n > 20);
    let b = draw(&mut a, 60, 20);
    let menu = row(&b, 18);
    assert!(menu.starts_with("overmind IV  overmind III"), "{menu:?}");
    assert!(menu.contains(" >"), "{menu:?}");
    assert!(!menu.starts_with('<'));
    assert!(menu.trim_end().ends_with(&format!("-/{n}")), "{menu:?}");
    // the last match: scrolled to the end, `<` on the left, no `>`
    a.key(KeyEvent::new(KeyCode::BackTab, KeyModifiers::NONE), t);
    let b = draw(&mut a, 60, 20);
    let menu = row(&b, 18);
    assert!(menu.starts_with("< "), "{menu:?}");
    assert!(!menu.contains(" >"), "{menu:?}");
    let last = a.keys.wild.as_ref().unwrap().items[n - 1].clone();
    assert_eq!(reversed(&b, 18), last);
    assert!(menu.trim_end().ends_with(&format!("{n}/{n}")), "{menu:?}");
    // a match in the middle: both markers
    for _ in 0..20 {
        a.key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE), t);
    }
    let sel = a.keys.wild.as_ref().unwrap().sel.unwrap();
    let b = draw(&mut a, 60, 20);
    let menu = row(&b, 18);
    assert!(menu.starts_with("< ") && menu.contains(" >"), "{menu:?}");
    assert_eq!(reversed(&b, 18), a.keys.wild.as_ref().unwrap().items[sel]);
    // the clickable regions match what is drawn
    for (r, h) in &a.hits {
        if let Hit::Wild(i) = h {
            let text: String = (r.x..r.x + r.width).map(|x| b[(x, r.y)].symbol()).collect();
            assert_eq!(text, a.keys.wild.as_ref().unwrap().items[*i]);
        }
    }
}

#[test]
fn wildmenu_on_tiny_terminals() {
    let t = Instant::now();
    let mut a = dismissed(t);
    type_keys(&mut a, ":buy hive\t\t\t", t);
    // 20 columns: too small for the game, the command line still works
    let b = draw(&mut a, 20, 8);
    assert_eq!(row(&b, 7).trim_end(), ":buy hive network");
    let menu = row(&b, 6);
    assert_eq!(menu, "< hive network > 2/6");
    assert_eq!(reversed(&b, 6), "hive network");
    // never panics, whatever the size and selection
    for _ in 0..8 {
        for w in 0..=30 {
            for h in 0..=4 {
                draw(&mut a, w, h);
            }
        }
        draw(&mut a, 300, 3);
        a.key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE), t);
    }
    // one long match wider than the screen is clipped
    a.keys.open_line("");
    type_keys(&mut a, ":up house\t", t);
    for w in 0..=30 {
        draw(&mut a, w, 3);
    }
}

#[test]
fn wildmenu_layout() {
    // everything fits
    assert_eq!(wild_layout(&[3, 3, 3], 2, 13), 0..3);
    // scrolls to keep the selection visible, leaving room for markers
    assert_eq!(wild_layout(&[5, 5, 5, 5], 0, 14), 0..2);
    assert_eq!(wild_layout(&[5, 5, 5, 5], 3, 14), 2..4);
    assert_eq!(wild_layout(&[5, 5, 5, 5], 1, 16), 0..2);
    // a match too wide for the line is shown alone
    assert_eq!(wild_layout(&[50, 3], 0, 10), 0..1);
    assert_eq!(wild_layout(&[], 0, 10), 0..0);
    assert_eq!(wild_layout(&[4, 4], 1, 0), 1..2);
}
