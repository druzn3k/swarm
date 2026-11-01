//! Loading the embedded data, and the load-time checks.

use swarm_data::{
    AchievementRequire, DataError, EffectKind, GameData, Num, RequireOp, Resource, UpgradeClass,
    EMBEDDED_JSON,
};

fn data() -> &'static GameData {
    GameData::embedded()
}

#[test]
fn embedded_data_resolves() {
    let d = GameData::load().expect("embedded data loads");
    assert_eq!(d.units().len(), d.raw().unittypes.len());
    assert_eq!(d.upgrades().len(), d.raw().upgrades.len());
    assert_eq!(d.achievements().len(), d.raw().achievements.len());
    assert_eq!(d.mtx().len(), d.raw().mtx.len());
}

#[test]
fn counts() {
    let d = data();
    assert_eq!(d.units().len(), 58);
    assert_eq!(d.upgrades().len(), 88);
    assert_eq!(d.achievements().len(), 121);
    assert_eq!(d.mtx().len(), 6);
    assert_eq!(d.effects().len(), 51 + 161);
    assert_eq!(d.tabs().list.len(), 5);
}

#[test]
fn names_and_ids_agree() {
    let d = data();
    for (i, u) in d.units().iter().enumerate() {
        assert_eq!(u.id.index(), i);
        assert_eq!(d.unit_id(&u.name), Some(u.id));
    }
    for (i, u) in d.upgrades().iter().enumerate() {
        assert_eq!(u.id.index(), i);
        assert_eq!(d.upgrade_id(&u.name), Some(u.id));
    }
    for (i, a) in d.achievements().iter().enumerate() {
        assert_eq!(a.id.index(), i);
        assert_eq!(d.achievement_id(&a.name), Some(a.id));
    }
    for m in d.mtx() {
        assert_eq!(d.mtx_id(&m.name), Some(m.id));
    }
    for (i, e) in d.effects().iter().enumerate() {
        assert_eq!(e.id.index(), i);
    }
    for (i, s) in d.stat_names().iter().enumerate() {
        assert_eq!(d.stat_id(s).unwrap().index(), i);
    }
    assert_eq!(d.unit_id("nosuchunit"), None);
    assert_eq!(d.unit_by_slug("greater queen"), d.unit_id("greaterqueen"));
}

#[test]
fn well_known() {
    let d = data();
    let w = d.well_known();
    assert_eq!(d.unit(w.energy).name, "energy");
    assert_eq!(d.unit(w.mtx_energy).name, "mtxEnergy");
    assert_eq!(d.unit(w.free_respec).name, "freeRespec");
    assert_eq!(d.unit(w.invisible_hatchery).name, "invisiblehatchery");
    assert_eq!(d.upgrade(w.swarmwarp).name, "swarmwarp");
    assert_eq!(d.upgrade(w.mutatehidden).name, "mutatehidden");
    assert_eq!(d.tabs().get(w.mutagen_tab).name, "mutagen");
    let s = d.stats();
    assert_eq!(d.stat_name(s.prod), "prod");
    assert_eq!(d.stat_name(s.random_freq), "random.freq");
    let hatchery = d.upgrade(w.hatchery);
    assert_eq!(
        d.stat_name(hatchery.random_minlevel_stat),
        "random.minlevel.hatchery"
    );
    assert_eq!(d.stat_name(d.unit(w.energy).cost_stat), "cost.energy");
}

#[test]
fn unit_values() {
    let d = data();
    let unit = |n: &str| d.unit(d.unit_id(n).unwrap());
    let meat = unit("meat");
    assert_eq!(meat.init, Num::from(35));
    assert!(meat.unbuyable && !meat.disabled);
    assert_eq!(unit("drone").init, Num::ZERO);
    assert_eq!(unit("freeRespec").init, Num::from(4));
    assert_eq!(unit("freeRespec").slug, None);
    let drone = unit("drone");
    assert_eq!(drone.slug.as_deref(), Some("drone"));
    assert_eq!(drone.prod[0].unit, meat.id);
    assert_eq!(drone.produced_by, [unit("queen").id]);
    // respecEnergy's negative cost is allowed: unbuyable and disabled
    let respec = unit("respecEnergy");
    assert_eq!(respec.cost[0].val, Num::from(-1));
    // disabled: in no tab, though it names one (the TS Unit.tab finds it)
    assert_eq!(respec.tab_name.as_deref(), Some("energy"));
    assert_eq!(respec.tab, d.tabs().by_name("energy"));
    assert_eq!(d.tabs().of_unit(respec.id), None);
    let nest = unit("nest");
    let warn = nest.warnfirst.as_ref().unwrap();
    assert_eq!(warn.unit, unit("queen").id);
    assert_eq!(warn.val, Some(Num::from(2000)));
    // OR requirements, and the "always false" hack op is AND
    let ops: Vec<_> = d
        .units()
        .iter()
        .flat_map(|u| u.requires.iter().map(|r| r.op))
        .collect();
    assert!(ops.contains(&RequireOp::Or));
    // upgrade requirements on units
    assert!(d.units().iter().any(|u| u
        .requires
        .iter()
        .any(|r| matches!(r.resource, Resource::Upgrade(_)))));
}

#[test]
fn upgrade_values() {
    let d = data();
    let up = |n: &str| d.upgrade(d.upgrade_id(n).unwrap());
    let swarmwarp = up("swarmwarp");
    assert_eq!(swarmwarp.class, UpgradeClass::Ability);
    let skip = d.effect(swarmwarp.effects[0]);
    assert_eq!(skip.kind, EffectKind::SkipTime);
    assert_eq!(skip.unit, None);
    assert_eq!(skip.val, Some(Num::from(900)));
    // maxlevel 1 without a factor: factor 1
    let nexus1 = up("nexus1");
    assert_eq!(nexus1.maxlevel, Some(Num::ONE));
    assert!(nexus1.cost.iter().all(|c| c.factor == Num::ONE));
    assert!(d.raw().upgrades[nexus1.id.index()]
        .cost
        .iter()
        .all(|c| c.factor.is_none()));
    // big values parse like decimal.js reads the JS number
    let cocooning = up("cocooning");
    assert_eq!(cocooning.cost[0].val, "3.33333e21".parse().unwrap());
    // suffix effects have no val (absent, not 0)
    let empower = up("swarmlingempower");
    assert!(empower.effects.iter().any(|&e| {
        let e = d.effect(e);
        e.kind == EffectKind::Suffix && e.val.is_none()
    }));
}

#[test]
fn absent_differs_from_zero() {
    let d = data();
    // compoundUnit: an absent val2 means uncapped
    let compound: Vec<_> = d
        .effects()
        .iter()
        .filter(|e| e.kind == EffectKind::CompoundUnit)
        .collect();
    assert!(!compound.is_empty());
    for (e, raw) in d.effects().iter().zip(raw_effect_vals(d)) {
        assert_eq!(e.val.is_some(), raw.0, "{:?}", e);
        assert_eq!(e.val2.is_some(), raw.1, "{:?}", e);
        assert_eq!(e.val3.is_some(), raw.2, "{:?}", e);
    }
}

fn raw_effect_vals(d: &GameData) -> Vec<(bool, bool, bool)> {
    let r = d.raw();
    let units = r
        .unittypes
        .iter()
        .flat_map(|u| &u.effect)
        .map(|e| (true, e.val2.is_some(), e.val3.is_some()));
    let upgrades = r
        .upgrades
        .iter()
        .flat_map(|u| &u.effect)
        .map(|e| (e.val.is_some(), e.val2.is_some(), false));
    units.chain(upgrades).collect()
}

#[test]
fn achievements() {
    let d = data();
    let a = |n: &str| d.achievement(d.achievement_id(n).unwrap());
    assert_eq!(
        a("clickme").requires,
        [AchievementRequire::Event {
            event: "achieveclick".into(),
            params: Some(serde_json::from_str(r#"{"name":"clickme"}"#).unwrap()),
        }]
    );
    assert_eq!(
        a("konami").requires,
        [AchievementRequire::Event {
            event: "konami".into(),
            params: None
        }]
    );
    let drone1 = a("drone1");
    assert!(matches!(
        drone1.requires[0],
        AchievementRequire::Count {
            resource: Resource::Unit(_),
            ..
        }
    ));
    assert!(d.achievements().iter().any(|a| a.points == 0));
    assert_eq!(
        d.achievement_points_possible(),
        d.raw()
            .achievements
            .iter()
            .map(|a| a.points as u32)
            .sum::<u32>()
    );
}

fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> Result<GameData, DataError> {
    let mut v: serde_json::Value = serde_json::from_str(EMBEDDED_JSON).unwrap();
    edit(&mut v);
    GameData::from_json(&v.to_string())
}

fn invalid_msg(r: Result<GameData, DataError>) -> String {
    match r {
        Err(DataError::Invalid(msg)) => msg,
        other => panic!("expected DataError::Invalid, got {:?}", other.map(|_| ())),
    }
}

#[test]
fn rejects_unknown_fields_and_versions() {
    let r = edited(|v| v["unittypes"][0]["cap"] = serde_json::json!([]));
    assert!(matches!(r, Err(DataError::Json(_))));
    let r = edited(|v| v["schema"] = 2.into());
    assert!(matches!(r, Err(DataError::SchemaVersion { found: 2 })));
}

#[test]
fn rejects_broken_data() {
    let msg = invalid_msg(edited(|v| v["unittypes"][2]["name"] = "meat".into()));
    assert!(msg.contains("duplicate unit name `meat`"), "{msg}");
    let msg = invalid_msg(edited(|v| {
        v["upgrades"][0]["cost"][0]["unittype"] = "nosuch".into()
    }));
    assert!(msg.contains("no unit named `nosuch`"), "{msg}");
    let msg = invalid_msg(edited(|v| {
        v["upgrades"][0]["cost"][0]["factor"] = serde_json::Value::Null
    }));
    assert!(msg.contains("no factor"), "{msg}");
    let msg = invalid_msg(edited(|v| {
        v["unittypes"][1]["cost"] = serde_json::json!([{"unittype": "meat", "val": 0}])
    }));
    assert!(msg.contains("must be positive"), "{msg}");
    let msg = invalid_msg(edited(
        |v| v["unittypes"][0]["effect"] = serde_json::json!([{"type": "nope", "unittype": "meat", "unittype2": null, "stat": null, "val": 1, "val2": null, "val3": null}]),
    ));
    assert!(msg.contains("unknown effect type"), "{msg}");
    let msg = invalid_msg(edited(|v| {
        v["unittypes"][1]["prod"] = serde_json::json!([{"unittype": "drone", "val": 1}])
    }));
    assert!(msg.contains("production cycle"), "{msg}");
    let msg = invalid_msg(edited(|v| {
        let ups = v["upgrades"].as_array_mut().unwrap();
        let i = ups.iter().position(|u| u["name"] == "swarmwarp").unwrap();
        ups[i]["name"] = "renamed".into();
    }));
    assert!(
        msg.contains("well-known upgrade `swarmwarp` is missing"),
        "{msg}"
    );
}

#[test]
fn rejects_conflicting_stat_operations() {
    // a multStat and an addStat on drone's `prod`
    let msg = invalid_msg(edited(|v| {
        let ups = v["upgrades"].as_array_mut().unwrap();
        let i = ups.iter().position(|u| u["name"] == "droneprod").unwrap();
        ups[i]["effect"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "type": "addStat", "unittype": "drone", "upgradetype": null, "unittype2": null,
                "stat": "prod", "val": 1, "val2": null
            }));
    }));
    assert!(
        msg.contains("conflicting stat operations for `prod`"),
        "{msg}"
    );
}
