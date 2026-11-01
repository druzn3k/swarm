//! The minimal view.

use swarm_data::GameData;

use crate::estimate::Estimate;
use crate::testutil::{g, u};
use crate::{Command, Engine, Event, ViewRequest};

#[test]
fn reads_counts_costs_and_achievements() {
    let mut e = Engine::new_game(GameData::embedded(), 1_000);
    let st = e.static_view();
    assert_eq!(st.units.len(), e.data().units().len());
    e.apply(Command::UiEvent {
        name: "konami".into(),
        params: serde_json::Value::Null,
    })
    .unwrap();
    let v = e.view(&ViewRequest {
        focus: vec![u("drone")],
    });
    assert_eq!(v.seq, 1);
    let meat = &v.units[u("meat").index()];
    assert!(meat.visible);
    assert_eq!(meat.count, e.count(u("meat")));
    let drone = &v.units[u("drone").index()];
    assert!(!drone.each_cost.is_empty());
    assert!(drone.stats.is_some());
    assert!(v.units[u("meat").index()].stats.is_none());
    assert_eq!(v.upgrades[g("expansion").index()].watched, 1);
    let konami = e.data().achievement_id("konami").unwrap();
    assert!(v.achievements[konami.index()].earned_at.is_some());
    assert!(v.events.contains(&Event::Achieved(konami)));
    assert!(e.drain_events().is_empty());
    let json = serde_json::to_string(&v).unwrap();
    assert!(json.contains("\"achieved\""));
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
    let e = crate::testutil::mkgame(&[]);
    let eff = e.data().upgrade(g("hatchery")).effects[1];
    assert_eq!(
        e.rand_seed_string(eff, swarm_num::Num::from(40)),
        "[0, hatchery, 40]"
    );
}
