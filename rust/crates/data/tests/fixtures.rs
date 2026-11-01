//! The resolved data against dumps of the TS engine
//! (`engine/scripts/dump-rust-fixtures.ts`; `engine/test/gamedata-json.test.ts`
//! fails while they are stale).

use serde::Deserialize;
use swarm_data::{json_num, EffectParent, GameData, Num, UnitId};

#[derive(Deserialize)]
struct UnitPaths {
    unit: String,
    paths: Vec<PathDump>,
}

#[derive(Deserialize)]
struct PathDump {
    units: Vec<String>,
    prod: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnitDump {
    unit: String,
    tab: Option<String>,
    next: Option<String>,
    prev: Option<String>,
    upgrades: Vec<String>,
    affected_by: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabDump {
    name: String,
    lead: String,
    units: Vec<String>,
    sorted_units: Vec<String>,
}

fn data() -> &'static GameData {
    GameData::embedded()
}

fn name(u: UnitId) -> String {
    data().unit(u).name.clone()
}

fn names(us: impl IntoIterator<Item = UnitId>) -> Vec<String> {
    us.into_iter().map(name).collect()
}

#[test]
fn producer_paths_match_the_ts_engine() {
    let dump: Vec<UnitPaths> =
        serde_json::from_str(include_str!("fixtures/producer-paths.json")).unwrap();
    let d = data();
    assert_eq!(dump.len(), d.units().len());
    let mut total = 0;
    for (unit, want) in d.units().iter().zip(&dump) {
        assert_eq!(unit.name, want.unit);
        let got: Vec<_> = d.paths_of(unit.id).collect();
        assert_eq!(
            got.len(),
            want.paths.len(),
            "{}: number of paths",
            unit.name
        );
        for (k, (path, w)) in got.iter().zip(&want.paths).enumerate() {
            assert_eq!(path.unit, unit.id);
            assert_eq!(
                names(path.parents()),
                w.units,
                "{} path #{k}: units",
                unit.name
            );
            let prod: Vec<Num> = path.links.iter().map(|l| l.prod).collect();
            let want_prod: Vec<Num> = w.prod.iter().map(|&p| json_num(p)).collect();
            assert_eq!(prod, want_prod, "{} path #{k}: prod", unit.name);
            // links chain up to the unit
            for (i, link) in path.links.iter().enumerate() {
                let next = path.links.get(i + 1).map_or(unit.id, |l| l.parent);
                assert_eq!(link.child, next);
                assert_eq!(d.unit(link.parent).prod[link.prod_index].unit, link.child);
            }
        }
        total += got.len();
        let max = want.paths.iter().map(|p| p.units.len()).max().unwrap_or(0);
        assert_eq!(unit.max_degree, max, "{}: max degree", unit.name);
    }
    assert_eq!(total, d.producer_paths().len());
}

#[test]
fn path_prefixes_are_the_intermediate_units_paths() {
    let d = data();
    for path in d.producer_paths() {
        assert_eq!(path.prefixes.len(), path.degree());
        assert_eq!(*path.prefixes.last().unwrap(), path.id);
        for (k, &prefix) in path.prefixes.iter().enumerate() {
            let p = d.producer_path(prefix);
            assert_eq!(p.unit, path.links[k].child);
            assert_eq!(p.links[..], path.links[..=k]);
        }
    }
}

#[test]
fn degree_facts_from_the_plan() {
    // rust/PLAN.md section 0: paths up to degree 20, up to 20 paths per unit
    let d = data();
    let max_degree = d.units().iter().map(|u| u.max_degree).max().unwrap();
    let max_paths = d
        .units()
        .iter()
        .map(|u| u.producer_paths.len())
        .max()
        .unwrap();
    assert_eq!(max_degree, 20);
    assert_eq!(max_paths, 20);
    let meat = d.unit(d.unit_id("meat").unwrap());
    assert_eq!(
        names(d.paths_of(meat.id).next().unwrap().parents()),
        ["drone"]
    );
}

#[test]
fn units_match_the_ts_engine() {
    let dump: Vec<UnitDump> = serde_json::from_str(include_str!("fixtures/units.json")).unwrap();
    let d = data();
    assert_eq!(dump.len(), d.units().len());
    for (unit, want) in d.units().iter().zip(&dump) {
        assert_eq!(unit.name, want.unit);
        let tab = unit.tab.map(|t| d.tabs().get(t));
        assert_eq!(tab.map(|t| t.name.clone()), want.tab, "{}: tab", unit.name);
        let listed = d.tabs().of_unit(unit.id).map(|t| d.tabs().get(t));
        assert_eq!(
            listed.and_then(|t| t.next(unit.id)).map(name),
            want.next,
            "{}: next",
            unit.name
        );
        assert_eq!(
            listed.and_then(|t| t.prev(unit.id)).map(name),
            want.prev,
            "{}: prev",
            unit.name
        );
        let upgrades: Vec<_> = unit
            .upgrades
            .iter()
            .map(|&g| d.upgrade(g).name.clone())
            .collect();
        assert_eq!(upgrades, want.upgrades, "{}: upgrades", unit.name);
        let affected: Vec<_> = unit
            .affected_by
            .iter()
            .map(|&e| {
                let e = d.effect(e);
                let EffectParent::Unit(p) = e.parent else {
                    panic!("affected_by holds unit effects only")
                };
                format!("{}#{}", name(p), e.index)
            })
            .collect();
        assert_eq!(affected, want.affected_by, "{}: affected_by", unit.name);
        // stat fold order: the upgrades' effects, then affected_by
        let want_fold: Vec<_> = unit
            .upgrades
            .iter()
            .flat_map(|&g| d.upgrade(g).effects.iter().copied())
            .chain(unit.affected_by.iter().copied())
            .filter(|&e| d.effect(e).kind.has_calc_stats())
            .collect();
        assert_eq!(unit.stat_effects, want_fold);
    }
}

#[test]
fn tabs_match_the_ts_engine() {
    let dump: Vec<TabDump> = serde_json::from_str(include_str!("fixtures/tabs.json")).unwrap();
    let tabs = data().tabs();
    let (all, listed) = dump.split_last().unwrap();
    assert_eq!(all.name, "all");
    assert_eq!(listed.len(), tabs.list.len());
    for (tab, want) in tabs.list.iter().chain([&tabs.all]).zip(&dump) {
        assert_eq!(tab.name, want.name);
        assert_eq!(name(tab.lead), want.lead);
        assert_eq!(names(tab.units.iter().copied()), want.units, "{}", tab.name);
    }
    for (tab, want) in tabs.list.iter().zip(listed) {
        assert_eq!(names(tab.sorted_units()), want.sorted_units, "{}", tab.name);
    }
    // the all tab's sortedUnits is table order
    assert_eq!(names(tabs.all.units.iter().copied()), all.sorted_units);
}
