//! Drawing. Every frame is drawn from [`App`] and records the clickable
//! regions in [`App::hits`] for the mouse. Layouts adapt to the terminal:
//! side-by-side panes from [`WIDE`] columns, stacked below; anything under
//! [`MIN_W`]×[`MIN_H`] shows a "too small" notice instead.

use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Gauge, Paragraph, Sparkline, Wrap};
use ratatui::Frame;
use swarm_engine::view::UpgradeEta;
use swarm_num::Num;

use crate::app::{App, BuyAmt, Focus, Hit, Overlay, Screen};
use crate::fmt::{self, clip};
use crate::keymap::Mode;

/// Side-by-side panes from this width.
pub const WIDE: u16 = 100;
/// Smallest usable size.
pub const MIN_W: u16 = 24;
/// Smallest usable height.
pub const MIN_H: u16 = 8;

const ACCENT: Color = Color::Yellow;
const GOOD: Color = Color::Green;
const DIM: Color = Color::DarkGray;
const BAD: Color = Color::Red;

/// Every key, for the help overlay and the README.
pub const KEYS: &[(&str, &str)] = &[
    (
        "1-9, 0",
        "go to tab N (a lone digit waits 0.4 s for a count); Alt-N at once",
    ),
    ("Tab / Shift-Tab", "next / previous tab"),
    ("j k, ↓ ↑", "move in the list (with a count: 5j)"),
    ("g G, Home End", "first / last row"),
    ("PgDn PgUp, ^D ^U", "page down / up"),
    (
        "Enter, l, →",
        "open the unit's upgrades; on an upgrade, buy one",
    ),
    ("Esc, h, ←", "back out; close a window"),
    ("b", "buy 1 of the unit (100b buys 100)"),
    ("B", "buy the max of the unit"),
    ("u", "buy 1 level of the selected upgrade (5u buys 5)"),
    ("U", "buy the max of the selected upgrade"),
    (
        "% or i",
        "type an amount: 1.5k, 25%, =N exactly, @N to have N",
    ),
    ("a", "ascension panel (y ascends, r respecs)"),
    ("r", "respec (asks first)"),
    ("z", "undo the last purchase within 30 s; again to redo"),
    ("f", "short / long numbers"),
    ("A", "animation on / off"),
    (
        "m",
        "mouse capture on / off (off: select text with the mouse)",
    ),
    (":", "command line"),
    ("?", "this help"),
    ("^L", "repaint"),
    ("q, ^C", "save and quit"),
];

/// Every command, for the help overlay and the README.
pub const COMMANDS: &[(&str, &str)] = &[
    (
        "buy <unit> [amount|max]",
        "buy units; amount like 100, 1.5k, 25%, =N, @N",
    ),
    (
        "upgrade <name> [amount|max]",
        "buy upgrade or ability levels",
    ),
    ("ascend", "ascend now"),
    ("respec", "respec (free if you have one)"),
    ("undo", "undo / redo"),
    ("export [file]", "write the save (v2) to a file, or show it"),
    ("import <file>", "load a v1 or v2 save"),
    ("anim on|off", "animation"),
    ("mouse on|off", "mouse capture"),
    ("long | short", "number format"),
    ("tab <name|N>", "go to a tab"),
    ("save", "save now (also every 30 s and on quit)"),
    ("quit", "save and quit"),
    ("help", "this help"),
];

/// The tutorial hint for a step (`TutorialHint.tsx`, worded for keys).
pub fn tutorial_text(step: u32) -> Option<&'static str> {
    Some(match step {
        1 => "Welcome to Swarm Simulator! Grow a massive swarm of giant bugs. Begin by using your meat and larvae to hatch some drones: select Drone and press b.",
        2 => "You lead a small brood of worker drones. Drones gather meat. Use this meat to build more drones and expand your brood.",
        3 => "Once you have plenty of meat, upgrade your hatchery to produce more larvae: go to the Larva tab, select Larva, Enter, then u.",
        11 => "A ↑ marker appears when you have enough meat to upgrade your hatchery.",
        4 => "Your drones long for a queen. You must sacrifice many drones to hatch a queen, but once born, your queen will slowly hatch drones without consuming meat or larvae.",
        5 => "Hatch more queens to grow your swarm. Hatching drones with the \"Twin Drones\" upgrade will allow you to rapidly raise more queens.",
        6 => "Your growth demands more territory. Begin capturing territory by building military units - swarmlings or stingers.",
        7 => "Your warriors have slowly begun securing territory. Continue expanding your military.",
        8 => "Soon you can secure your first expansion. Expansions increase larva production: buy one on the Larva tab.",
        9 => "Expansion is the key to growing your swarm rapidly. Build a large military to expand your territory, and more queens and nests for meat.",
        10 => "Your swarm has grown large enough to ascend - gain even greater power and restart on a new world! Look at the mutagen tab, or press a.",
        100 => "Congratulations on your first ascension! Mutations make your swarm much more powerful. Unspent mutagen produces larvae - don't spend it all right away!",
        _ => return None,
    })
}

// ---------------------------------------------------------------- helpers

fn bold() -> Style {
    Style::default().add_modifier(Modifier::BOLD)
}

fn dim() -> Style {
    Style::default().fg(DIM)
}

/// Draws a row of `[ label ]` buttons from `area`'s top-left, registering
/// each as a hit. Stops at the area's right edge.
fn buttons(f: &mut Frame, hits: &mut Vec<(Rect, Hit)>, area: Rect, items: &[(String, Hit, bool)]) {
    if area.height == 0 {
        return;
    }
    let mut x = area.x;
    let right = area.x + area.width;
    for (label, hit, enabled) in items {
        let text = format!("[{label}]");
        let w = text.chars().count() as u16;
        if x + w > right {
            break;
        }
        let r = Rect::new(x, area.y, w, 1);
        let style = if *enabled {
            Style::default().fg(Color::Black).bg(GOOD)
        } else {
            Style::default().fg(DIM)
        };
        f.render_widget(Paragraph::new(Span::styled(text, style)), r);
        hits.push((r, *hit));
        x += w + 1;
    }
}

fn centered(area: Rect, w: u16, h: u16) -> Rect {
    let w = w.min(area.width);
    let h = h.min(area.height);
    Rect::new(
        area.x + (area.width - w) / 2,
        area.y + (area.height - h) / 2,
        w,
        h,
    )
}

fn pane(title: String, focused: bool) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_style(if focused {
            Style::default().fg(ACCENT)
        } else {
            dim()
        })
        .title(Span::styled(title, bold()))
}

/// The affordable marker: pulses when animation is on.
fn pulse(app: &App) -> Style {
    let s = Style::default().fg(GOOD);
    if app.anim && (app.frame / 5) % 2 == 1 {
        s.add_modifier(Modifier::DIM)
    } else {
        s.add_modifier(Modifier::BOLD)
    }
}

/// A one-row braille "hive": `bugs` dots wandering over `width` cells.
/// Frozen when animation is off.
pub fn hive(width: usize, frame: u64, bugs: usize, anim: bool) -> String {
    const BITS: [[u32; 4]; 2] = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];
    let mut cells = vec![0u32; width];
    if width == 0 {
        return String::new();
    }
    let t = if anim { frame as f64 } else { 0.0 };
    let dots = width * 2;
    for i in 0..bugs.min(dots * 2) {
        let fi = i as f64;
        let speed = 0.15 + (i % 5) as f64 * 0.07;
        let x = ((fi * 7.31 + t * speed + (t * 0.05 + fi).sin() * 3.0).rem_euclid(dots as f64))
            as usize;
        let y = (((t * 0.2 + fi * 1.7).sin() + 1.0) * 1.99) as usize;
        let (cx, sx) = (x / 2 % width, x % 2);
        cells[cx] |= BITS[sx][y.min(3)];
    }
    cells
        .into_iter()
        .map(|b| char::from_u32(0x2800 + b).unwrap_or(' '))
        .collect()
}

// ---------------------------------------------------------------- draw

/// Draws the whole screen.
pub fn draw(f: &mut Frame, app: &mut App) {
    app.hits.clear();
    let area = f.area();
    if area.width < MIN_W || area.height < MIN_H {
        let p = Paragraph::new(format!(
            "Terminal too small ({}x{}); need {MIN_W}x{MIN_H}. q quits.",
            area.width, area.height
        ))
        .wrap(Wrap { trim: true });
        f.render_widget(p, area);
        return;
    }
    let hint = tutorial_text(app.view.tutorial_step);
    let hint_h = match hint {
        Some(h) if area.height >= 16 => {
            let w = area.width.saturating_sub(4).max(1) as usize;
            ((h.chars().count() + 3) / w + 1).min(3) as u16
        }
        _ => 0,
    };
    let [top, res, body, hint_area, status] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(3),
        Constraint::Length(hint_h),
        Constraint::Length(1),
    ])
    .areas(area);
    draw_tabs(f, app, top);
    draw_resources(f, app, res);
    match app.screen {
        Screen::Tab(_) => draw_tab(f, app, body),
        Screen::Achievements => draw_achievements(f, app, body),
        Screen::Statistics => draw_statistics(f, app, body),
        Screen::Options => draw_options(f, app, body),
    }
    if let Some(h) = hint {
        if hint_h > 0 {
            let p = Paragraph::new(Line::from(vec![
                Span::styled(
                    "Tip: ",
                    Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                ),
                Span::raw(h),
            ]))
            .wrap(Wrap { trim: true });
            f.render_widget(p, hint_area);
        }
    }
    draw_status(f, app, status);
    if let Some(ov) = app.overlay.clone() {
        draw_overlay(f, app, body, &ov);
    }
}

fn screen_title(app: &App, s: Screen) -> String {
    match s {
        Screen::Tab(t) => fmt::tab_label(&app.sv, t),
        Screen::Achievements => "Achievements".into(),
        Screen::Statistics => "Stats".into(),
        Screen::Options => "Options".into(),
    }
}

fn draw_tabs(f: &mut Frame, app: &mut App, area: Rect) {
    let screens = app.screens();
    let hive_w: u16 = if area.width >= 90 { 16 } else { 0 };
    let avail = (area.width - hive_w) as usize;
    let entries: Vec<(String, String, Screen)> = screens
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let n = match i {
                0..=8 => format!("{}", i + 1),
                9 => "0".into(),
                _ => String::new(),
            };
            let mut title = screen_title(app, *s);
            let newly = match s {
                Screen::Tab(t) => app
                    .view
                    .tabs
                    .iter()
                    .any(|v| v.id as usize == *t && v.newly_upgradable),
                _ => false,
            };
            if newly {
                title.push('↑');
            }
            (n, title, *s)
        })
        .collect();
    // full titles, else 4-letter ones, else numbers (the current tab keeps its title)
    let width = |max: usize| -> usize {
        entries
            .iter()
            .map(|(n, t, s)| {
                let t = if *s == app.screen {
                    t.chars().count()
                } else {
                    t.chars().count().min(max)
                };
                n.len() + t + 3
            })
            .sum()
    };
    let max_title = [usize::MAX, 4, 0]
        .into_iter()
        .find(|&m| width(m) <= avail)
        .unwrap_or(0);
    let mut x = area.x;
    let right = area.x + area.width - hive_w;
    for (n, title, s) in &entries {
        let title = if *s == app.screen {
            title.clone()
        } else {
            title.chars().take(max_title).collect()
        };
        let text = if title.is_empty() {
            format!(" {n} ")
        } else {
            format!(" {n} {title} ")
        };
        let w = text.chars().count() as u16;
        if x + w > right {
            break;
        }
        let style = if *s == app.screen {
            Style::default()
                .fg(Color::Black)
                .bg(ACCENT)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default()
        };
        let r = Rect::new(x, area.y, w, 1);
        f.render_widget(Paragraph::new(Span::styled(text, style)), r);
        app.hits.push((r, Hit::Screen(*s)));
        x += w;
    }
    if hive_w > 0 {
        let meat = app
            .engine
            .data()
            .unit_id("meat")
            .map(|u| app.engine.count(u))
            .unwrap_or(Num::ZERO);
        let bugs = if meat.is_positive() {
            (meat.log10().max(0.0) as usize / 3 + 2).min(48)
        } else {
            2
        };
        let r = Rect::new(area.x + area.width - hive_w, area.y, hive_w, 1);
        let s = hive(hive_w as usize, app.frame, bugs, app.anim);
        f.render_widget(
            Paragraph::new(Span::styled(s, Style::default().fg(ACCENT))),
            r,
        );
    }
}

fn draw_resources(f: &mut Frame, app: &App, area: Rect) {
    let data = app.engine.data();
    let mut spans = Vec::new();
    for name in ["meat", "larva", "territory", "energy", "mutagen"] {
        let Some(u) = data.unit_id(name) else {
            continue;
        };
        if !app.engine.unit_visible(u) {
            continue;
        }
        let c = app.engine.count(u);
        let v = app.engine.velocity(u);
        spans.push(Span::styled(fmt::unit_label(&app.sv, u.0, true), dim()));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(app.fmt.short(&c), bold()));
        if !v.is_zero() {
            spans.push(Span::styled(format!(" +{}/s", app.fmt.short(&v)), dim()));
        }
        spans.push(Span::raw("  "));
    }
    f.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn draw_status(f: &mut Frame, app: &App, area: Rect) {
    if app.keys.mode == Mode::Command {
        let line = format!(":{}", app.keys.line);
        f.render_widget(Paragraph::new(line), area);
        let cx = area.x + 1 + app.keys.cursor as u16;
        if cx < area.x + area.width {
            f.set_cursor_position((cx, area.y));
        }
        return;
    }
    let mut right: Vec<Span> = Vec::new();
    if let Some(u) = &app.view.undo {
        if u.is_redo {
            right.push(Span::styled("z redo ", Style::default().fg(ACCENT)));
        } else if u.undoable {
            right.push(Span::styled(
                format!("z undo {}s ", u.secs_left),
                Style::default().fg(ACCENT),
            ));
        }
    }
    if app.save_error.is_some() {
        right.push(Span::styled("SAVE FAILED ", Style::default().fg(BAD)));
    }
    if app.path.is_none() {
        right.push(Span::styled("no save ", dim()));
    }
    right.push(Span::styled(
        format!("mouse {} ", if app.mouse { "on" } else { "off" }),
        dim(),
    ));
    right.push(Span::styled(
        format!("anim {} ", if app.anim { "on" } else { "off" }),
        dim(),
    ));
    right.push(Span::styled("? help", dim()));
    let rw: u16 = right.iter().map(|s| s.content.chars().count() as u16).sum();
    let rw = rw.min(area.width);
    let [l, r] = Layout::horizontal([Constraint::Min(0), Constraint::Length(rw)]).areas(area);
    let left = if let Some(p) = app.keys.pending() {
        Line::from(vec![Span::styled(
            format!("count {p}"),
            Style::default().fg(ACCENT),
        )])
    } else if let Some(m) = &app.message {
        Line::from(Span::styled(
            m.text.clone(),
            if m.error {
                Style::default().fg(BAD)
            } else {
                Style::default().fg(GOOD)
            },
        ))
    } else {
        Line::from(Span::styled(
            "b buy  B max  u upgrade  Enter open  : command",
            dim(),
        ))
    };
    f.render_widget(Paragraph::new(left), l);
    f.render_widget(
        Paragraph::new(Line::from(right)).alignment(Alignment::Right),
        r,
    );
}

// ---------------------------------------------------------------- tab screen

fn draw_tab(f: &mut Frame, app: &mut App, area: Rect) {
    let units = app.tab_units().to_vec();
    let (list_area, detail_area) = if area.width >= WIDE {
        let lw = (area.width * 2 / 5).max(36);
        let [a, b] = Layout::horizontal([Constraint::Length(lw), Constraint::Min(0)]).areas(area);
        (a, b)
    } else {
        let want = (units.len() as u16 + 2).min(area.height / 2).max(3);
        let [a, b] = Layout::vertical([Constraint::Length(want), Constraint::Min(0)]).areas(area);
        (a, b)
    };
    draw_unit_list(f, app, list_area, &units);
    draw_detail(f, app, detail_area);
}

fn scroll_to(sel: usize, scroll: &mut usize, rows: usize) {
    if rows == 0 {
        return;
    }
    if sel < *scroll {
        *scroll = sel;
    } else if sel >= *scroll + rows {
        *scroll = sel + 1 - rows;
    }
}

fn draw_unit_list(f: &mut Frame, app: &mut App, area: Rect, units: &[u16]) {
    let title = match app.screen {
        Screen::Tab(t) => fmt::tab_label(&app.sv, t),
        _ => String::new(),
    };
    let block = pane(title, app.focus == Focus::Units);
    let inner = block.inner(area);
    f.render_widget(block, area);
    app.hits.push((inner, Hit::UnitList));
    let rows = inner.height as usize;
    let sel = app.selected_unit();
    let pos = sel
        .and_then(|s| units.iter().position(|&u| u == s))
        .unwrap_or(0);
    let mut scroll = app.unit_scroll.min(units.len().saturating_sub(1));
    scroll_to(pos, &mut scroll, rows);
    app.unit_scroll = scroll;
    let w = inner.width as usize;
    let numw = if w >= 34 { 9 } else { 7 };
    let show_rate = w >= 30;
    let namew = w.saturating_sub(2 + numw + if show_rate { numw + 3 } else { 0 });
    for (i, &u) in units.iter().enumerate().skip(scroll).take(rows) {
        let Some(uv) = app.unit_view(u) else {
            continue;
        };
        let r = Rect::new(inner.x, inner.y + (i - scroll) as u16, inner.width, 1);
        let mut name = fmt::unit_label(&app.sv, u, true);
        if !uv.suffix.is_empty() {
            name = format!("{name} {}", uv.suffix);
        }
        let marker = if uv.newly_upgradable {
            Span::styled(
                "↑ ",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            )
        } else if uv.buyable && uv.cost_met {
            Span::styled("● ", pulse(app))
        } else {
            Span::raw("  ")
        };
        let mut spans = vec![
            marker,
            Span::raw(format!("{:<namew$}", clip(&name, namew))),
            Span::styled(
                format!("{:>numw$}", clip(&app.fmt.short(&uv.count), numw)),
                bold(),
            ),
        ];
        if show_rate {
            let rate = if uv.velocity.is_zero() {
                String::new()
            } else {
                format!("+{}/s", app.fmt.short(&uv.velocity))
            };
            spans.push(Span::styled(
                format!(" {:>w$}", clip(&rate, numw + 2), w = numw + 2),
                dim(),
            ));
        }
        let mut line = Line::from(spans);
        if Some(u) == sel {
            line = line.style(if app.focus == Focus::Units {
                Style::default().bg(Color::Blue)
            } else {
                Style::default().add_modifier(Modifier::REVERSED)
            });
        }
        f.render_widget(Paragraph::new(line), r);
        app.hits.push((r, Hit::Unit(u)));
    }
}

fn draw_detail(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(u) = app.selected_unit() else {
        f.render_widget(pane("Nothing here yet".into(), false), area);
        return;
    };
    let Some(uv) = app.unit_view(u).cloned() else {
        return;
    };
    let mut title = fmt::unit_label(&app.sv, u, false);
    if !uv.suffix.is_empty() {
        title = format!("{title} {}", uv.suffix);
    }
    let block = pane(title, false);
    let inner = block.inner(area);
    f.render_widget(block, area);
    if inner.height == 0 || inner.width < 4 {
        return;
    }
    let fm = app.fmt;
    let sv = &app.sv;
    let mut info: Vec<Line> = Vec::new();
    let desc = fmt::unit_description(sv, u, uv.detail.as_ref());
    let roomy = inner.height >= 18;
    if roomy {
        info.extend(desc.lines().map(|p| {
            Line::from(Span::styled(
                p.to_owned(),
                Style::default().add_modifier(Modifier::ITALIC),
            ))
        }));
    }
    let mut count = vec![
        Span::styled("Count ", dim()),
        Span::styled(fm.num(&uv.count), bold()),
    ];
    if !uv.velocity.is_zero() {
        count.push(Span::styled(
            format!("  +{}/s", fm.num(&uv.velocity)),
            dim(),
        ));
    }
    if let Some(cap) = &uv.cap {
        count.push(Span::styled(format!("  cap {}", fm.num(cap)), dim()));
    }
    info.push(Line::from(count));
    let sstatic = &sv.units[u as usize];
    if !sstatic.unbuyable && !uv.each_cost.is_empty() {
        info.push(Line::from(vec![
            Span::styled("Cost  ", dim()),
            Span::raw(fmt::costs(sv, &fm, &uv.each_cost)),
        ]));
        let twin = if uv.twin_mult != Num::ONE {
            format!(" (×{} each)", fm.num(&uv.twin_mult))
        } else {
            String::new()
        };
        let mut can = vec![
            Span::styled("Can buy ", dim()),
            Span::styled(
                fm.num(&uv.max_cost_met),
                Style::default().fg(if uv.cost_met { GOOD } else { BAD }),
            ),
            Span::raw(twin),
        ];
        if let Some(d) = &uv.detail {
            if !uv.cost_met {
                if let Some(eta) = &d.eta {
                    can.push(Span::styled(
                        format!("  next in {}", fmt::estimate(eta)),
                        dim(),
                    ));
                }
            }
        }
        info.push(Line::from(can));
    }
    if let Some(d) = &uv.detail {
        if !d.total_production.is_empty() {
            let prod = d
                .total_production
                .iter()
                .map(|(p, n)| {
                    format!(
                        "{}/s {}",
                        fm.num(n),
                        fmt::unit_label(sv, *p, true).to_lowercase()
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            info.push(Line::from(vec![
                Span::styled("Makes ", dim()),
                Span::raw(prod),
            ]));
        }
        if roomy && !d.each_production.is_empty() {
            let prod = d
                .each_production
                .iter()
                .map(|(p, n)| {
                    format!(
                        "{}/s {}",
                        fm.num(n),
                        fmt::unit_label(sv, *p, true).to_lowercase()
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            info.push(Line::from(vec![
                Span::styled("Each  ", dim()),
                Span::raw(prod),
            ]));
        }
        if let Some(eta) = &d.cap_eta {
            info.push(Line::from(Span::styled(
                format!("Cap reached in {}", fmt::estimate(eta)),
                dim(),
            )));
        }
        // a live description already reads the effects
        if d.description.is_none() {
            for ev in &d.effects {
                if let Some(l) = fmt::effect_line(sv, &fm, ev) {
                    info.push(Line::from(Span::styled(l, dim())));
                }
            }
        }
    }
    let info_h = wrapped_height(&info, inner.width).min(inner.height.saturating_sub(1).max(1));
    let buy_h = u16::from(uv.buy_button_visible && !sstatic.unbuyable);
    let spark_h = if inner.height >= 16 && app.history.len() > 1 {
        2
    } else {
        0
    };
    let [info_a, buy_a, spark_a, ups_a] = Layout::vertical([
        Constraint::Length(info_h),
        Constraint::Length(buy_h),
        Constraint::Length(spark_h),
        Constraint::Min(0),
    ])
    .areas(inner);
    f.render_widget(Paragraph::new(info).wrap(Wrap { trim: true }), info_a);
    if buy_h > 0 {
        let max = uv.max_cost_met;
        let can = |n: u64| uv.cost_met && max >= Num::from_f64(n as f64);
        let items = vec![
            ("1".to_string(), Hit::BuyUnit(BuyAmt::N(1)), can(1)),
            ("10".to_string(), Hit::BuyUnit(BuyAmt::N(10)), can(10)),
            ("100".to_string(), Hit::BuyUnit(BuyAmt::N(100)), can(100)),
            (
                format!("25%: {}", fm.short(&uv.max_cost_met_quarter)),
                Hit::BuyUnit(BuyAmt::Quarter),
                uv.max_cost_met_quarter.is_positive(),
            ),
            (
                format!("Max: {}", fm.short(&max)),
                Hit::BuyUnit(BuyAmt::Max),
                uv.cost_met,
            ),
            ("Qty…".to_string(), Hit::Qty, true),
        ];
        buttons(f, &mut app.hits, buy_a, &items);
    }
    if spark_h > 0 {
        let hist: Vec<f64> = app.history.iter().copied().collect();
        let lo = hist.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = hist.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let span = (hi - lo).max(1e-9);
        let w = spark_a.width as usize;
        let data: Vec<u64> = hist
            .iter()
            .skip(hist.len().saturating_sub(w))
            .map(|v| (((v - lo) / span) * 100.0) as u64 + 1)
            .collect();
        let s = Sparkline::default()
            .data(&data)
            .max(101)
            .style(Style::default().fg(Color::Cyan));
        f.render_widget(s, spark_a);
    }
    draw_upgrades(f, app, ups_a);
}

/// Rows `lines` take when word-wrapped to `width` (greedy, like
/// `Wrap { trim: true }`).
fn wrapped_height(lines: &[Line], width: u16) -> u16 {
    let width = usize::from(width.max(1));
    let rows: usize = lines
        .iter()
        .map(|l| {
            let text: String = l.spans.iter().map(|s| s.content.as_ref()).collect();
            let (mut rows, mut col) = (1, 0);
            for word in text.split_whitespace() {
                let w = word.chars().count();
                if col > 0 && col + 1 + w > width {
                    rows += 1;
                    col = 0;
                }
                col += if col > 0 { 1 } else { 0 } + w;
                while col > width {
                    rows += 1;
                    col -= width;
                }
            }
            rows
        })
        .sum();
    u16::try_from(rows).unwrap_or(u16::MAX)
}

fn draw_upgrades(f: &mut Frame, app: &mut App, area: Rect) {
    let list = app.upgrade_list();
    if list.is_empty() || area.height < 3 {
        return;
    }
    let focused = app.focus == Focus::Upgrades;
    let block = pane("Upgrades & abilities".into(), focused).borders(Borders::TOP);
    let inner = block.inner(area);
    f.render_widget(block, area);
    let sel = app.sel_upgrade.min(list.len() - 1);
    let detail_h: u16 = if inner.height >= 9 { 5 } else { 0 };
    let rows = (inner.height.saturating_sub(detail_h) as usize).min(list.len());
    let detail_h = inner.height.saturating_sub(rows as u16).min(8);
    let mut scroll = app.upgrade_scroll;
    scroll_to(sel, &mut scroll, rows);
    app.upgrade_scroll = scroll;
    let list_r = Rect::new(inner.x, inner.y, inner.width, rows as u16);
    app.hits.push((list_r, Hit::UpgradeList));
    let w = inner.width as usize;
    let fm = app.fmt;
    for (i, &g) in list.iter().enumerate().skip(scroll).take(rows) {
        let Some(gv) = app.upgrade_view(g).cloned() else {
            continue;
        };
        let sg = &app.sv.upgrades[g as usize];
        let r = Rect::new(inner.x, inner.y + (i - scroll) as u16, inner.width, 1);
        let marker = if gv.newly_upgradable {
            Span::styled(
                "↑ ",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            )
        } else if gv.cost_met {
            Span::styled("● ", pulse(app))
        } else {
            Span::raw("  ")
        };
        let level = match &sg.maxlevel {
            Some(m) => format!("{}/{}", fm.short(&gv.count), fm.short(m)),
            None if sg.ability => String::new(),
            None => format!("lv {}", fm.short(&gv.count)),
        };
        let kind = if sg.ability { "⚡" } else { "" };
        let cost = fmt::costs(&app.sv, &fm, &gv.total_cost);
        let namew = (w / 3).max(10);
        let text = format!(
            "{:<namew$} {:>9} {}",
            clip(&format!("{kind}{}", fmt::upgrade_label(&app.sv, g)), namew),
            clip(&level, 9),
            cost
        );
        let mut line = Line::from(vec![marker, Span::raw(clip(&text, w.saturating_sub(2)))]);
        if i == sel {
            line = line.style(if focused {
                Style::default().bg(Color::Blue)
            } else {
                Style::default().add_modifier(Modifier::REVERSED)
            });
        }
        f.render_widget(Paragraph::new(line), r);
        app.hits.push((r, Hit::Upgrade(g)));
    }
    if detail_h == 0 {
        return;
    }
    let g = list[sel];
    let Some(gv) = app.upgrade_view(g).cloned() else {
        return;
    };
    let da = Rect::new(inner.x, inner.y + rows as u16, inner.width, detail_h);
    let [text_a, btn_a] = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).areas(da);
    let mut lines: Vec<Line> = Vec::new();
    let desc = fmt::upgrade_description(&app.sv, g, gv.detail.as_ref());
    lines.extend(desc.lines().map(|p| {
        Line::from(Span::styled(
            p.to_owned(),
            Style::default().add_modifier(Modifier::ITALIC),
        ))
    }));
    if let Some(d) = &gv.detail {
        // a live description already reads the effects
        if d.description.is_none() {
            for ev in &d.effects {
                if let Some(l) = fmt::effect_line(&app.sv, &fm, ev) {
                    lines.push(Line::from(Span::styled(l, dim())));
                }
            }
        }
        let eta = match &d.eta {
            UpgradeEta::Wait { secs, .. } if !gv.cost_met => {
                Some(format!("Affordable in {}", fmt::estimate(secs)))
            }
            _ => None,
        };
        if let Some(e) = eta {
            lines.push(Line::from(Span::styled(e, dim())));
        }
    }
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), text_a);
    let max = gv.max_cost_met;
    let items = vec![
        (
            "Buy 1".to_string(),
            Hit::BuyUpgrade(g, BuyAmt::N(1)),
            gv.cost_met,
        ),
        (
            format!("Max: {}", fm.short(&max)),
            Hit::BuyUpgrade(g, BuyAmt::Max),
            gv.cost_met,
        ),
        (
            format!("25%: {}", fm.short(&gv.max_cost_met_quarter)),
            Hit::BuyUpgrade(g, BuyAmt::Quarter),
            gv.max_cost_met_quarter.is_positive(),
        ),
    ];
    buttons(f, &mut app.hits, btn_a, &items);
}

// ---------------------------------------------------------------- meta screens

fn draw_scrolled(
    f: &mut Frame,
    app: &mut App,
    area: Rect,
    title: String,
    lines: Vec<Line<'static>>,
) {
    let block = pane(title, true);
    let inner = block.inner(area);
    f.render_widget(block, area);
    app.hits.push((inner, Hit::Page));
    let max = lines.len().saturating_sub(inner.height as usize);
    app.page_scroll = app.page_scroll.min(max);
    let p = Paragraph::new(lines).scroll((app.page_scroll.min(u16::MAX as usize) as u16, 0));
    f.render_widget(p, inner);
}

fn draw_achievements(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(av) = app.view.achievements.clone() else {
        return;
    };
    let title = format!(
        "Achievements: {} earned, {} / {} points ({:.0}%)",
        av.earned,
        av.points,
        app.sv.achievement_points_possible,
        av.percent * 100.0
    );
    let mut order: Vec<usize> = (0..av.list.len()).collect();
    order.sort_by(|&a, &b| {
        av.list[b]
            .progress_order
            .partial_cmp(&av.list[a].progress_order)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut lines = Vec::new();
    for i in order {
        let a = &av.list[i];
        let sa = &app.sv.achievements[i];
        let label = sa.label.clone().unwrap_or_else(|| sa.name.clone());
        if a.earned_at.is_none() && !a.unmasked {
            lines.push(Line::from(Span::styled(
                format!("  ???  ({} pts)", sa.points),
                dim(),
            )));
            continue;
        }
        let mut desc = sa.description.clone().unwrap_or_default();
        if let Some(m) = &a.progress_max {
            desc = desc.replace("$REQUIRED", &app.fmt.num(m));
        }
        let mut spans = if let Some(at) = a.earned_at {
            vec![
                Span::styled("✓ ", Style::default().fg(GOOD)),
                Span::styled(label, bold()),
                Span::styled(
                    format!(
                        " ({} pts, at {})",
                        sa.points,
                        fmt::duration(at as f64 / 1000.0)
                    ),
                    dim(),
                ),
            ]
        } else {
            vec![
                Span::raw("· "),
                Span::raw(label),
                Span::styled(format!(" ({} pts)", sa.points), dim()),
            ]
        };
        if !desc.is_empty() {
            spans.push(Span::raw(format!(" - {desc}")));
        }
        if a.earned_at.is_none() {
            if let (Some(v), Some(m)) = (&a.progress_val, &a.progress_max) {
                spans.push(Span::styled(
                    format!(" [{} / {}]", app.fmt.short(v), app.fmt.short(m)),
                    Style::default().fg(ACCENT),
                ));
            }
        }
        lines.push(Line::from(spans));
    }
    draw_scrolled(f, app, area, title, lines);
}

fn draw_statistics(f: &mut Frame, app: &mut App, area: Rect) {
    let v = &app.view;
    let fm = app.fmt;
    let mut lines: Vec<Line<'static>> = vec![
        Line::from(format!(
            "Played          {}",
            fmt::duration(v.elapsed_ms as f64 / 1000.0)
        )),
        Line::from(format!(
            "Time warped     {}",
            fmt::duration(v.total_skipped_ms as f64 / 1000.0)
        )),
    ];
    if let Some(a) = &v.ascension {
        lines.push(Line::from(format!(
            "Ascensions      {}",
            fm.num(&a.ascensions)
        )));
    }
    if let Some(a) = &v.achievements {
        lines.push(Line::from(format!(
            "Achievements    {} ({} points)",
            a.earned, a.points
        )));
    }
    if let Some(s) = &v.statistics {
        lines.push(Line::from(format!("Buy clicks      {}", s.clicks)));
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!(
                "{:<22} {:>10} {:>10} {:>8}  first bought",
                "Unit", "bought", "received", "clicks"
            ),
            bold(),
        )));
        for it in &s.units {
            let first = it
                .elapsed_first
                .map(|ms| fmt::duration(ms as f64 / 1000.0))
                .unwrap_or_default();
            lines.push(Line::from(format!(
                "{:<22} {:>10} {:>10} {:>8}  {first}",
                clip(&fmt::unit_label(&app.sv, it.id, true), 22),
                fm.short(&it.num),
                fm.short(&it.twinnum),
                it.clicks
            )));
        }
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!(
                "{:<22} {:>10} {:>10} {:>8}  first bought",
                "Upgrade", "levels", "", "clicks"
            ),
            bold(),
        )));
        for it in &s.upgrades {
            let first = it
                .elapsed_first
                .map(|ms| fmt::duration(ms as f64 / 1000.0))
                .unwrap_or_default();
            lines.push(Line::from(format!(
                "{:<22} {:>10} {:>10} {:>8}  {first}",
                clip(&fmt::upgrade_label(&app.sv, it.id), 22),
                fm.short(&it.num),
                "",
                it.clicks
            )));
        }
    }
    draw_scrolled(f, app, area, "Statistics".into(), lines);
}

fn draw_options(f: &mut Frame, app: &mut App, area: Rect) {
    let block = pane("Options (Enter or click toggles)".into(), true);
    let inner = block.inner(area);
    f.render_widget(block, area);
    let onoff = |b: bool| if b { "on" } else { "off" };
    let rows = [
        format!("Animation        {}", onoff(app.anim)),
        format!("Mouse capture    {}", onoff(app.mouse)),
        format!(
            "Numbers          {}",
            if app.fmt.long {
                "long (1.23 million)"
            } else {
                "short (1.23M)"
            }
        ),
        "Save now".to_string(),
        "Export save to screen".to_string(),
    ];
    for (i, text) in rows.iter().enumerate() {
        if i as u16 >= inner.height {
            break;
        }
        let r = Rect::new(inner.x, inner.y + i as u16, inner.width, 1);
        let mut line = Line::from(format!(" {text}"));
        if i == app.option_sel {
            line = line.style(Style::default().bg(Color::Blue));
        }
        f.render_widget(Paragraph::new(line), r);
        app.hits.push((r, Hit::OptionRow(i)));
    }
    let info_y = inner.y + rows.len() as u16 + 1;
    if info_y < inner.y + inner.height {
        let path = app
            .path
            .as_ref()
            .map_or("(none: not saving)".to_string(), |p| {
                p.display().to_string()
            });
        let info = vec![
            Line::from(Span::styled(format!("Save file: {path}"), dim())),
            Line::from(Span::styled(
                "Shared with the `swarm` CLI. Saved every 30 s and on quit.",
                dim(),
            )),
        ];
        let r = Rect::new(
            inner.x + 1,
            info_y,
            inner.width.saturating_sub(1),
            inner.y + inner.height - info_y,
        );
        f.render_widget(Paragraph::new(info).wrap(Wrap { trim: true }), r);
    }
}

// ---------------------------------------------------------------- overlays

fn dialog(f: &mut Frame, area: Rect, w: u16, h: u16, title: &str) -> (Rect, Rect) {
    let r = centered(area, w, h);
    f.render_widget(Clear, r);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(ACCENT))
        .title(Span::styled(title.to_owned(), bold()));
    let inner = block.inner(r);
    f.render_widget(block, r);
    (r, inner)
}

fn draw_overlay(f: &mut Frame, app: &mut App, area: Rect, ov: &Overlay) {
    let full = f.area();
    match ov {
        Overlay::Help => {
            let mut lines: Vec<Line> = vec![Line::from(Span::styled("Keys", bold()))];
            for (k, d) in KEYS {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {k:<18}"), Style::default().fg(ACCENT)),
                    Span::raw(*d),
                ]));
            }
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Commands (type : first; Tab completes)",
                bold(),
            )));
            for (k, d) in COMMANDS {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {k:<28}"), Style::default().fg(ACCENT)),
                    Span::raw(*d),
                ]));
            }
            lines.push(Line::from(""));
            lines.push(Line::from("Mouse: click tabs, units, upgrades and [buttons]; the wheel scrolls; double-click a unit to open it."));
            lines.push(Line::from(
                "● affordable   ↑ upgrade available   ⚡ ability",
            ));
            text_overlay(f, app, full, "Help (Esc closes, j/k scroll)", lines);
        }
        Overlay::Text { title, body } => {
            let w = full.width.saturating_sub(4).max(1) as usize;
            let lines: Vec<Line> = body
                .chars()
                .collect::<Vec<_>>()
                .chunks(w)
                .map(|c| Line::from(c.iter().collect::<String>()))
                .collect();
            text_overlay(f, app, full, title, lines);
        }
        Overlay::WelcomeBack(wb) => {
            let n = wb.gains.len() as u16;
            let (_, inner) = dialog(f, area, 64, n + 6, "Welcome back!");
            let mut lines = vec![Line::from(format!(
                "While you were away for {}, your swarm produced{}",
                fmt::duration(wb.away_ms as f64 / 1000.0),
                if wb.gains.is_empty() {
                    " nothing new."
                } else {
                    ":"
                }
            ))];
            for g in &wb.gains {
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("  +{} ", app.fmt.num(&g.val)),
                        Style::default().fg(GOOD).add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(fmt::unit_label(&app.sv, g.unit, true)),
                ]));
            }
            let [t, b] = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).areas(inner);
            f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), t);
            buttons(
                f,
                &mut app.hits,
                b,
                &[("OK (Enter)".into(), Hit::Close, true)],
            );
        }
        Overlay::Ascend => draw_ascend(f, app, area),
        Overlay::ConfirmRespec => {
            let (_, inner) = dialog(f, area, 60, 8, "Respec?");
            let fm = app.fmt;
            let text = match &app.view.ascension {
                Some(a) if a.can_respec_free => format!(
                    "Use a free respec ({} left)? Your mutations are undone and the mutagen refunded.",
                    fm.num(&a.free_respecs)
                ),
                Some(a) => format!(
                    "Spend {} energy to undo your mutations, refunding {} mutagen?{}",
                    fm.num(&a.respec_cost),
                    fm.num(&a.respec_spent),
                    if a.can_respec { "" } else { " (Not possible now.)" }
                ),
                None => "Respec?".into(),
            };
            let [t, b] = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).areas(inner);
            f.render_widget(Paragraph::new(text).wrap(Wrap { trim: true }), t);
            buttons(
                f,
                &mut app.hits,
                b,
                &[
                    ("Respec (y)".into(), Hit::Confirm, true),
                    ("Cancel (Esc)".into(), Hit::Close, true),
                ],
            );
        }
    }
}

fn text_overlay(f: &mut Frame, app: &mut App, full: Rect, title: &str, lines: Vec<Line>) {
    let (r, inner) = dialog(
        f,
        full,
        full.width.saturating_sub(2),
        full.height.saturating_sub(2),
        title,
    );
    app.hits.push((r, Hit::Page));
    let max = lines.len().saturating_sub(inner.height as usize);
    app.page_scroll = app.page_scroll.min(max);
    f.render_widget(
        Paragraph::new(lines).scroll((app.page_scroll.min(u16::MAX as usize) as u16, 0)),
        inner,
    );
}

fn draw_ascend(f: &mut Frame, app: &mut App, area: Rect) {
    let (_, inner) = dialog(f, area, 70, 14, "Ascension");
    let Some(a) = app.view.ascension.clone() else {
        return;
    };
    let fm = app.fmt;
    let energy = app.engine.count(app.engine.data().well_known().energy);
    let mut lines = vec![
        Line::from(format!("Ascensions so far: {}", fm.num(&a.ascensions))),
        Line::from(vec![
            Span::raw("Energy "),
            Span::styled(fm.num(&energy), bold()),
            Span::raw(format!(" of {} needed", fm.num(&a.cost))),
        ]),
    ];
    let mut status = if a.can_ascend {
        Line::from(Span::styled(
            "You can ascend now.",
            Style::default().fg(GOOD),
        ))
    } else if a.cap_diff.is_positive() {
        Line::from(Span::styled(
            format!(
                "Your energy cap is {} too low to ever afford this.",
                fm.num(&a.cap_diff)
            ),
            Style::default().fg(BAD),
        ))
    } else {
        Line::from(format!(
            "Affordable in {}",
            a.eta.as_ref().map_or("?".into(), fmt::estimate)
        ))
    };
    if !a.can_ascend && a.cap_diff.is_positive() {
        status = status.style(Style::default().fg(BAD));
    }
    lines.push(status);
    lines.push(Line::from(format!(
        "Ascending gives {} mutagen and resets most units and upgrades.",
        fm.num(&a.premutagen)
    )));
    lines.push(Line::from(Span::styled(
        format!(
            "Respec: {} energy refunds {} mutagen; {} free respecs.",
            fm.num(&a.respec_cost),
            fm.num(&a.respec_spent),
            fm.num(&a.free_respecs)
        ),
        dim(),
    )));
    let [t, g, b] = Layout::vertical([
        Constraint::Min(0),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(inner);
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), t);
    let ratio = a.cost_percent.to_f64().clamp(0.0, 1.0);
    let ratio = if ratio.is_finite() { ratio } else { 0.0 };
    f.render_widget(
        Gauge::default()
            .ratio(ratio)
            .gauge_style(Style::default().fg(if a.can_ascend { GOOD } else { ACCENT })),
        g,
    );
    buttons(
        f,
        &mut app.hits,
        b,
        &[
            ("Ascend (y)".into(), Hit::Confirm, a.can_ascend),
            (
                "Respec (r)".into(),
                Hit::Respec,
                a.can_respec || a.can_respec_free,
            ),
            ("Cancel (Esc)".into(), Hit::Close, true),
        ],
    );
}
