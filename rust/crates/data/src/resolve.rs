//! Turning [`GameDataJson`] into [`GameData`]: names to ids, values to
//! [`Num`], defaults and the TS engine's load-time asserts
//! (`unittypes.ts`, `upgradetypes.ts`, `achievementtypes.ts`), plus the
//! derived tables (producers, paths, stat fold order, tabs).

use std::collections::HashMap;

use swarm_num::Num;

use crate::error::{invalid, DataError};
use crate::ids::{AchievementId, EffectId, MtxId, StatId, UnitId, UpgradeId};
use crate::schema::{GameDataJson, UnitEffectJson, UpgradeEffectJson};
use crate::stats::{StatTable, WellKnownStats};
use crate::types::*;
use crate::wellknown::WellKnown;
use crate::{paths, tabs, GameData, SCHEMA_VERSION};

use json_num as num;

/// A JSON number as a [`Num`], the way decimal.js reads a JS number
/// (`new Decimal(0.07)`): from its shortest round-trip decimal form, so
/// `0.07` is exactly `7e-2`. `Num::from(0.07)` instead converts the binary
/// value and can be an ulp off.
pub fn json_num(x: f64) -> Num {
    format!("{x:e}").parse().unwrap_or_else(|_| Num::from(x))
}

fn index<Id: Copy>(
    what: &str,
    names: impl Iterator<Item = String>,
    make: impl Fn(usize) -> Id,
) -> Result<HashMap<String, Id>, DataError> {
    let mut map = HashMap::new();
    for (i, name) in names.enumerate() {
        if name.is_empty() {
            return invalid(format!("{what} #{i} has no name"));
        }
        if map.insert(name.clone(), make(i)).is_some() {
            return invalid(format!("duplicate {what} name `{name}`"));
        }
    }
    Ok(map)
}

/// `x > 0` (the TS asserts' test; absent is not positive)
fn positive(x: Option<f64>) -> bool {
    x.is_some_and(|x| x > 0.0)
}

fn small_uint(x: f64, what: impl FnOnce() -> String) -> Result<u32, DataError> {
    if x >= 0.0 && x.fract() == 0.0 && x <= u32::MAX as f64 {
        Ok(x as u32)
    } else {
        invalid(format!(
            "{}: expected a non-negative integer, got {x}",
            what()
        ))
    }
}

struct Names {
    units: HashMap<String, UnitId>,
    upgrades: HashMap<String, UpgradeId>,
}

impl Names {
    fn unit(&self, name: &str, ctx: impl FnOnce() -> String) -> Result<UnitId, DataError> {
        match self.units.get(name) {
            Some(&id) => Ok(id),
            None => invalid(format!("{}: no unit named `{name}`", ctx())),
        }
    }
    fn upgrade(&self, name: &str, ctx: impl FnOnce() -> String) -> Result<UpgradeId, DataError> {
        match self.upgrades.get(name) {
            Some(&id) => Ok(id),
            None => invalid(format!("{}: no upgrade named `{name}`", ctx())),
        }
    }
    /// exactly one of a unit and an upgrade
    fn resource(
        &self,
        unit: Option<&str>,
        upgrade: Option<&str>,
        ctx: impl Fn() -> String,
    ) -> Result<Resource, DataError> {
        match (unit, upgrade) {
            (Some(u), None) => Ok(Resource::Unit(self.unit(u, ctx)?)),
            (None, Some(u)) => Ok(Resource::Upgrade(self.upgrade(u, ctx)?)),
            _ => invalid(format!(
                "{}: needs exactly one of unittype/upgradetype",
                ctx()
            )),
        }
    }
}

struct EffectFields<'a> {
    kind: &'a str,
    unit: Option<&'a str>,
    unit2: Option<&'a str>,
    upgrade: Option<&'a str>,
    stat: Option<&'a str>,
    val: Option<f64>,
    val2: Option<f64>,
    val3: Option<f64>,
}

impl<'a> From<&'a UnitEffectJson> for EffectFields<'a> {
    fn from(e: &'a UnitEffectJson) -> Self {
        EffectFields {
            kind: &e.kind,
            unit: Some(&e.unittype),
            unit2: e.unittype2.as_deref(),
            upgrade: None,
            stat: e.stat.as_deref(),
            val: Some(e.val),
            val2: e.val2,
            val3: e.val3,
        }
    }
}

impl<'a> From<&'a UpgradeEffectJson> for EffectFields<'a> {
    fn from(e: &'a UpgradeEffectJson) -> Self {
        EffectFields {
            kind: &e.kind,
            unit: e.unittype.as_deref(),
            unit2: e.unittype2.as_deref(),
            upgrade: e.upgradetype.as_deref(),
            stat: e.stat.as_deref(),
            val: e.val,
            val2: e.val2,
            val3: None,
        }
    }
}

fn effect(
    names: &Names,
    stats: &mut StatTable,
    effects: &mut Vec<Effect>,
    parent: EffectParent,
    index: usize,
    e: EffectFields<'_>,
    ctx: &dyn Fn() -> String,
) -> Result<EffectId, DataError> {
    let Some(kind) = EffectKind::from_name(e.kind) else {
        return invalid(format!("{}: unknown effect type `{}`", ctx(), e.kind));
    };
    let unit = e.unit.map(|u| names.unit(u, ctx)).transpose()?;
    let unit2 = e.unit2.map(|u| names.unit(u, ctx)).transpose()?;
    let upgrade = e.upgrade.map(|u| names.upgrade(u, ctx)).transpose()?;
    let stat = e.stat.map(|s| stats.intern(s));
    let needs_unit = matches!(
        kind,
        EffectKind::AddUnit
            | EffectKind::AddUnitByVelocity
            | EffectKind::AddUnitTimed
            | EffectKind::AddUnitRand
            | EffectKind::CompoundUnit
            | EffectKind::Suffix
    );
    if needs_unit && unit.is_none() {
        return invalid(format!("{}: {} needs a unittype", ctx(), e.kind));
    }
    if kind == EffectKind::AddUpgrade && upgrade.is_none() {
        return invalid(format!("{}: {} needs an upgradetype", ctx(), e.kind));
    }
    if kind.stat_op().is_some() && stat.is_none() {
        return invalid(format!("{}: {} needs a stat", ctx(), e.kind));
    }
    let id = EffectId::from_index(effects.len());
    effects.push(Effect {
        id,
        parent,
        index,
        kind,
        unit,
        unit2,
        upgrade,
        stat,
        val: e.val.map(num),
        val2: e.val2.map(num),
        val3: e.val3.map(num),
    });
    Ok(id)
}

pub(crate) fn resolve(raw: GameDataJson) -> Result<GameData, DataError> {
    if raw.schema != SCHEMA_VERSION {
        return Err(DataError::SchemaVersion { found: raw.schema });
    }
    let names = Names {
        units: index(
            "unit",
            raw.unittypes.iter().map(|u| u.name.clone()),
            UnitId::from_index,
        )?,
        upgrades: index(
            "upgrade",
            raw.upgrades.iter().map(|u| u.name.clone()),
            UpgradeId::from_index,
        )?,
    };
    let achievement_by_name = index(
        "achievement",
        raw.achievements.iter().map(|a| a.name.clone()),
        AchievementId::from_index,
    )?;
    let mtx_by_name = index(
        "mtx",
        raw.mtx.iter().map(|m| m.name.clone()),
        MtxId::from_index,
    )?;

    let mut stats = StatTable::default();
    let well_known_stats = WellKnownStats::intern(&mut stats);
    let mut effects: Vec<Effect> = Vec::new();

    // units
    let mut units = Vec::with_capacity(raw.unittypes.len());
    for (i, u) in raw.unittypes.iter().enumerate() {
        let id = UnitId::from_index(i);
        let name = &u.name;
        let ctx = |field: &str| format!("unit `{name}` {field}");
        let amounts = |list: &[crate::schema::UnitAmountJson],
                       field: &str|
         -> Result<Vec<UnitAmount>, DataError> {
            list.iter()
                .map(|a| {
                    let unit = names.unit(&a.unittype, || ctx(field))?;
                    let Some(val) = a.val else {
                        return invalid(format!("{}: no val", ctx(field)));
                    };
                    Ok(UnitAmount {
                        unit,
                        val: num(val),
                    })
                })
                .collect()
        };
        let cost = amounts(&u.cost, "cost")?;
        for (c, raw_c) in cost.iter().zip(&u.cost) {
            // unittypes.ts: cost.val > 0, unless unbuyable and disabled (respecEnergy)
            if !(positive(raw_c.val) || (u.unbuyable && u.disabled)) {
                return invalid(format!(
                    "{}: val must be positive, got {}",
                    ctx("cost"),
                    c.val
                ));
            }
        }
        let prod = amounts(&u.prod, "prod")?;
        for p in &u.prod {
            if !positive(p.val) {
                return invalid(format!("{}: val must be positive", ctx("prod")));
            }
        }
        let requires = u
            .requires
            .iter()
            .map(|r| {
                Ok(UnitRequire {
                    resource: names.resource(
                        r.unittype.as_deref(),
                        r.upgradetype.as_deref(),
                        || ctx("requires"),
                    )?,
                    val: num(r.val),
                    op: if r.op.as_deref() == Some("OR") {
                        RequireOp::Or
                    } else {
                        RequireOp::And
                    },
                })
            })
            .collect::<Result<Vec<_>, DataError>>()?;
        let warnfirst = match &u.warnfirst {
            None => None,
            Some(w) => Some(WarnFirst {
                unit: names.unit(&w.unittype, || ctx("warnfirst"))?,
                val: w.val.map(num),
                text: w.text.clone(),
            }),
        };
        let showparent = u
            .showparent
            .as_deref()
            .map(|s| names.unit(s, || ctx("showparent")))
            .transpose()?;
        let mut unit_effects = Vec::with_capacity(u.effect.len());
        for (k, e) in u.effect.iter().enumerate() {
            unit_effects.push(effect(
                &names,
                &mut stats,
                &mut effects,
                EffectParent::Unit(id),
                k,
                e.into(),
                &|| ctx(&format!("effect #{k}")),
            )?);
        }
        units.push(UnitType {
            id,
            name: name.clone(),
            slug: u.slug.clone(),
            text: u.text.clone(),
            tab_name: u.tab.clone(),
            tab: None,
            column: u
                .column
                .map(|c| small_uint(c, || ctx("column")))
                .transpose()?,
            tier: u.tier.map(|t| small_uint(t, || ctx("tier"))).transpose()?,
            init: num(u.init),
            ascend_preserve: u.ascend_preserve,
            disabled: u.disabled,
            unbuyable: u.unbuyable,
            is_buy_hidden: u.is_buy_hidden,
            showparent,
            warnfirst,
            cost,
            prod,
            requires,
            effects: unit_effects,
            produced_by: Vec::new(),
            producer_paths: Vec::new(),
            max_degree: 0,
            upgrades: Vec::new(),
            affected_by: Vec::new(),
            stat_effects: Vec::new(),
            cost_stat: stats.intern(&format!("cost.{name}")),
        });
    }

    // upgrades
    let mut upgrades = Vec::with_capacity(raw.upgrades.len());
    for (i, u) in raw.upgrades.iter().enumerate() {
        let id = UpgradeId::from_index(i);
        let name = &u.name;
        let ctx = |field: &str| format!("upgrade `{name}` {field}");
        let class = match u.class.as_str() {
            "upgrade" => UpgradeClass::Upgrade,
            "ability" => UpgradeClass::Ability,
            other => return invalid(format!("{}: `{other}`", ctx("class"))),
        };
        let maxlevel = u.maxlevel.map(num);
        let cost = u
            .cost
            .iter()
            .map(|c| {
                let unit = names.unit(&c.unittype, || ctx("cost"))?;
                if !positive(Some(c.val)) {
                    return invalid(format!("{}: val must be positive", ctx("cost")));
                }
                // upgradetypes.ts: maxlevel 1 without a factor means factor 1
                let factor = match c.factor {
                    None if u.maxlevel == Some(1.0) => 1.0,
                    None => return invalid(format!("{}: no factor", ctx("cost"))),
                    Some(f) => f,
                };
                if !positive(Some(factor)) {
                    return invalid(format!("{}: factor must be positive", ctx("cost")));
                }
                Ok(UpgradeCost {
                    unit,
                    val: num(c.val),
                    factor: num(factor),
                })
            })
            .collect::<Result<Vec<_>, DataError>>()?;
        let requires = u
            .requires
            .iter()
            .map(|r| {
                Ok(UnitAmount {
                    unit: names.unit(&r.unittype, || ctx("requires"))?,
                    val: num(r.val),
                })
            })
            .collect::<Result<Vec<_>, DataError>>()?;
        let mut upgrade_effects = Vec::with_capacity(u.effect.len());
        for (k, e) in u.effect.iter().enumerate() {
            upgrade_effects.push(effect(
                &names,
                &mut stats,
                &mut effects,
                EffectParent::Upgrade(id),
                k,
                e.into(),
                &|| ctx(&format!("effect #{k}")),
            )?);
        }
        upgrades.push(UpgradeType {
            id,
            name: name.clone(),
            text: u.text.clone(),
            class,
            unit: names.unit(&u.unittype, || ctx("unittype"))?,
            maxlevel,
            cost,
            requires,
            effects: upgrade_effects,
            power_stat: stats.intern(&format!("power.{name}")),
            upgradecostmult_stat: stats.intern(&format!("upgradecostmult.{name}")),
            random_minlevel_stat: stats.intern(&format!("random.minlevel.{name}")),
        });
    }

    // producers (unittypes.ts), affectedBy (unit.ts _init), upgrade lists
    for i in 0..units.len() {
        let id = units[i].id;
        for k in 0..units[i].prod.len() {
            let target = units[i].prod[k].unit;
            units[target.index()].produced_by.push(id);
        }
        for k in 0..units[i].effects.len() {
            let e = units[i].effects[k];
            let target = effects[e.index()].unit.expect("unit effects have a unit");
            units[target.index()].affected_by.push(e);
        }
    }
    for unit in &mut units {
        unit.upgrades = upgrades
            .iter()
            .filter(|g| g.unit == unit.id || Some(g.unit) == unit.showparent)
            .map(|g| g.id)
            .collect();
        let from_upgrades = unit
            .upgrades
            .iter()
            .flat_map(|&g| upgrades[g.index()].effects.iter().copied());
        unit.stat_effects = from_upgrades
            .chain(unit.affected_by.iter().copied())
            .filter(|&e| effects[e.index()].kind.has_calc_stats())
            .collect();
        // effecttypes.ts validateSchema, at load instead of at the first stats()
        let mut schema: HashMap<StatId, StatOp> = HashMap::new();
        for &e in &unit.stat_effects {
            let e = &effects[e.index()];
            if let (Some(op), Some(stat)) = (e.kind.stat_op(), e.stat) {
                let prev = *schema.entry(stat).or_insert(op);
                if prev != op {
                    return invalid(format!(
                        "unit `{}`: conflicting stat operations for `{}`: {prev:?} and {op:?}",
                        unit.name,
                        stats.names[stat.index()]
                    ));
                }
            }
        }
    }

    let producer_paths = paths::build(&mut units)?;
    let Some(tabs) = tabs::build(&units) else {
        return invalid("no unit is in a tab");
    };
    for unit in &mut units {
        unit.tab = unit.tab_name.as_deref().and_then(|t| tabs.by_name(t));
    }

    // achievements
    let mut achievements = Vec::with_capacity(raw.achievements.len());
    for (i, a) in raw.achievements.iter().enumerate() {
        let name = &a.name;
        let ctx = |field: &str| format!("achievement `{name}` {field}");
        let requires = a
            .requires
            .iter()
            .map(|r| match (&r.event, r.val) {
                (Some(event), None) if r.unittype.is_none() && r.upgradetype.is_none() => {
                    Ok(AchievementRequire::Event {
                        event: event.clone(),
                        params: r.params.clone(),
                    })
                }
                (None, Some(val)) if r.params.is_none() => Ok(AchievementRequire::Count {
                    resource: names.resource(
                        r.unittype.as_deref(),
                        r.upgradetype.as_deref(),
                        || ctx("requires"),
                    )?,
                    val: num(val),
                }),
                _ => invalid(format!(
                    "{}: expected {{event, params}}, {{unittype, val}} or {{upgradetype, val}}",
                    ctx("requires")
                )),
            })
            .collect::<Result<Vec<_>, DataError>>()?;
        let visible = a
            .visible
            .iter()
            .map(|v| {
                Ok((
                    names.resource(v.unittype.as_deref(), v.upgradetype.as_deref(), || {
                        ctx("visible")
                    })?,
                    num(v.val),
                ))
            })
            .collect::<Result<Vec<_>, DataError>>()?;
        achievements.push(AchievementType {
            id: AchievementId::from_index(i),
            name: name.clone(),
            text: a.text.clone(),
            // achievementtypes.ts: points >= 0, a number
            points: small_uint(a.points, || ctx("points"))?,
            requires,
            visible,
        });
    }

    let mtx = raw
        .mtx
        .iter()
        .enumerate()
        .map(|(i, m)| {
            Ok(Mtx {
                id: MtxId::from_index(i),
                name: m.name.clone(),
                label: m.label.clone(),
                description: m.description.clone(),
                price_kreds: m.price_kreds,
                price_usd_paypal: m.price_usd_paypal,
                uses: m.uses,
                pack_unit: names.unit(&m.pack.unittype, || format!("mtx `{}` pack", m.name))?,
                pack_val: m.pack.val.map(num),
                bulkbonus: m.bulkbonus,
            })
        })
        .collect::<Result<Vec<_>, DataError>>()?;

    let well_known = WellKnown::resolve(&names.units, &names.upgrades, &tabs)?;
    // TS game.unit(slug) keyBy: the last unit with a slug wins
    let unit_by_slug = units
        .iter()
        .filter_map(|u| u.slug.clone().map(|s| (s, u.id)))
        .collect();

    Ok(GameData {
        raw,
        units,
        upgrades,
        achievements,
        mtx,
        effects,
        producer_paths,
        tabs,
        unit_by_name: names.units,
        unit_by_slug,
        upgrade_by_name: names.upgrades,
        achievement_by_name,
        mtx_by_name,
        stat_names: stats.names,
        stat_by_name: stats.by_name,
        well_known_stats,
        well_known,
    })
}
