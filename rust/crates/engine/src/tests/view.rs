//! The view, the static view, welcome back, tutorial and undo window.

use swarm_data::{GameData, UnitId};
use swarm_num::Num;

use crate::command::Amount;
use crate::estimate::Estimate;
use crate::state::State;
use crate::testutil::{g, mkgame, n, u};
use crate::view::{Sections, UpgradeEta, ViewEvent};
use crate::{Command, Engine, StaticView, View, ViewRequest};

const T2020: i64 = 1_577_836_800_000;

fn data() -> &'static GameData {
    GameData::embedded()
}

fn buy_unit(name: &str, num: &str) -> Command {
    Command::BuyUnit {
        unit: name.into(),
        amount: Amount::Num(n(num)),
        ui: None,
    }
}

/// A mid-game save: past two ascensions, every tab open, upgrades and
/// empowers bought, loaded after 20 minutes away, then one purchase.
fn midgame() -> Engine {
    let mut e = Engine::new_game(data(), T2020);
    for (name, v) in [
        ("meat", "1e15"),
        ("larva", "1e7"),
        ("cocoon", "100"),
        ("territory", "1e6"),
        ("energy", "3000"),
        ("nexus", "3"),
        ("crystal", "50"),
        ("mutagen", "200"),
        ("premutagen", "20"),
        ("ascension", "2"),
        ("drone", "1e9"),
        ("queen", "1e7"),
        ("nest", "1e5"),
        ("greaterqueen", "1000"),
        ("hive", "10"),
        ("swarmling", "1e5"),
        ("stinger", "1000"),
        ("spider", "100"),
        ("nightbug", "10"),
        ("moth", "5"),
        ("bat", "3"),
        ("mutanthatchery", "5"),
        ("mutantmeat", "2"),
    ] {
        e.set_unit_count(u(name), n(v));
    }
    for (name, v) in [
        ("hatchery", "30"),
        ("expansion", "20"),
        ("droneprod", "3"),
        ("queenprod", "2"),
        ("swarmlingempower", "2"),
        ("stingerempower", "1"),
        ("nexus1", "1"),
        ("nexus2", "1"),
        ("nexus3", "1"),
        ("clonelarvae", "1"),
        ("larvarush", "1"),
        ("mutatehatchery", "1"),
        ("mutatemeat", "1"),
    ] {
        e.set_upgrade_count(g(name), n(v));
    }
    let mut state = e.state().clone();
    state.dates.closed = Some(T2020 + 60_000);
    let mut e = Engine::load(data(), state, T2020 + 21 * 60_000, None)
        .unwrap()
        .engine;
    e.apply(buy_unit("drone", "1000")).unwrap();
    e.set_now_ms(T2020 + 21 * 60_000 + 5_000).unwrap();
    e
}

fn full() -> ViewRequest {
    ViewRequest {
        detail_all: true,
        percents: vec![0.5, 0.1],
        sum_amounts: vec![n("1"), n("10")],
        ..ViewRequest::default()
    }
}

#[test]
fn every_section_is_populated_mid_game() {
    let mut e = midgame();
    let v = e.view(&full());
    let d = data();
    assert_eq!(v.seq, 1);
    assert_eq!(v.now_ms, T2020 + 21 * 60_000 + 5_000);
    assert_eq!(v.started_ms, T2020);
    assert_eq!(v.elapsed_ms, 21 * 60_000 + 5_000);

    // units: index-aligned, all fields
    assert_eq!(v.units.len(), d.units().len());
    for (i, uv) in v.units.iter().enumerate() {
        assert_eq!(uv.id as usize, i);
        assert_eq!(uv.max_cost_met_at.len(), 2);
    }
    let drone = &v.units[u("drone").index()];
    assert_eq!(drone.count, e.count(u("drone")));
    assert!(drone.visible && drone.buyable && drone.cost_met);
    assert!(drone.velocity.is_positive());
    assert!(!drone.each_cost.is_empty());
    let dd = drone.detail.as_ref().unwrap();
    assert!(!dd.stats.is_empty());
    assert!(!dd.each_production.is_empty());
    assert!(dd.spent.is_positive());
    assert_eq!(dd.eta, Some(Estimate::Reached));
    let energy = &v.units[u("energy").index()];
    assert!(energy.cap.is_some() && energy.cap_percent.is_some());
    assert!(energy.detail.as_ref().unwrap().cap_eta.is_some());
    let swarmling = &v.units[u("swarmling").index()];
    assert_eq!(swarmling.suffix, "III");
    let bat = &v.units[u("bat").index()];
    let bat_effect = &bat.detail.as_ref().unwrap().effects[0];
    assert!(!bat_effect.stats.is_empty(), "bat's power stat");

    // upgrades: costs, sums, estimates, effect outputs
    assert_eq!(v.upgrades.len(), d.upgrades().len());
    let hatchery = &v.upgrades[g("hatchery").index()];
    assert_eq!(hatchery.count, n("30"));
    assert!(hatchery.visible);
    assert_eq!(hatchery.sum_costs.len(), 2);
    assert_eq!(hatchery.sum_costs[0], hatchery.total_cost);
    let hd = hatchery.detail.as_ref().unwrap();
    assert!(hd.effects.iter().any(|ef| !ef.stats.is_empty()));
    let rush = v.upgrades[g("larvarush").index()].detail.as_ref().unwrap();
    assert!(rush.effects[0].output.unwrap().is_positive());
    assert!(hd.effects.iter().any(|ef| ef.rand_next.is_some()));
    assert!(hd.effects.iter().any(|ef| ef.timer_remaining_ms.is_some()));
    let clone = &v.upgrades[g("clonelarvae").index()];
    let cd = clone.detail.as_ref().unwrap();
    assert!(cd.effects[0].bank.is_some() && cd.effects[0].cap.is_some());
    assert!(v
        .upgrades
        .iter()
        .filter_map(|g| g.detail.as_ref())
        .any(|d| matches!(d.eta, UpgradeEta::Wait { .. })));
    assert!(!v.buy_all.is_empty());

    // tabs
    assert_eq!(v.tabs.len(), d.tabs().list.len());
    assert!(v.tabs.iter().all(|t| t.visible && !t.units.is_empty()));
    assert!(!v.all_tab.is_empty());

    let a = v.achievements.as_ref().unwrap();
    assert_eq!(a.list.len(), d.achievements().len());
    assert!(a.points > 0 && a.earned > 0 && a.percent > 0.0);
    assert!(a.list.iter().any(|x| x.progress_max.is_some()));

    let asc = v.ascension.as_ref().unwrap();
    assert_eq!(asc.ascensions, n("2"));
    assert_eq!(asc.premutagen, n("20"));
    assert!(asc.cost.is_positive() && asc.respec_cost.is_positive());
    assert!(asc.respec_spent.is_positive());
    assert!(!asc.can_ascend);

    let st = v.statistics.as_ref().unwrap();
    assert!(st.units.iter().any(|s| s.id == u("drone").0));

    let undo = v.undo.unwrap();
    assert!(undo.undoable);
    assert_eq!(undo.secs_left, 25);
    assert_eq!(v.tutorial_step, 0, "no tutorial after ascending");
    let wb = v.welcome_back.as_ref().unwrap();
    assert_eq!(wb.away_ms, 20 * 60_000);
    assert!(!wb.gains.is_empty());
    assert!(v.offline.is_some());
    assert!(v
        .events
        .iter()
        .any(|ev| matches!(ev, ViewEvent::Command { name, .. } if name == "buyUnit")));
    assert!(v.events.contains(&ViewEvent::SaveRequested));
}

/// Everything but the counter and the drained events.
fn strip(mut v: View) -> View {
    v.seq = 0;
    v.events.clear();
    v
}

#[test]
fn view_is_read_only() {
    let mut e = midgame();
    let state = e.state().clone();
    let exported = e.exported_state().clone();
    let undo = e.undo_state().cloned();
    let (now, reified, diff) = (e.now_ms(), e.reified_ms(), e.diff_seconds());
    let v1 = e.view(&full());
    assert_eq!(e.state(), &state);
    assert_eq!(e.exported_state(), &exported);
    assert_eq!(e.undo_state().cloned(), undo);
    assert_eq!(
        (e.now_ms(), e.reified_ms(), e.diff_seconds()),
        (now, reified, diff)
    );
    // and idempotent: a second view at the same time sees the same game
    let v2 = e.view(&full());
    assert_eq!(v2.seq, 2);
    assert!(v2.events.is_empty());
    assert_eq!(strip(v1), strip(v2));
    // a view doesn't change what the next command does
    let mut other = midgame();
    e.apply(Command::BuyAllUpgrades {
        percent: 1.0,
        which: crate::UpgradeSet::Autobuyable,
    })
    .unwrap();
    other
        .apply(Command::BuyAllUpgrades {
            percent: 1.0,
            which: crate::UpgradeSet::Autobuyable,
        })
        .unwrap();
    assert_eq!(e.state(), other.state());
}

#[test]
fn request_filters_sections_and_scope() {
    let mut e = midgame();
    let none = e.view(&ViewRequest {
        sections: Sections::NONE,
        ..ViewRequest::default()
    });
    assert!(none.units.is_empty() && none.upgrades.is_empty() && none.tabs.is_empty());
    assert!(none.buy_all.is_empty() && none.all_tab.is_empty());
    assert!(none.achievements.is_none() && none.ascension.is_none() && none.statistics.is_none());
    // the cheap global parts are always there
    assert!(none.undo.is_some() && none.welcome_back.is_some());

    // default: no details, only the always-on percents
    let def = e.view(&ViewRequest::default());
    assert!(def
        .units
        .iter()
        .all(|x| x.detail.is_none() && x.max_cost_met_at.is_empty()));
    assert!(def
        .upgrades
        .iter()
        .all(|x| x.detail.is_none() && x.sum_costs.is_empty()));

    // one tab, one focused unit
    let d = data();
    let meat_tab = d.tabs().by_name("meat").unwrap();
    let req = ViewRequest {
        percents: vec![0.5],
        ..ViewRequest::for_tab(d, meat_tab, vec![u("queen")])
    };
    let v = e.view(&req);
    let tab_units: Vec<u16> = d.tabs().get(meat_tab).units.iter().map(|x| x.0).collect();
    let mut ids: Vec<u16> = v.units.iter().map(|x| x.id).collect();
    ids.sort();
    let mut want = tab_units.clone();
    want.sort();
    assert_eq!(ids, want);
    assert!(v.statistics.is_none() && v.achievements.is_some());
    for x in &v.units {
        assert_eq!(x.detail.is_some(), x.id == u("queen").0, "unit {}", x.id);
        assert_eq!(x.max_cost_met_at.len(), 1);
    }
    for x in &v.upgrades {
        assert!(tab_units.iter().any(|&t| d
            .unit(UnitId(t))
            .upgrades
            .contains(&swarm_data::UpgradeId(x.id))));
        let listed_with_queen = d
            .unit(u("queen"))
            .upgrades
            .contains(&swarm_data::UpgradeId(x.id));
        assert_eq!(
            x.detail.is_some(),
            listed_with_queen && x.visible,
            "upgrade {}",
            x.id
        );
    }
    assert!(v.upgrades.iter().any(|x| x.id == g("queenprod").0));
    assert!(!v.upgrades.iter().any(|x| x.id == g("swarmlingtwin").0));

    // bad ids are ignored
    let v = e.view(&ViewRequest {
        focus: vec![UnitId(9999)],
        only_units: Some(vec![UnitId(9999), u("meat")]),
        ..ViewRequest::default()
    });
    assert_eq!(v.units.len(), 1);
}

#[test]
fn tabs_sort_like_ts_sort_units() {
    let mut e = midgame();
    let v = e.view(&ViewRequest::default());
    let d = data();
    let territory = d.tabs().by_name("territory").unwrap();
    // sortedUnits is the table order reversed; sortUnits stable-sorts it by
    // -empower: swarmling (empower 2), stinger (1), then the rest
    let names = [
        "swarmling",
        "stinger",
        "goon",
        "devourer",
        "wasp",
        "centipede",
        "giantspider",
        "roach",
        "locust",
        "mosquito",
        "spider",
        "territory",
    ];
    let want: Vec<UnitId> = names.iter().map(|x| u(x)).collect();
    assert_eq!(e.sorted_tab_units(territory), want);
    let visible: Vec<u16> = want
        .iter()
        .filter(|&&x| e.unit_visible(x))
        .map(|x| x.0)
        .collect();
    assert_eq!(v.tabs[territory.index()].units, visible);
    assert_eq!(&visible[..2], &[u("swarmling").0, u("stinger").0]);
    // no empower: plain reverse table order, meat last
    let meat = d.tabs().by_name("meat").unwrap();
    let meat_units = &v.tabs[meat.index()].units;
    assert_eq!(*meat_units.last().unwrap(), u("meat").0);
    assert!(meat_units.windows(2).all(|w| w[0] > w[1]));
    // the all tab keeps table order
    assert_eq!(v.all_tab[0], u("meat").0);
}

#[test]
fn welcome_back_by_hand() {
    let d = data();
    let drone_prod = d.unit(u("drone")).prod[0];
    assert_eq!((drone_prod.unit, drone_prod.val), (u("meat"), Num::ONE));
    // 10 drones, each making 1 meat/s; reified at 0, closed at 300 s, back
    // at 900 s: 600 s of 10 meat/s
    let mut state = State::with_units(0, [("drone", n("10"))]);
    state.dates.closed = Some(300_000);
    let out = Engine::load(d, state.clone(), 900_000, None).unwrap();
    let mut e = out.engine;
    let wb = e.welcome_back().cloned().unwrap();
    assert_eq!(wb.away_ms, 600_000);
    assert_eq!(wb.closed_ms, 300_000);
    assert_eq!(wb.gains.len(), 1);
    assert_eq!(wb.gains[0].unit_id(), u("meat"));
    assert_eq!(wb.gains[0].val, n("6000"));
    // meat is the only producing unit; then every tab's lead
    let leads: Vec<UnitId> = d.tabs().list.iter().map(|t| t.lead).collect();
    assert_eq!(e.interesting_units(), leads);
    assert_eq!(e.view(&ViewRequest::default()).welcome_back, Some(wb));
    e.apply(Command::DismissWelcomeBack).unwrap();
    assert!(e.welcome_back().is_none());
    assert!(e.view(&ViewRequest::default()).welcome_back.is_none());

    // a heartbeat at 600 s: 300 s away
    let e = Engine::load(d, state.clone(), 900_000, Some(600_000))
        .unwrap()
        .engine;
    assert_eq!(e.welcome_back().unwrap().gains[0].val, n("3000"));

    // under 3 minutes: nothing, unless forced
    let e = Engine::load(d, state, 900_000, Some(800_000))
        .unwrap()
        .engine;
    assert!(e.offline().is_some());
    assert!(e.welcome_back().is_none());
    let forced = e.compute_welcome_back(800_000, true).unwrap();
    assert_eq!(forced.away_ms, 100_000);
    assert_eq!(forced.gains[0].val, n("1000"));
}

#[test]
fn tutorial_steps_follow_tutorial_ts() {
    let step = |units: &[(&str, &str)], upgrades: &[(&str, &str)], spawned: &[&str]| {
        let mut e = mkgame(units);
        for &(name, v) in upgrades {
            e.set_upgrade_count(g(name), n(v));
        }
        for &name in spawned {
            e.rt.first_spawn.insert(u(name), 0);
        }
        e.tutorial_step()
    };
    assert_eq!(step(&[], &[], &[]), 1);
    assert_eq!(step(&[("drone", "1")], &[], &[]), 2);
    assert_eq!(step(&[("drone", "10")], &[], &[]), 3);
    assert_eq!(step(&[("drone", "10"), ("meat", "300")], &[], &[]), 11);
    assert_eq!(step(&[("drone", "10")], &[("hatchery", "1")], &[]), 4);
    assert_eq!(step(&[("drone", "1")], &[("hatchery", "1")], &[]), 2);
    assert_eq!(step(&[("queen", "1")], &[("hatchery", "1")], &[]), 5);
    assert_eq!(step(&[("queen", "5")], &[("hatchery", "1")], &[]), 6);
    let q = [("queen", "5"), ("territory", "1")];
    assert_eq!(step(&q, &[("hatchery", "1")], &[]), 7);
    let q = [("queen", "5"), ("territory", "6")];
    assert_eq!(step(&q, &[("hatchery", "1")], &[]), 8);
    assert_eq!(step(&q, &[("hatchery", "1"), ("expansion", "1")], &[]), 9);
    assert_eq!(step(&q, &[("expansion", "5")], &[]), 0);
    assert_eq!(step(&q, &[("expansion", "5")], &["premutagen"]), 10);
    assert_eq!(step(&[("ascension", "1")], &[], &["premutagen"]), 0);
    assert_eq!(step(&[("ascension", "1")], &[], &["ascension"]), 100);
    // in the view
    let mut e = Engine::new_game(data(), T2020);
    assert_eq!(e.view(&ViewRequest::default()).tutorial_step, 1);
}

#[test]
fn undo_window_follows_progression_ts() {
    let mut e = Engine::new_game(data(), T2020);
    assert!(e.undo_window().is_none());
    e.set_unit_count(u("meat"), n("1000"));
    e.apply(buy_unit("drone", "1")).unwrap();
    let w = e.undo_window().unwrap();
    assert!(w.undoable && !w.is_redo);
    assert_eq!(w.secs_left, 30);
    e.set_now_ms(T2020 + 10_400).unwrap();
    assert_eq!(e.undo_window().unwrap().secs_left, 20); // Math.round(19.6)
    e.set_now_ms(T2020 + 29_900).unwrap();
    assert!(e.is_undoable());
    e.set_now_ms(T2020 + 30_000).unwrap();
    let w = e.view(&ViewRequest::default()).undo.unwrap();
    assert!(!w.undoable);
    assert_eq!((w.secs_since, w.secs_left), (30.0, 0));
    e.apply(buy_unit("drone", "1")).unwrap();
    e.apply(Command::Undo).unwrap();
    let w = e.undo_window().unwrap();
    assert!(w.is_redo && !w.undoable && w.secs_left == 0);
}

#[test]
fn serde_round_trips() {
    let mut e = midgame();
    let v = e.view(&full());
    let json = serde_json::to_string(&v).unwrap();
    let back: View = serde_json::from_str(&json).unwrap();
    // NaN estimates break PartialEq, so compare the JSON (serde_json's
    // default float parsing may be an ulp off)
    let again = serde_json::to_string(&back).unwrap();
    assert_json_close(
        &serde_json::from_str(&json).unwrap(),
        &serde_json::from_str(&again).unwrap(),
    );

    let st = e.static_view();
    let json = serde_json::to_string(&st).unwrap();
    let back: StaticView = serde_json::from_str(&json).unwrap();
    // Num's wire form has 15 digits, so compare the JSON (a few data
    // values parse back an ulp off)
    assert_eq!(serde_json::to_string(&back).unwrap(), json);
    assert_eq!(back.tabs, st.tabs);
    assert_eq!(back.stats, st.stats);

    let req = full();
    let back: ViewRequest = serde_json::from_str(&serde_json::to_string(&req).unwrap()).unwrap();
    assert_eq!(back, req);
    let partial: ViewRequest = serde_json::from_str(r#"{"focus":[14]}"#).unwrap();
    assert_eq!(partial.focus, vec![UnitId(14)]);
    assert_eq!(partial.sections, Sections::ALL);

    for est in [Estimate::Reached, Estimate::Never, Estimate::Secs(1.5)] {
        let s = serde_json::to_string(&est).unwrap();
        assert_eq!(serde_json::from_str::<Estimate>(&s).unwrap(), est);
    }
    assert!(serde_json::from_str::<Estimate>(r#"{"secs":null}"#)
        .unwrap()
        .secs()
        .is_nan());
}

fn assert_json_close(a: &serde_json::Value, b: &serde_json::Value) {
    use serde_json::Value;
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            assert!((x - y).abs() <= x.abs() * 1e-15, "{x} != {y}");
        }
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len());
            x.iter().zip(y).for_each(|(x, y)| assert_json_close(x, y));
        }
        (Value::Object(x), Value::Object(y)) => {
            assert_eq!(x.len(), y.len());
            for (k, v) in x {
                assert_json_close(v, &y[k]);
            }
        }
        _ => assert_eq!(a, b),
    }
}

#[test]
fn view_size_mid_game() {
    let mut e = midgame();
    let plain = serde_json::to_string(&e.view(&ViewRequest::default())).unwrap();
    let detailed = serde_json::to_string(&e.view(&full())).unwrap();
    let static_json = serde_json::to_string(&e.static_view()).unwrap();
    eprintln!(
        "view JSON: default {} B, full detail {} B; static {} B",
        plain.len(),
        detailed.len(),
        static_json.len()
    );
    assert!(plain.len() < 48 * 1024);
    assert!(detailed.len() < 64 * 1024);
}

#[test]
fn static_view_lists_everything() {
    let e = mkgame(&[]);
    let st = e.static_view();
    let d = data();
    assert_eq!(st.units.len(), d.units().len());
    assert_eq!(st.upgrades.len(), d.upgrades().len());
    assert_eq!(st.achievements.len(), d.achievements().len());
    assert_eq!(st.effects.len(), d.effects().len());
    assert_eq!(st.tabs.len(), d.tabs().list.len());
    let drone = &st.units[u("drone").index()];
    assert_eq!(drone.name, "drone");
    assert_eq!(
        drone.tab,
        d.tabs().by_name("meat").map(|t| t.index() as u16)
    );
    assert!(st.upgrades[g("larvarush").index()].ability);
    assert_eq!(st.undo_limit_secs, 30.0);
}

#[test]
fn estimates_serialize() {
    let s = |e: Estimate| serde_json::to_string(&e).unwrap();
    assert_eq!(s(Estimate::Reached), r#"{"reached":true}"#);
    assert_eq!(s(Estimate::Secs(12.5)), r#"{"secs":12.5}"#);
    assert_eq!(s(Estimate::Never), r#"{"never":true}"#);
}

#[test]
fn rand_seed_strings() {
    let e = mkgame(&[]);
    let eff = e.data().upgrade(g("hatchery")).effects[1];
    assert_eq!(e.rand_seed_string(eff, Num::from(40)), "[0, hatchery, 40]");
}

#[test]
fn ui_events_reach_the_view() {
    let mut e = Engine::new_game(data(), 1_000);
    e.apply(Command::UiEvent {
        name: "konami".into(),
        params: serde_json::Value::Null,
    })
    .unwrap();
    let v = e.view(&ViewRequest::default());
    let konami = data().achievement_id("konami").unwrap();
    assert!(v.achievements.unwrap().list[konami.index()]
        .earned_at
        .is_some());
    assert!(v.events.contains(&ViewEvent::Achieved(konami.0)));
    assert!(e.drain_events().is_empty());
    let json = serde_json::to_string(&e.view(&ViewRequest::default())).unwrap();
    assert!(json.contains("\"tutorial_step\":1"));
}

#[test]
fn live_descriptions_render() {
    let mut e = midgame();
    let d = data();
    let mut seen = 0;
    for unit in d.units() {
        let text = e.unit_description(unit.id);
        assert!(!text.contains("{{"), "{}: {text}", unit.name);
        seen += usize::from(!text.is_empty());
    }
    for up in d.upgrades() {
        let text = e.upgrade_description(up.id);
        assert!(!text.contains("{{"), "{}: {text}", up.name);
        seen += usize::from(!text.is_empty());
    }
    assert!(seen > 100);
    let up = |name: &str| e.upgrade_description(g(name));
    assert!(
        up("larvarush").starts_with("Instantly give birth to ")
            && up("larvarush").ends_with(" new larvae."),
        "{}",
        up("larvarush")
    );
    assert_eq!(
        up("swarmlingempower"),
        "Dramatically increase both your swarmlings' meat cost and territory captured.\n\
         This will destroy all 100 thousand of your swarmlings."
    );
    let hatchery = up("hatchery");
    assert!(
        hatchery.starts_with("Each hatchery produces 1 more larvae per second."),
        "{hatchery}"
    );
    assert!(hatchery.contains("crystals."), "{hatchery}");
    let clone = up("clonelarvae");
    assert!(clone.contains("available to clone."), "{clone}");
    let army = up("clonearmy");
    assert!(
        army.contains("Create ") && army.contains(" swarmlings."),
        "{army}"
    );
    let meat = e.unit_description(u("mutantmeat"));
    assert!(meat.starts_with("Drones are "), "{meat}");
    let bat = e.unit_description(u("bat"));
    assert!(bat.contains("more powerful"), "{bat}");
    assert_eq!(
        e.unit_description(u("drone")),
        d.unit(u("drone")).text.description.clone().unwrap()
    );

    // the view: templates once, rendered text for detailed items only
    for name in [
        "hatchery",
        "clonearmy",
        "swarmwarp",
        "expansion",
        "achievementbonus",
    ] {
        eprintln!("{name}: {}", up(name));
    }
    for name in [
        "cocoon",
        "crystal",
        "mutantfreq",
        "mutantnexus",
        "mutanthatchery",
        "nightbug",
    ] {
        eprintln!("{name}: {}", e.unit_description(u(name)));
    }
    let rush_text = up("larvarush");
    let st = e.static_view();
    assert!(st.upgrades[g("larvarush").index()]
        .description_template
        .is_some());
    assert!(st.upgrades[g("droneprod").index()]
        .description_template
        .is_none());
    let v = e.view(&full());
    let rush = v.upgrades[g("larvarush").index()].detail.as_ref().unwrap();
    assert_eq!(rush.description.as_deref(), Some(rush_text.as_str()));
    let plain = e.view(&ViewRequest::default());
    assert!(plain.upgrades[g("larvarush").index()].detail.is_none());
}

#[test]
fn resync_wall_sets_the_welcome_back_cache_neutrally() {
    let d = data();
    let state = State::with_units(0, [("drone", n("10"))]);
    let mut e = Engine::load(d, state.clone(), 0, None).unwrap().engine;
    let mut plain = Engine::load(d, state, 0, None).unwrap().engine;
    assert!(e.welcome_back().is_none());
    // a short suspend: caught up, nothing to show
    let r = e.resync_wall(60_000).unwrap();
    assert_eq!(r.away_ms(), 60_000);
    assert!(e.welcome_back().is_none() && e.offline().is_none());
    // ten minutes: 10 drones made 6000 meat
    let r = e.resync_wall(660_000).unwrap();
    let wb = e.welcome_back().cloned().unwrap();
    assert_eq!(e.offline(), Some(r));
    assert_eq!((wb.away_ms, wb.closed_ms), (600_000, 60_000));
    assert_eq!(wb.gains[0].unit_id(), u("meat"));
    assert_eq!(wb.gains[0].val, n("6000"));
    assert_eq!(
        e.view(&ViewRequest::default()).welcome_back,
        Some(wb.clone())
    );
    // the same as computing it by hand
    assert_eq!(e.compute_welcome_back(60_000, false), Some(wb));
    // cache-neutral: the memos are those of a plain clock move
    let mut e2 = Engine::load(d, State::with_units(0, [("drone", n("10"))]), 0, None)
        .unwrap()
        .engine;
    e2.resync_wall(60_000);
    e2.resync_wall(660_000);
    plain.set_now_ms(60_000).unwrap();
    plain.set_now_ms(660_000).unwrap();
    let memo = |e: &Engine| {
        let c = e.cache.borrow();
        format!("{:?} {:?} {:?}", c.stats, c.count, c.velocity)
    };
    assert_eq!(memo(&e2), memo(&plain));
    e.apply(Command::DismissWelcomeBack).unwrap();
    assert!(e.welcome_back().is_none());
}
