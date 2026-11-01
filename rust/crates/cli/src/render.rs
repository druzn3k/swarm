//! What `show`, `stats` and `achievements` print, as text and JSON. Built
//! from the engine's queries (not `Engine::view`).

use std::fmt::Write as _;
use std::time::Duration;

use serde_json::{json, Value};
use swarm_data::{TabId, UnitId, UpgradeClass};
use swarm_engine::Engine;
use swarm_num::format::{format_long, format_short};
use swarm_num::Num;
use swarm_save::date::to_iso;

use crate::duration::format_duration;
use crate::CliError;

/// Number formatting: short (`1.23M`) or long (`1.23456 million`).
#[derive(Clone, Copy, Debug)]
pub struct Fmt {
    /// Long names.
    pub long: bool,
}

impl Fmt {
    /// Formats a number.
    pub fn num(&self, n: &Num) -> String {
        if self.long {
            format_long(n)
        } else {
            format_short(n)
        }
    }

    fn costs(&self, costs: &[(String, Num)]) -> String {
        costs
            .iter()
            .map(|(u, n)| format!("{} {u}", self.num(n)))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Pretty JSON.
pub fn to_json(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

fn num_json(n: &Num) -> Value {
    Value::String(n.to_string())
}

fn costs_json(costs: &[(String, Num)]) -> Value {
    costs
        .iter()
        .map(|(u, n)| (u.clone(), num_json(n)))
        .collect::<serde_json::Map<_, _>>()
        .into()
}

fn ms_duration(ms: i64) -> String {
    format_duration(Duration::from_millis(ms.max(0).unsigned_abs()))
}

/// A unit line of `show`.
pub struct UnitRow {
    name: String,
    label: String,
    count: Num,
    velocity: Num,
    cost: Vec<(String, Num)>,
    /// How many you can buy now; `None` for units that aren't bought.
    max: Option<Num>,
    buyable: bool,
    twin: Num,
    cap: Option<Num>,
    visible: bool,
}

/// An upgrade line of `show`.
pub struct UpgradeRow {
    name: String,
    label: String,
    ability: bool,
    unit: String,
    level: Num,
    maxlevel: Option<Num>,
    cost: Vec<(String, Num)>,
    /// Levels you can buy now; `None` when unlimited (no cost).
    max: Option<Num>,
    buyable: bool,
    visible: bool,
}

/// A tab of `show`.
pub struct TabRow {
    name: String,
    visible: bool,
    units: Vec<UnitRow>,
    upgrades: Vec<UpgradeRow>,
}

/// Ascension progress.
pub struct AscendRow {
    energy: Num,
    cost: Num,
    percent: Num,
    respec_cost: Num,
    free_respecs: Num,
    mutagen: Num,
}

/// Everything `show` prints.
pub struct ShowView {
    now_ms: i64,
    started_ms: i64,
    elapsed_ms: i64,
    points: u32,
    tabs: Vec<TabRow>,
    ascension: Option<AscendRow>,
}

fn unit_label(engine: &Engine, u: UnitId) -> String {
    let t = engine.data().unit(u);
    t.text.label.clone().unwrap_or_else(|| t.name.clone())
}

/// Builds the `show` view. Units are queried before upgrades, like the
/// game (visibility is sticky within a run, so order matters).
pub fn show(engine: &Engine, all: bool, tab: Option<&str>) -> Result<ShowView, CliError> {
    let data = engine.data();
    let tabs = data.tabs();
    let only: Option<TabId> = match tab {
        None => None,
        Some(name) => Some(tabs.by_name(name).ok_or_else(|| {
            let names: Vec<_> = tabs.list.iter().map(|t| t.name.as_str()).collect();
            CliError::Usage(format!("no such tab: {name} (tabs: {})", names.join(", ")))
        })?),
    };
    let unit_row = |u: UnitId| {
        let t = data.unit(u);
        let visible = engine.unit_visible(u);
        let has_buy = engine.is_buy_button_visible(u);
        UnitRow {
            name: t.name.clone(),
            label: unit_label(engine, u),
            count: engine.count(u),
            velocity: engine.velocity(u),
            cost: engine
                .each_cost(u)
                .into_iter()
                .map(|c| (data.unit(c.unit).name.clone(), c.val))
                .collect(),
            max: has_buy.then(|| engine.unit_max_cost_met(u, Num::ONE)),
            buyable: visible && engine.unit_is_buyable(u, false),
            twin: engine.twin_mult(u),
            cap: engine.cap(u),
            visible,
        }
    };
    let mut rows: Vec<TabRow> = tabs
        .list
        .iter()
        .enumerate()
        .map(|(i, t)| TabRow {
            name: t.name.clone(),
            visible: engine.unit_visible(t.lead),
            units: if only.is_some_and(|o| o.index() != i) {
                Vec::new()
            } else {
                t.sorted_units()
                    .map(unit_row)
                    .filter(|r| all || r.visible)
                    .collect()
            },
            upgrades: Vec::new(),
        })
        .collect();
    for g in data.upgrades() {
        // upgrades of tabless units (the invisible hatchery's) are listed
        // with what the unit produces (larva), like the game's unit pages
        let tab = tabs.of_unit(g.unit).or_else(|| {
            data.unit(g.unit)
                .prod
                .iter()
                .find_map(|p| tabs.of_unit(p.unit))
        });
        let Some(tab) = tab else {
            continue;
        };
        if only.is_some_and(|o| o != tab) {
            continue;
        }
        let visible = engine.upgrade_visible(g.id);
        if !all && !visible {
            continue;
        }
        let max = engine.upgrade_max_cost_met(g.id, Num::ONE);
        rows[tab.index()].upgrades.push(UpgradeRow {
            name: g.name.clone(),
            label: g.text.label.clone().unwrap_or_else(|| g.name.clone()),
            ability: g.class == UpgradeClass::Ability,
            unit: data.unit(g.unit).name.clone(),
            level: engine.upgrade_count(g.id),
            maxlevel: g.maxlevel,
            cost: engine
                .total_cost(g.id)
                .into_iter()
                .map(|c| (data.unit(c.unit).name.clone(), c.val))
                .collect(),
            max: (max != Num::MAX).then_some(max),
            buyable: visible && engine.upgrade_is_buyable(g.id),
            visible,
        });
    }
    let rows: Vec<TabRow> = rows
        .into_iter()
        .enumerate()
        .filter(|(i, t)| {
            only.map_or(all || t.visible, |o| o.index() == *i)
                && (!t.units.is_empty() || !t.upgrades.is_empty())
        })
        .map(|(_, t)| t)
        .collect();
    let wk = data.well_known();
    let ascension = engine.unit_visible(wk.energy).then(|| {
        let cost = engine.ascend_cost(None);
        AscendRow {
            energy: engine.count(wk.energy),
            cost,
            percent: engine.ascend_cost_percent(cost),
            respec_cost: engine.respec_cost(),
            free_respecs: engine.count(wk.free_respec),
            mutagen: engine.count(wk.mutagen),
        }
    });
    Ok(ShowView {
        now_ms: engine.now_ms(),
        started_ms: engine.state().dates.started,
        elapsed_ms: engine.elapsed_start_ms(),
        points: engine.achievement_points(),
        tabs: rows,
        ascension,
    })
}

impl ShowView {
    /// Machine-readable form. Numbers are exact decimal strings.
    pub fn json(&self) -> Value {
        let tabs: Vec<Value> = self
            .tabs
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "visible": t.visible,
                    "units": t.units.iter().map(|u| json!({
                        "name": u.name,
                        "label": u.label,
                        "visible": u.visible,
                        "count": num_json(&u.count),
                        "velocity": num_json(&u.velocity),
                        "cost": costs_json(&u.cost),
                        "max_buy": u.max.as_ref().map(num_json),
                        "buyable": u.buyable,
                        "twin": num_json(&u.twin),
                        "cap": u.cap.as_ref().map(num_json),
                    })).collect::<Vec<_>>(),
                    "upgrades": t.upgrades.iter().map(|g| json!({
                        "name": g.name,
                        "label": g.label,
                        "class": if g.ability { "ability" } else { "upgrade" },
                        "unit": g.unit,
                        "visible": g.visible,
                        "level": num_json(&g.level),
                        "maxlevel": g.maxlevel.as_ref().map(num_json),
                        "cost": costs_json(&g.cost),
                        "max_buy": g.max.as_ref().map(num_json),
                        "buyable": g.buyable,
                    })).collect::<Vec<_>>(),
                })
            })
            .collect();
        json!({
            "now_ms": self.now_ms,
            "now": to_iso(self.now_ms),
            "started_ms": self.started_ms,
            "elapsed_ms": self.elapsed_ms,
            "achievement_points": self.points,
            "tabs": tabs,
            "ascension": self.ascension.as_ref().map(|a| json!({
                "energy": num_json(&a.energy),
                "cost": num_json(&a.cost),
                "percent": num_json(&a.percent),
                "respec_cost": num_json(&a.respec_cost),
                "free_respecs": num_json(&a.free_respecs),
                "mutagen": num_json(&a.mutagen),
            })),
        })
    }

    /// Human-readable form. `*` marks what you can buy now.
    pub fn text(&self, f: &Fmt) -> String {
        let mut s = String::new();
        let _ = writeln!(
            s,
            "Played {} (game clock {}), {} achievement points",
            ms_duration(self.elapsed_ms),
            to_iso(self.now_ms),
            self.points
        );
        for t in &self.tabs {
            let _ = writeln!(s, "\n== {} ==", t.name);
            if !t.units.is_empty() {
                let _ = writeln!(
                    s,
                    "  {:<18} {:>10} {:>10}  {:<28} {:>9}",
                    "unit", "count", "per sec", "cost each", "can buy"
                );
            }
            for u in &t.units {
                let mut cost = f.costs(&u.cost);
                if u.twin != Num::ONE {
                    cost.push_str(&format!(" (x{})", f.num(&u.twin)));
                }
                let mut count = f.num(&u.count);
                if let Some(cap) = &u.cap {
                    count = format!("{count}/{}", f.num(cap));
                }
                let _ = writeln!(
                    s,
                    "{} {:<18} {:>10} {:>10}  {:<28} {:>9}{}",
                    if u.buyable { '*' } else { ' ' },
                    u.name,
                    count,
                    f.num(&u.velocity),
                    if cost.is_empty() { "-".into() } else { cost },
                    u.max.as_ref().map_or("-".into(), |m| f.num(m)),
                    if u.visible { "" } else { "  (hidden)" },
                );
            }
            if !t.upgrades.is_empty() {
                let _ = writeln!(
                    s,
                    "  {:<18} {:>10} {:<28} {:>9}",
                    "upgrade", "level", "next cost", "can buy"
                );
            }
            for g in &t.upgrades {
                let mut level = f.num(&g.level);
                if let Some(m) = &g.maxlevel {
                    level = format!("{level}/{}", f.num(m));
                }
                let cost = f.costs(&g.cost);
                let _ = writeln!(
                    s,
                    "{} {:<18} {:>10} {:<28} {:>9}{}{}",
                    if g.buyable { '*' } else { ' ' },
                    g.name,
                    level,
                    if cost.is_empty() { "-".into() } else { cost },
                    g.max.as_ref().map_or("-".into(), |m| f.num(m)),
                    if g.ability { "  (ability)" } else { "" },
                    if g.visible { "" } else { "  (hidden)" },
                );
            }
        }
        if let Some(a) = &self.ascension {
            let pct = (a.percent.to_f64() * 100.0).floor();
            let _ = writeln!(
                s,
                "\nAscension: {} / {} energy ({pct}%); respec costs {} energy, {} free respecs; mutagen {}",
                f.num(&a.energy),
                f.num(&a.cost),
                f.num(&a.respec_cost),
                f.num(&a.free_respecs),
                f.num(&a.mutagen),
            );
        }
        s
    }
}

/// `swarm stats --json`.
pub fn stats(engine: &Engine) -> Value {
    let st = engine.state();
    let wk = engine.data().well_known();
    let units: serde_json::Map<String, Value> = st
        .statistics
        .by_unit
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                json!({
                    "clicks": v.clicks,
                    "num": num_json(&v.num),
                    "twinnum": num_json(&v.twinnum),
                    "elapsed_first_ms": v.elapsed_first,
                }),
            )
        })
        .collect();
    let upgrades: serde_json::Map<String, Value> = st
        .statistics
        .by_upgrade
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                json!({
                    "clicks": v.clicks,
                    "num": num_json(&v.num),
                    "elapsed_first_ms": v.elapsed_first,
                }),
            )
        })
        .collect();
    json!({
        "started_ms": st.dates.started,
        "restarted_ms": st.dates.restarted,
        "now_ms": engine.now_ms(),
        "elapsed_ms": engine.elapsed_start_ms(),
        "skipped_ms": engine.total_skipped_ms(),
        "ascensions": num_json(&engine.count(wk.ascension)),
        "clicks": st.statistics.clicks,
        "achievement_points": engine.achievement_points(),
        "by_unit": units,
        "by_upgrade": upgrades,
    })
}

/// `swarm stats`.
pub fn stats_text(engine: &Engine, f: &Fmt) -> String {
    let st = engine.state();
    let wk = engine.data().well_known();
    let mut s = String::new();
    let _ = writeln!(s, "Started:     {}", to_iso(st.dates.started));
    if let Some(r) = st.dates.restarted.filter(|&r| r != st.dates.started) {
        let _ = writeln!(s, "Ascended:    {}", to_iso(r));
    }
    let _ = writeln!(s, "Played:      {}", ms_duration(engine.elapsed_start_ms()));
    let _ = writeln!(s, "Skipped:     {}", ms_duration(engine.total_skipped_ms()));
    let _ = writeln!(s, "Ascensions:  {}", f.num(&engine.count(wk.ascension)));
    let _ = writeln!(s, "Purchases:   {}", st.statistics.clicks);
    let _ = writeln!(
        s,
        "Achievements: {} / {} points",
        engine.achievement_points(),
        engine.data().achievement_points_possible()
    );
    let first = |e: Option<i64>| e.map_or("-".into(), ms_duration);
    if !st.statistics.by_unit.is_empty() {
        let _ = writeln!(
            s,
            "\n  {:<18} {:>7} {:>10} {:>10}  first bought after",
            "unit", "buys", "bought", "received"
        );
        for (k, v) in &st.statistics.by_unit {
            let _ = writeln!(
                s,
                "  {:<18} {:>7} {:>10} {:>10}  {}",
                k,
                v.clicks,
                f.num(&v.num),
                f.num(&v.twinnum),
                first(v.elapsed_first)
            );
        }
    }
    if !st.statistics.by_upgrade.is_empty() {
        let _ = writeln!(
            s,
            "\n  {:<18} {:>7} {:>10}  first bought after",
            "upgrade", "buys", "levels"
        );
        for (k, v) in &st.statistics.by_upgrade {
            let _ = writeln!(
                s,
                "  {:<18} {:>7} {:>10}  {}",
                k,
                v.clicks,
                f.num(&v.num),
                first(v.elapsed_first)
            );
        }
    }
    s
}

/// One achievement.
pub struct AchievementRow {
    name: String,
    label: String,
    description: String,
    points: u32,
    earned_ms: Option<i64>,
    unmasked: bool,
    progress: Option<(Num, Num)>,
}

/// `swarm achievements`.
pub struct AchievementList {
    points: u32,
    possible: u32,
    percent: f64,
    rows: Vec<AchievementRow>,
}

/// Earned achievements first (in the order earned), then the rest by
/// progress, like the game's list. Masked ones only with `all`.
pub fn achievements(engine: &Engine, all: bool) -> AchievementList {
    let data = engine.data();
    let mut rows: Vec<(f64, AchievementRow)> = data
        .achievements()
        .iter()
        .filter_map(|a| {
            let earned_ms = engine.achievement_earned_at(a.id);
            let unmasked = engine.achievement_unmasked(a.id);
            if !all && !unmasked && earned_ms.is_none() {
                return None;
            }
            let progress = engine
                .achievement_progress_val(a.id)
                .zip(engine.achievement_progress_max(a.id));
            let mut description = a.text.description.clone().unwrap_or_default();
            if let Some(max) = engine.achievement_progress_max(a.id) {
                description = description.replace("$REQUIRED", &format_short(&max));
            }
            Some((
                engine.achievement_progress_order(a.id),
                AchievementRow {
                    name: a.name.clone(),
                    label: a.text.label.clone().unwrap_or_else(|| a.name.clone()),
                    description,
                    points: a.points,
                    earned_ms,
                    unmasked,
                    progress,
                },
            ))
        })
        .collect();
    rows.sort_by(|(oa, a), (ob, b)| match (a.earned_ms, b.earned_ms) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => ob.total_cmp(oa),
    });
    AchievementList {
        points: engine.achievement_points(),
        possible: data.achievement_points_possible(),
        percent: engine.achievement_percent(),
        rows: rows.into_iter().map(|(_, r)| r).collect(),
    }
}

impl AchievementList {
    /// Machine-readable form.
    pub fn json(&self) -> Value {
        json!({
            "points": self.points,
            "possible": self.possible,
            "percent": self.percent,
            "achievements": self.rows.iter().map(|r| json!({
                "name": r.name,
                "label": r.label,
                "description": r.description,
                "points": r.points,
                "earned_ms": r.earned_ms,
                "unmasked": r.unmasked,
                "progress": r.progress.map(|(v, m)| json!([num_json(&v), num_json(&m)])),
            })).collect::<Vec<_>>(),
        })
    }

    /// Human-readable form.
    pub fn text(&self, f: &Fmt) -> String {
        let mut s = String::new();
        let _ = writeln!(
            s,
            "Achievements: {} / {} points ({:.1}%)",
            self.points,
            self.possible,
            self.percent * 100.0
        );
        for r in &self.rows {
            let status = match (r.earned_ms, r.progress) {
                (Some(ms), _) => format!("earned after {}", ms_duration(ms)),
                (None, Some((v, m))) => format!("{} / {}", f.num(&v), f.num(&m)),
                (None, None) => String::new(),
            };
            let _ = writeln!(
                s,
                "[{}] {:<28} {:>3} pts  {}",
                if r.earned_ms.is_some() { 'x' } else { ' ' },
                r.label,
                r.points,
                status
            );
            if !r.description.is_empty() {
                let _ = writeln!(s, "      {} ({})", r.description, r.name);
            }
        }
        s
    }
}
