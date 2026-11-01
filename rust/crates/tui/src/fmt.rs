//! Text: numbers (`swarm_num::format`), durations, names and the
//! descriptions the React app shows.

use swarm_engine::view::{EffectView, StaticView};
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

fn templated(d: Option<&str>) -> bool {
    matches!(d, None | Some("") | Some("-"))
}

/// Static fallbacks for descriptions the spreadsheet leaves as "-"
/// (`app/src/content/descriptions.ts`).
fn unit_fallback(name: &str) -> &'static str {
    match name {
        "cocoon" => "Each cocoon is a larva encased within a protective shell. Larvae can freely enter and leave their cocoons, but cannot be transformed into other units while cocooned. Clone Larvae clones cocoons as if they were normal larvae.",
        "territory" => "Your swarm's military captures territory, fueling your expansion.",
        "energy" => "Energy is consumed to use special abilities.",
        "nexus" => "Nexus are the focal points for the energy needed to cast spells and use special abilities. Each nexus is more expensive than the last.",
        "crystal" => "Energy frozen into a solid form. Crystals can be thawed and used as energy at any time.",
        "nightbug" => "Nightbugs wriggle and glow when exposed to the energy of your nexus. Gather nightbugs near your nexus to store additional energy.",
        "moth" => "Lepidoptera are attracted to the light of your nightbugs, and energy is attracted to the lepidoptera.",
        "bat" => "Bats empower all of your swarm's energy-based abilities.",
        "mutagen" => "Allows mutation, increasing the power of each member of your swarm.",
        "premutagen" => "Mutagen cannot be used while inactive. Ascend to begin a new swarm, resetting most of your units and upgrades, but activating all of your mutagen.",
        "mutanthatchery" => "Increases larvae production.",
        "mutantbat" => "Increases power of all abilities.",
        "mutantclone" => "Increases Clone Larvae's maximum.",
        "mutantswarmwarp" => "Increases Swarmwarp's power.",
        "mutantrush" => "Increases the power of Larvae Rush, Meat Rush and Territory Rush.",
        "mutanteach" => "When a hatchery or expansion spawns mutagen, more mutagen is generated.",
        "mutantfreq" => "Increases the chance of spawning mutagen when buying a hatchery or expansion.",
        "mutantnexus" => "Increases energy generation and maximum energy.",
        "mutantarmy" => "Increases all territory generated.",
        "mutantmeat" => "Makes your meat units more productive.",
        _ => "",
    }
}

fn upgrade_fallback(name: &str) -> String {
    let empower = |p: &str| {
        format!("Dramatically increase both your {p}' meat cost and territory captured. This will destroy all of your {p}.")
    };
    let s = match name {
        "hatchery" => "Each hatchery produces more larvae.",
        "expansion" => "Each expansion increases your hatcheries' larvae production.",
        "clonearmy" => "Summon a mirrored copy of your army. Unlike Clone Larvae, this ability has no cap.",
        "clonelarvae" => "Clone new larvae.",
        "larvarush" => "Instantly give birth to new larvae.",
        "meatrush" => "Instantly create new meat.",
        "territoryrush" => "Instantly capture new territory.",
        "swarmwarp" => "Warp time around your swarm. Instantly travel into the future, gaining production. Does not produce energy.",
        "achievementbonus" => "Larva production increases with your achievement points.",
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
        "centipedeempower" => return empower("chilopodomorphs"),
        "devourerempower" => return empower("devourers"),
        "giantspiderempower" => return empower("giant arachnomorphs"),
        "goonempower" => return empower("goons"),
        "locustempower" => return empower("locusts"),
        "mosquitoempower" => return empower("culicimorphs"),
        "roachempower" => return empower("roaches"),
        "spiderempower" => return empower("arachnomorphs"),
        "stingerempower" => return empower("stingers"),
        "swarmlingempower" => return empower("swarmlings"),
        "waspempower" => return empower("wasps"),
        _ => "",
    };
    s.to_owned()
}

/// A unit's description: the sheet's, or the app's fallback.
pub fn unit_description(sv: &StaticView, unit: u16) -> String {
    let Some(u) = sv.units.get(unit as usize) else {
        return String::new();
    };
    if templated(u.description.as_deref()) {
        unit_fallback(&u.name).to_owned()
    } else {
        u.description.clone().unwrap_or_default()
    }
}

/// An upgrade's description: the sheet's, or the app's fallback.
pub fn upgrade_description(sv: &StaticView, up: u16) -> String {
    let Some(g) = sv.upgrades.get(up as usize) else {
        return String::new();
    };
    if templated(g.description.as_deref()) {
        upgrade_fallback(&g.name)
    } else {
        g.description.clone().unwrap_or_default()
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
