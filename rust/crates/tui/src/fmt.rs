//! Text: numbers (`swarm_num::format`), durations, names and the
//! descriptions the React app shows.

use swarm_engine::view::{EffectView, StaticView, UnitDetail, UpgradeDetail};
use swarm_engine::Estimate;
use swarm_num::format::{format_long, format_short};
use swarm_num::Num;

/// Number style: short suffixes ("1.23M") or long names ("1.23 million").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Fmt {
    /// Long names.
    pub long: bool,
}

impl Fmt {
    /// A number; `Num::MAX` (the engine's "unlimited") is "∞".
    pub fn num(&self, n: &Num) -> String {
        if *n == Num::MAX {
            return "∞".into();
        }
        if self.long {
            format_long(n)
        } else {
            format_short(n)
        }
    }

    /// Always short, for tight columns.
    pub fn short(&self, n: &Num) -> String {
        if *n == Num::MAX {
            return "∞".into();
        }
        format_short(n)
    }
}

/// `3d 4h`, `12m 5s`, `42s`: the two largest units.
pub fn duration(secs: f64) -> String {
    if !secs.is_finite() {
        return "forever".into();
    }
    let s = secs.max(0.0);
    if s < 1.0 {
        return "now".into();
    }
    if s >= 1e3 * 365.0 * 86400.0 {
        return format!(
            "{} years",
            format_short(&Num::from_f64(s / (365.0 * 86400.0)))
        );
    }
    let total = s.floor() as u64;
    let parts = [
        (total / 86400, "d"),
        ((total / 3600) % 24, "h"),
        ((total / 60) % 60, "m"),
        (total % 60, "s"),
    ];
    let first = parts.iter().position(|(v, _)| *v > 0).unwrap_or(3);
    parts[first..]
        .iter()
        .take(2)
        .filter(|(v, _)| *v > 0)
        .map(|(v, u)| format!("{v}{u}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// An estimate: "now", "3m 2s", "never".
pub fn estimate(e: &Estimate) -> String {
    match e {
        Estimate::Reached => "now".into(),
        Estimate::Secs(s) if s.is_nan() => "?".into(),
        Estimate::Secs(s) => duration(*s),
        Estimate::Never => "never".into(),
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}

/// A unit's label, plural or singular, capitalised.
pub fn unit_label(sv: &StaticView, unit: u16, plural: bool) -> String {
    let Some(u) = sv.units.get(unit as usize) else {
        return format!("#{unit}");
    };
    let l = if plural {
        u.plural.as_ref().or(u.label.as_ref())
    } else {
        u.label.as_ref()
    };
    capitalize(l.unwrap_or(&u.name))
}

/// An upgrade's label.
pub fn upgrade_label(sv: &StaticView, up: u16) -> String {
    let Some(g) = sv.upgrades.get(up as usize) else {
        return format!("#{up}");
    };
    capitalize(g.label.as_deref().unwrap_or(&g.name))
}

/// A tab's title.
pub fn tab_label(sv: &StaticView, tab: usize) -> String {
    sv.tabs
        .get(tab)
        .map(|t| capitalize(&t.name))
        .unwrap_or_default()
}

/// `10 meat, 1 larva`.
pub fn costs(sv: &StaticView, f: &Fmt, list: &[(u16, Num)]) -> String {
    if list.is_empty() {
        return "free".into();
    }
    list.iter()
        .map(|(u, n)| {
            format!(
                "{} {}",
                f.num(n),
                unit_label(sv, *u, *n != Num::ONE).to_lowercase()
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// A unit's description: the engine's rendered live template (in the
/// unit's [`UnitDetail`], for the focused unit), else the sheet's text.
pub fn unit_description(sv: &StaticView, unit: u16, detail: Option<&UnitDetail>) -> String {
    if let Some(d) = detail.and_then(|d| d.description.clone()) {
        return d;
    }
    sheet_text(
        sv.units
            .get(unit as usize)
            .and_then(|u| u.description.as_deref()),
    )
}

/// An upgrade's description: the engine's rendered live template (in its
/// [`UpgradeDetail`]), else the sheet's text.
pub fn upgrade_description(sv: &StaticView, up: u16, detail: Option<&UpgradeDetail>) -> String {
    if let Some(d) = detail.and_then(|d| d.description.clone()) {
        return d;
    }
    sheet_text(
        sv.upgrades
            .get(up as usize)
            .and_then(|g| g.description.as_deref()),
    )
}

/// The spreadsheet's description, or nothing where it stands for a live
/// template.
fn sheet_text(d: Option<&str>) -> String {
    if swarm_engine::description::is_templated(d) {
        String::new()
    } else {
        d.unwrap_or_default().to_owned()
    }
}

/// One live line per effect (the app's `LiveDescription`, generically):
/// what it gives now, from the engine's [`EffectView`].
pub fn effect_line(sv: &StaticView, f: &Fmt, ev: &EffectView) -> Option<String> {
    let st = sv.effects.get(ev.id as usize)?;
    let unit = |plural| st.unit.map(|u| unit_label(sv, u, plural).to_lowercase());
    let stat_list = || -> Option<String> {
        let s: Vec<String> = ev
            .stats
            .iter()
            .map(|(stat, v)| {
                let name = sv.stats.get(*stat as usize).map_or("?", String::as_str);
                let op = if st.kind == "addStat" { "+" } else { "×" };
                format!("{name} {op}{}", f.num(v))
            })
            .collect();
        (!s.is_empty()).then(|| s.join(", "))
    };
    match st.kind.as_str() {
        "addUnit" | "addUnitByVelocity" => Some(format!(
            "Gives {} {}",
            f.num(ev.output.as_ref()?),
            unit(true)?
        )),
        "compoundUnit" => {
            let mut s = format!("Gives {} more {}", f.num(ev.output.as_ref()?), unit(true)?);
            if let Some(cap) = &ev.cap {
                s.push_str(&format!(" (max {})", f.num(cap)));
            }
            Some(s)
        }
        "addUpgrade" => Some(format!(
            "Gives {} levels of {}",
            f.num(ev.output.as_ref()?),
            upgrade_label(sv, st.upgrade?)
        )),
        "skipTime" => {
            let secs = ev.output.as_ref()?.to_f64();
            Some(format!("Warps {} into the future", duration(secs)))
        }
        "addUnitRand" => {
            let r = ev.rand_next.as_ref().or(ev.rand.as_ref())?;
            Some(if r.spawned {
                format!("Next level spawns {} {}", f.num(&r.qty), unit(true)?)
            } else {
                format!("Next level spawns no {}", unit(true)?)
            })
        }
        "addUnitTimed" => {
            let ms = ev.timer_remaining_ms?;
            let val = st.val.as_ref().map(|v| f.num(v)).unwrap_or_default();
            Some(if ms <= 0.0 {
                format!("Next purchase awards {val} {}", unit(true)?)
            } else {
                format!(
                    "In {}, the next purchase awards {val} {}",
                    duration(ms / 1000.0),
                    unit(true)?
                )
            })
        }
        "suffix" => None,
        _ => Some(format!("{}: {}", unit(true)?, stat_list()?)),
    }
}

/// Clips `s` to `w` display columns (chars), with an ellipsis.
pub fn clip(s: &str, w: usize) -> String {
    let n = s.chars().count();
    if n <= w {
        return s.to_owned();
    }
    if w == 0 {
        return String::new();
    }
    let mut out: String = s.chars().take(w - 1).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(duration(0.2), "now");
        assert_eq!(duration(42.0), "42s");
        assert_eq!(duration(3725.0), "1h 2m");
        assert_eq!(duration(86400.0 * 2.0 + 5.0), "2d");
        assert_eq!(duration(f64::INFINITY), "forever");
        assert_eq!(estimate(&Estimate::Never), "never");
    }

    #[test]
    fn numbers() {
        let n: Num = "1234567".parse().unwrap();
        assert_eq!(Fmt { long: false }.num(&n), "1.23M");
        assert!(Fmt { long: true }.num(&n).contains("million"));
        assert_eq!(Fmt::default().num(&Num::MAX), "∞");
        assert_eq!(clip("abcdef", 4), "abc…");
    }
}
