//! Live description templates: the old game's `views/desc/{unit,upgrade}/*.html`
//! (which the app ported as `LiveDescription.tsx`), as plain-text templates
//! the engine renders, so every frontend shows the same text.
//!
//! A unit or upgrade whose spreadsheet description is `-` (or absent) has a
//! template ([`unit_template`], [`upgrade_template`], also in
//! [`StaticUnit::description_template`](crate::view::StaticUnit::description_template)
//! and [`StaticUpgrade::description_template`](crate::view::StaticUpgrade::description_template)).
//! [`Engine::render_description`] fills it in from the live game; the view's
//! [`UnitDetail::description`](crate::UnitDetail::description) and
//! [`UpgradeDetail::description`](crate::UpgradeDetail::description) carry
//! the result for detailed units and upgrades.
//!
//! # Template language
//!
//! Each line is a paragraph; the rendered paragraphs are joined by `\n` and
//! empty ones are dropped. A line is also dropped when one of its values is
//! missing (an effect stat not set yet, say): the old templates showed a
//! blank or `?` there.
//!
//! * `{{expr}}`: a number in the long format (`format_long`, the old
//!   `longnum`), or a text value as is. Filters: `{{expr | plain}}` (the
//!   number's canonical digits), `| percent:N` (times 100, `N` decimals,
//!   `%`), `| plusone:N` (a multiplier as a percentage: `1.25` is `25%`),
//!   `| duration` (seconds as `"12:34"`, `"3 days 4 hours"`), `| cap`
//!   (capitalised text).
//! * `{{? cond}}` keeps the line only if `cond` holds, `{{! cond}}` only if
//!   it does not; `cond` is `expr` (nonzero) or `expr OP expr` with `OP` one
//!   of `>= > <= < ==`. A missing value fails `?` and passes `!`.
//! * A line starting with `{{*}}` is repeated for each of the owner's
//!   effects, which `e` then names.
//! * `expr` is terms joined by `+`, `-` and `*`, evaluated left to right
//!   (no precedence). A term is a number or a path; a path ending in `?`
//!   is zero when missing.
//!
//! Paths: `self` is the owner (a unit, or an upgrade); `eN` (and `e` in a
//! `{{*}}` line) is its effect `N`; `unit.NAME` and `upgrade.NAME` are any
//! other.
//!
//! * a unit: `.count`, `.velocity`, `.visible` (1 or 0), `.plural`,
//!   `.label`, `.stat.STAT`, `.prod.UNIT` (base production of one, before
//!   stats), `.totalprod.UNIT` (production of all of them).
//! * an upgrade: `.count`, `.unit` (its unit), `.eN`.
//! * an effect: `.val`, `.val2`, `.output`, `.bank`, `.cap`, `.qty` (an
//!   addUnitRand's next roll), `.timer` (an addUnitTimed's seconds left),
//!   `.stat.STAT` (the stats it alone gives), `.unit` (its target unit).
//!
//! Rates are per second (the app's default velocity unit).

use swarm_data::{EffectId, UnitId, UpgradeId};
use swarm_num::format::format_long;
use swarm_num::Num;

use crate::engine::Engine;

/// Whose description a template is: what `self` and `eN` name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DescriptionOwner {
    /// A unit.
    Unit(UnitId),
    /// An upgrade or ability.
    Upgrade(UpgradeId),
}

/// Whether a spreadsheet description stands for a live template (`-` or
/// none).
pub fn is_templated(sheet: Option<&str>) -> bool {
    matches!(sheet, None | Some("" | "-"))
}

const CRYSTAL_TIMER: &str = "\
{{? unit.energy.visible}}{{! upgrade.hatchery.e2.timer > 0}}Your next UNITTEXT will award {{upgrade.hatchery.e2.val | plain}} crystals.
{{? unit.energy.visible}}{{? upgrade.hatchery.e2.timer > 0}}After {{upgrade.hatchery.e2.timer | duration}}, your next UNITTEXT will award {{upgrade.hatchery.e2.val | plain}} crystals.";

/// The live template of a unit whose spreadsheet description is `-`.
pub fn unit_template(name: &str) -> Option<String> {
    let t = match name {
        "cocoon" => "\
Each cocoon is a larva encased within a protective shell. Larvae can freely enter and leave their cocoons, but cannot be transformed into other units while cocooned.
Clone Larvae clones cocoons as if they were normal larvae. Cocoon your larvae intended for cloning to avoid accidentally spending them.
You produce {{unit.larva.velocity}} larvae per second, allowing you to clone up to {{upgrade.clonelarvae.e0.cap}} larvae.",
        "territory" => "Your swarm's military captures territory, fueling your expansion.",
        "energy" => "Energy is consumed to use special abilities.",
        "nexus" => "\
Nexus are the focal points for the energy needed to cast spells and use special abilities.
Drawing energy from multiple nexus is powerful but difficult - each nexus is more expensive than the last, and ultimately there is a limit to the number of nexus your spellcasters can utilize.",
        "crystal" => {
            return Some(format!(
                "Energy frozen into a solid form. Crystals can be thawed and used as energy at any time. Unlike energy, crystals have no maximum, and are kept when ascending.\n{}\nConverting crystals has permanently increased your maximum energy by {{{{unit.mtxEnergy.count}}}}.",
                CRYSTAL_TIMER.replace("UNITTEXT", "hatchery or expansion")
            ))
        }
        "nightbug" => "\
Nightbugs wriggle and glow when exposed to the energy of your nexus. Gather nightbugs near your nexus to store additional energy.
Your nightbugs store up to {{e0.stat.capMult | plusone:2}} more maximum energy. Hatching more has diminishing returns, but can increase this to a maximum of {{e0.val | plusone:0}}.",
        "moth" => "\
Lepidoptera are mysterious creatures, with furry bodies and large wings, emerging from their dens only at night. The lepidoptera are attracted to the light of your nightbugs, and energy is attracted to the lepidoptera.
Your lepidoptera generate {{e0.stat.prod | plusone:2}} more energy. Hatching more has diminishing returns, but can increase this to a maximum of {{e0.val | plusone:0}}.",
        "bat" => "\
Bats empower all of your swarm's energy-based abilities.
Your bats make your abilities {{e0.stat.power | plusone:2}} more powerful. Raising more has diminishing returns, but can increase this to a maximum of {{e0.val | plusone:0}}.",
        "mutagen" => "Allows mutation, increasing the power of each member of your swarm.",
        "premutagen" => "Mutagen cannot be used while inactive. Ascend to begin a new swarm, resetting most of your units and upgrades, but activating all of your mutagen. Active mutagen allows powerful upgrades.",
        "mutanthatchery" => "\
Increases larvae production by {{e0.stat.prod | plusone:2}}.
{{? self.count <= 10}}Raw mutagen produces larvae that doesn't benefit from hatchery mutations. Don't spend all your mutagen too early!",
        "mutantbat" => "Increases power of all abilities by {{e0.stat.power | plusone:2}}.",
        "mutantclone" => "Increases Clone Larvae's maximum by {{e0.stat.power.clonelarvae | plusone:2}}.",
        "mutantswarmwarp" => "Increases Swarmwarp's power by {{e0.stat.power.swarmwarp | plusone:2}}.",
        "mutantrush" => "\
Increases Larvae Rush's power by {{e0.stat.power.larvarush | plusone:2}}.
Increases Meat Rush's power by {{e1.stat.power.meatrush | plusone:2}}.
Increases Territory Rush's power by {{e2.stat.power.territoryrush | plusone:2}}.",
        "mutanteach" => "When a hatchery or expansion spawns mutagen, {{e0.stat.random.each | plusone:2}} more mutagen is generated.",
        "mutantfreq" => "\
Increases the chance of spawning mutagen when buying a hatchery or expansion by {{e1.val * e0.stat.random.freq - e1.val | percent:2}}.
You currently have a {{e0.unit.stat.random.freq | percent:2}} chance to spawn mutagen. More {{self.plural}} have diminishing returns, but can increase this to a maximum of {{e1.val * e0.val | percent:2}}.",
        "mutantnexus" => "\
Increases energy generation by {{e0.stat.prod | plusone:2}}. Creating more has diminishing returns, but increases this to a maximum of {{e0.val | plusone:2}}.
Increases maximum energy by {{e1.stat.capMult | plusone:2}}. Creating more has diminishing returns, but increases this to a maximum of {{e1.val | plusone:2}}.
However, {{e2.stat.ascendCost | plusone:2}} more energy must be spent to decrease ascension costs. Creating more increases this to a maximum of {{e2.val | plusone:2}}.",
        "mutantarmy" => "Increases all territory generated by {{e0.stat.prod | plusone:2}}.",
        "mutantmeat" => "{{*}}{{? e.unit.visible}}{{e.unit.plural | cap}} are {{e.stat.prod | plusone:2}} more productive.",
        _ => return None,
    };
    Some(t.to_owned())
}

/// The live template of an upgrade whose spreadsheet description is `-`.
pub fn upgrade_template(name: &str) -> Option<String> {
    if name.ends_with("empower") {
        return Some(
            "Dramatically increase both your {{self.unit.plural}}' meat cost and territory captured.\nThis will destroy all {{self.unit.count}} of your {{self.unit.plural}}."
                .to_owned(),
        );
    }
    let mutagen = |unit: &str| {
        format!(
            "{{{{? self.unit.stat.random.minlevel.{unit} <= self.count}}}}Your next {unit} has a {{{{self.unit.stat.random.freq | percent:0}}}} chance to award {{{{e1.qty}}}} mutagen.\n\
             {{{{! self.unit.stat.random.minlevel.{unit} <= self.count}}}}{{{{? unit.mutagen.visible}}}}Build {{{{self.unit.stat.random.minlevel.{unit}}}}} {unit}s to begin earning mutagen.\n{}",
            CRYSTAL_TIMER.replace("UNITTEXT", unit)
        )
        .replace("hatcherys", "hatcheries")
    };
    let t = match name {
        "hatchery" => {
            return Some(format!(
                "Each hatchery produces {{{{e0.val}}}} more larvae per second. Currently, your hatcheries produce a total of {{{{self.unit.totalprod.larva}}}} larvae per second. With no multipliers, they would produce {{{{self.unit.prod.larva + e0.stat.base?}}}} larvae per second.\n{}",
                mutagen("hatchery")
            ))
        }
        "expansion" => {
            return Some(format!(
                "Each expansion increases your hatcheries' larvae production by {{{{e0.val | plusone:0}}}}. Currently, your expansions increase hatchery production by {{{{e0.stat.prod - 1 * 100}}}}%.\n{}",
                mutagen("expansion")
            ))
        }
        "achievementbonus" => "Larva production increased by {{e0.val * 10 | percent:0}} per 10 achievement points.",
        "larvarush" => "Instantly give birth to {{e0.output + e1.output}} new larvae.",
        "meatrush" => "Instantly create {{e0.output + e1.output}} new meat.",
        "territoryrush" => "Instantly capture {{e0.output + e1.output}} new territory.",
        "swarmwarp" => "Warp time around your swarm. Instantly travel into the future, gaining {{e0.output | duration}} of production. Does not produce energy.",
        "clonelarvae" => "\
Clone {{e0.output}} new larvae.
You produce {{unit.larva.velocity}} larvae per second, allowing you to clone up to {{e0.cap}} larvae. You have {{e0.bank}} larvae and cocoons available to clone.",
        "clonearmy" => "\
Summon a mirrored copy of your army. Unlike Clone Larvae, this ability has no cap.
{{*}}{{? e.output > 0}}Create {{e.output}} {{e.unit.plural}}.",
        "mutatearmy" => "Increases the amount of territory captured, and increases the cost of unlocking other mutagen powers.",
        "mutatebat" => "Increases the power of all abilities, and increases the cost of unlocking other mutagen powers.",
        "mutateclone" => "Increases Clone Larvae's maximum, and increases the cost of unlocking other mutagen powers.",
        "mutateeach" => "When a hatchery or expansion spawns mutagen, more mutagen is generated. Increases the cost of unlocking other mutagen powers.",
        "mutatefreq" => "Increases the chance of spawning mutagen when buying a hatchery or expansion, and increases the cost of unlocking other mutagen powers.",
        "mutatehatchery" => "Increases larvae production, and increases the cost of unlocking other mutagen powers.",
        "mutatemeat" => "Increases production of all meat units, and increases the cost of unlocking other mutagen powers.",
        "mutatenexus" => "Increases energy generated, but also increases the energy cost of ascending. Increases the cost of unlocking other mutagen powers.",
        "mutaterush" => "Increases the power of Larvae Rush, Meat Rush, and Territory Rush, and increases the cost of unlocking other mutagen powers.",
        "mutateswarmwarp" => "Increases Swarmwarp's power, and increases the cost of unlocking other mutagen powers.",
        _ => return None,
    };
    Some(t.to_owned())
}

// ---------------------------------------------------------------- render

/// A value in a template.
#[derive(Clone, Debug, PartialEq)]
enum Val {
    Num(Num),
    Text(String),
}

impl Val {
    fn num(&self) -> Option<Num> {
        match self {
            Val::Num(n) => Some(*n),
            Val::Text(_) => None,
        }
    }
}

/// What a path is relative to.
#[derive(Clone, Copy, Debug)]
enum Scope {
    Unit(UnitId),
    Upgrade(UpgradeId),
    Effect(EffectId),
}

impl Engine {
    /// The description of a unit: its spreadsheet text, or its live
    /// template rendered now.
    pub fn unit_description(&self, unit: UnitId) -> String {
        let u = self.data.unit(unit);
        match &u.text.description {
            Some(d) if !is_templated(Some(d)) => d.clone(),
            _ => unit_template(&u.name).map_or_else(String::new, |t| {
                self.render_description(&t, DescriptionOwner::Unit(unit))
            }),
        }
    }

    /// The description of an upgrade or ability: its spreadsheet text, or
    /// its live template rendered now.
    pub fn upgrade_description(&self, upgrade: UpgradeId) -> String {
        let g = self.data.upgrade(upgrade);
        match &g.text.description {
            Some(d) if !is_templated(Some(d)) => d.clone(),
            _ => upgrade_template(&g.name).map_or_else(String::new, |t| {
                self.render_description(&t, DescriptionOwner::Upgrade(upgrade))
            }),
        }
    }

    /// Renders a description template (see the [module docs](self)) for
    /// `owner` from the live game: paragraphs joined by `\n`.
    pub fn render_description(&self, template: &str, owner: DescriptionOwner) -> String {
        let me = match owner {
            DescriptionOwner::Unit(u) => Scope::Unit(u),
            DescriptionOwner::Upgrade(g) => Scope::Upgrade(g),
        };
        let effects: &[EffectId] = match owner {
            DescriptionOwner::Unit(u) => &self.data.unit(u).effects,
            DescriptionOwner::Upgrade(g) => &self.data.upgrade(g).effects,
        };
        let mut paras: Vec<String> = Vec::new();
        for line in template.lines() {
            match line.strip_prefix("{{*}}") {
                Some(rest) => {
                    for &e in effects {
                        paras.extend(self.render_line(rest, me, Some(e)));
                    }
                }
                None => paras.extend(self.render_line(line, me, None)),
            }
        }
        paras.retain(|p| !p.trim().is_empty());
        paras.join("\n")
    }

    /// One line, or `None` if a value is missing or a guard fails.
    fn render_line(&self, line: &str, me: Scope, each: Option<EffectId>) -> Option<String> {
        let mut out = String::new();
        let mut rest = line;
        while let Some(start) = rest.find("{{") {
            out.push_str(&rest[..start]);
            let after = &rest[start + 2..];
            let end = after.find("}}")?;
            let inner = after[..end].trim();
            rest = &after[end + 2..];
            if let Some(cond) = inner.strip_prefix('?') {
                if self.eval_cond(cond, me, each) != Some(true) {
                    return None;
                }
            } else if let Some(cond) = inner.strip_prefix('!') {
                if self.eval_cond(cond, me, each) == Some(true) {
                    return None;
                }
            } else {
                let (expr, filter) = match inner.split_once('|') {
                    Some((e, f)) => (e, Some(f.trim())),
                    None => (inner, None),
                };
                let v = self.eval_expr(expr, me, each)?;
                out.push_str(&apply_filter(&v, filter)?);
            }
        }
        out.push_str(rest);
        Some(out)
    }

    fn eval_cond(&self, cond: &str, me: Scope, each: Option<EffectId>) -> Option<bool> {
        for op in [">=", "<=", "==", ">", "<"] {
            if let Some((a, b)) = cond.split_once(op) {
                let a = self.eval_expr(a, me, each)?.num()?;
                let b = self.eval_expr(b, me, each)?.num()?;
                return Some(match op {
                    ">=" => a >= b,
                    "<=" => a <= b,
                    "==" => a == b,
                    ">" => a > b,
                    _ => a < b,
                });
            }
        }
        Some(!self.eval_expr(cond, me, each)?.num()?.is_zero())
    }

    fn eval_expr(&self, expr: &str, me: Scope, each: Option<EffectId>) -> Option<Val> {
        let mut acc: Option<Val> = None;
        let mut op = '+';
        let mut rest = expr.trim();
        loop {
            let end = rest.find(['+', '-', '*']).unwrap_or(rest.len());
            let term = self.eval_term(rest[..end].trim(), me, each)?;
            acc = Some(match acc {
                None => term,
                Some(prev) => {
                    let (a, b) = (prev.num()?, term.num()?);
                    Val::Num(match op {
                        '+' => a + b,
                        '-' => a - b,
                        _ => a * b,
                    })
                }
            });
            if end == rest.len() {
                return acc;
            }
            op = rest[end..].chars().next()?;
            rest = rest[end + 1..].trim_start();
        }
    }

    fn eval_term(&self, term: &str, me: Scope, each: Option<EffectId>) -> Option<Val> {
        if let Some(path) = term.strip_suffix('?') {
            return Some(
                self.eval_term(path, me, each)
                    .unwrap_or(Val::Num(Num::ZERO)),
            );
        }
        if term.starts_with(|c: char| c.is_ascii_digit()) {
            return term.parse().ok().map(Val::Num);
        }
        let mut parts = term.split('.');
        let scope = match parts.next()? {
            "self" => me,
            "e" => Scope::Effect(each?),
            "unit" => Scope::Unit(self.data.unit_id(parts.next()?)?),
            "upgrade" => Scope::Upgrade(self.data.upgrade_id(parts.next()?)?),
            e => self.nth_effect(me, e)?,
        };
        self.eval_path(scope, &parts.collect::<Vec<_>>())
    }

    /// `eN` of a unit or upgrade.
    fn nth_effect(&self, scope: Scope, name: &str) -> Option<Scope> {
        let n: usize = name.strip_prefix('e')?.parse().ok()?;
        let list = match scope {
            Scope::Unit(u) => &self.data.unit(u).effects,
            Scope::Upgrade(g) => &self.data.upgrade(g).effects,
            Scope::Effect(_) => return None,
        };
        list.get(n).copied().map(Scope::Effect)
    }

    fn eval_path(&self, scope: Scope, path: &[&str]) -> Option<Val> {
        let num = |n: Num| Some(Val::Num(n));
        let (&field, rest) = path.split_first()?;
        match scope {
            Scope::Unit(u) => match field {
                "count" => num(self.count(u)),
                "velocity" => num(self.velocity(u)),
                // without marking it seen (sticky visibility is game
                // behaviour, PARITY(cache)); a description only reads it
                "visible" => num(Num::from(i32::from(self.unit_visible_peek(u)))),
                "plural" | "label" => {
                    let t = &self.data.unit(u).text;
                    let label = t
                        .label
                        .clone()
                        .unwrap_or_else(|| self.data.unit(u).name.clone());
                    Some(Val::Text(if field == "plural" {
                        t.plural.clone().unwrap_or(label)
                    } else {
                        label
                    }))
                }
                "stat" => num(self.stat_by_name(u, &rest.join("."))?),
                "prod" => {
                    let of = self.data.unit_id(rest.first()?)?;
                    let p = self.data.unit(u).prod.iter().find(|p| p.unit == of)?;
                    num(p.val)
                }
                "totalprod" => {
                    let of = self.data.unit_id(rest.first()?)?;
                    num(self.total_production(u).into_iter().find(|p| p.0 == of)?.1)
                }
                _ => None,
            },
            Scope::Upgrade(g) => match field {
                "count" => num(self.upgrade_count(g)),
                "unit" => self.eval_path(Scope::Unit(self.data.upgrade(g).unit), rest),
                e => self.eval_path(self.nth_effect(scope, e)?, rest),
            },
            Scope::Effect(e) => {
                let st = self.data.effect(e);
                match field {
                    "val" => num(st.val?),
                    "val2" => num(st.val2?),
                    "val3" => num(st.val3?),
                    "unit" => self.eval_path(Scope::Unit(st.unit?), rest),
                    "stat" => {
                        let stat = self.data.stat_id(&rest.join("."))?;
                        let stats = self.effect_stats(e);
                        num(stats.iter().find(|s| s.0 == stat)?.1)
                    }
                    _ => {
                        let v = self.effect_view(e);
                        match field {
                            "output" => num(v.output?),
                            "bank" => num(v.bank?),
                            "cap" => num(v.cap?),
                            "qty" => num(v.rand_next?.qty),
                            "timer" => num(Num::from_f64(v.timer_remaining_ms? / 1000.0)),
                            _ => None,
                        }
                    }
                }
            }
        }
    }
}

fn apply_filter(v: &Val, filter: Option<&str>) -> Option<String> {
    let n = match v {
        Val::Text(t) => {
            return Some(match filter {
                Some("cap") => capitalize(t),
                _ => t.clone(),
            })
        }
        Val::Num(n) => *n,
    };
    let (name, arg) = match filter {
        Some(f) => match f.split_once(':') {
            Some((name, arg)) => (name.trim(), arg.trim().parse::<usize>().ok()),
            None => (f, None),
        },
        None => ("long", None),
    };
    Some(match name {
        "long" => format_long(&n),
        "plain" => n.to_string(),
        "percent" => percent(n, arg.unwrap_or(0)),
        "plusone" => percent(n - Num::ONE, arg.unwrap_or(0)),
        "duration" => duration(n.to_f64()),
        _ => return None,
    })
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

/// The app's `formatPercent`: times 100, `places` decimals, thousands
/// separators.
fn percent(v: Num, places: usize) -> String {
    let n = (v * Num::from(100)).to_f64();
    if !n.is_finite() {
        return if n > 0.0 { "∞%".into() } else { "?".into() };
    }
    format!("{}%", grouped(n, places))
}

/// `n` with `places` decimals and comma thousands separators (JS
/// `toLocaleString("en-US")`).
fn grouped(n: f64, places: usize) -> String {
    let s = format!("{:.*}", places, n.abs());
    let (int, frac) = s
        .split_once('.')
        .map_or((s.as_str(), None), |(i, f)| (i, Some(f)));
    let mut out = String::new();
    if n < 0.0 && s.bytes().any(|b| b.is_ascii_digit() && b != b'0') {
        out.push('-');
    }
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if let Some(f) = frac {
        out.push('.');
        out.push_str(f);
    }
    out
}

/// The app's abbreviated `formatDuration`: `""` for zero or less,
/// `"00:42"`, `"12:34"`, `"1:02:03"`, `"3 days 4 hours"`.
fn duration(secs: f64) -> String {
    const MIN: f64 = 60.0;
    const HOUR: f64 = 60.0 * MIN;
    const DAY: f64 = 24.0 * HOUR;
    const MONTH: f64 = 30.0 * DAY;
    const YEAR: f64 = 365.0 * DAY;
    if !(secs.is_finite() && secs > 0.0) {
        return String::new();
    }
    let plural = |n: f64, one: &str, many: &str| {
        let n = n.floor();
        format!("{n} {}", if n == 1.0 { one } else { many })
    };
    if secs >= 100.0 * YEAR {
        format!("{} years", format_long(&Num::from_f64(secs / YEAR)))
    } else if secs >= YEAR {
        format!(
            "{} {}",
            plural(secs / YEAR, "year", "years"),
            plural((secs % YEAR) / MONTH, "month", "months")
        )
    } else if secs >= MONTH {
        format!(
            "{} {}",
            plural(secs / MONTH, "month", "months"),
            plural((secs % MONTH) / DAY, "day", "days")
        )
    } else if secs >= DAY {
        format!(
            "{} {}",
            plural(secs / DAY, "day", "days"),
            plural((secs % DAY) / HOUR, "hour", "hours")
        )
    } else if secs >= MIN {
        let h = (secs / HOUR).floor();
        let m = ((secs % HOUR) / MIN).floor();
        let s = (secs % MIN).floor();
        if h > 0.0 {
            format!("{h}:{m:02}:{s:02}")
        } else {
            format!("{m}:{s:02}")
        }
    } else {
        format!("00:{:02}", secs.floor())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_the_app() {
        assert_eq!(grouped(1234567.891, 2), "1,234,567.89");
        assert_eq!(grouped(12.0, 0), "12");
        assert_eq!(grouped(-1234.0, 0), "-1,234");
        assert_eq!(percent(Num::from_f64(0.25), 0), "25%");
        assert_eq!(percent(Num::from_f64(1.2345), 2), "123.45%");
        assert_eq!(duration(42.5), "00:42");
        assert_eq!(duration(754.0), "12:34");
        assert_eq!(duration(3723.0), "1:02:03");
        assert_eq!(duration(3.0 * 86400.0 + 4.0 * 3600.0), "3 days 4 hours");
        assert_eq!(duration(0.0), "");
        assert_eq!(capitalize("drones"), "Drones");
    }

    #[test]
    fn every_templated_item_has_a_template() {
        let d = swarm_data::GameData::embedded();
        for u in d.units() {
            if is_templated(u.text.description.as_deref()) && u.name != "freeRespec" {
                assert!(unit_template(&u.name).is_some(), "unit {}", u.name);
            }
        }
        for g in d.upgrades() {
            if is_templated(g.text.description.as_deref()) && g.name != "mutatehidden" {
                assert!(upgrade_template(&g.name).is_some(), "upgrade {}", g.name);
            }
        }
    }
}
