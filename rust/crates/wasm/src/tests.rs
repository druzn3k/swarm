//! The JSON boundary, natively.

use serde_json::{json, Value};

use crate::core::{self, GameCore};

const SESSION_SAVES: &str = include_str!("../../../../engine/test/fixtures/session-saves.json");
const T0: f64 = 1_700_000_000_000.0;

fn fixture(name: &str) -> String {
    let all: Value = serde_json::from_str(SESSION_SAVES).unwrap();
    all[name].as_str().unwrap().to_owned()
}

fn parse(s: &str) -> Value {
    serde_json::from_str(s).unwrap()
}

fn unit_index(statics: &Value, name: &str) -> usize {
    statics["units"]
        .as_array()
        .unwrap()
        .iter()
        .position(|u| u["name"] == name)
        .unwrap()
}

#[test]
fn new_game_buy_advance_view_export() {
    let mut g = GameCore::new_game(T0).unwrap();
    assert_eq!(
        parse(&g.load_report()),
        json!({"format": "new", "warnings": [], "offline": null})
    );
    let statics = parse(&g.static_view());
    let meat = unit_index(&statics, "meat");
    let drone = unit_index(&statics, "drone");

    let out = parse(
        &g.apply(r#"{"do":"buy_unit","unit":"drone","amount":{"num":"1"},"ui":"test"}"#)
            .unwrap(),
    );
    assert_eq!(out["bought"], json!({"num": "1", "twinnum": "1"}));
    assert_eq!(out["commands"][0]["name"], "buyUnit");
    assert_eq!(out["commands"][0]["unit"], drone);
    assert_eq!(out["commands"][0]["unitname"], "drone");
    assert_eq!(out["commands"][0]["ui"], "test");

    let before = parse(&g.view("").unwrap());
    g.advance_ms(10_000.4);
    g.advance_ms(0.6); // the remainders add up to a whole millisecond
    g.advance_ms(-5.0);
    g.advance_ms(f64::NAN);
    let after = parse(&g.view("{}").unwrap());
    assert_eq!(
        after["now_ms"].as_i64().unwrap() - before["now_ms"].as_i64().unwrap(),
        10_001
    );
    assert_eq!(after["units"][drone]["count"], "1");
    let m0 = core::parse_num(before["units"][meat]["count"].as_str().unwrap()).unwrap();
    let m1 = core::parse_num(after["units"][meat]["count"].as_str().unwrap()).unwrap();
    assert!(m1 > m0, "{m1} > {m0}");
    // the buy's events were drained by the first view
    assert!(after.get("events").is_none());
    assert!(!before["events"].as_array().unwrap().is_empty());

    let save = g.export_v2(T0 + 20_000.0).unwrap();
    assert!(save.starts_with("SW2|"));
    assert_eq!(core::detect_save_format(&save), Some("v2"));
    let mut back = GameCore::load(&save, T0 + 20_000.0, None).unwrap();
    let report = parse(&back.load_report());
    assert_eq!(report["format"], "v2");
    let v = parse(&back.view("").unwrap());
    assert_eq!(v["units"][drone]["count"], "1");
}

#[test]
fn view_request_shapes_the_view() {
    let mut g = GameCore::new_game(T0).unwrap();
    let v = parse(
        &g.view(r#"{"focus":[1],"only_units":[0,1],"sections":{"units":true,"upgrades":false,"tabs":false,"achievements":false,"ascension":false,"statistics":false},"percents":[0.5]}"#)
            .unwrap(),
    );
    assert_eq!(v["units"].as_array().unwrap().len(), 2);
    assert!(v.get("upgrades").is_none());
    assert!(v["units"][1]["detail"].is_object());
    assert!(g
        .view("{not json")
        .unwrap_err()
        .starts_with("bad view request"));
}

#[test]
fn errors_carry_the_engine_message() {
    let mut g = GameCore::new_game(T0).unwrap();
    assert_eq!(
        g.apply(r#"{"do":"undo"}"#).unwrap_err(),
        "no undostate available"
    );
    assert_eq!(
        g.apply(r#"{"do":"buy_unit","unit":"nexus","amount":{"num":"1"}}"#)
            .unwrap_err(),
        "Cannot buy that unit"
    );
    assert_eq!(
        g.apply(r#"{"do":"buy_unit","unit":"nope","amount":{"num":"1"}}"#)
            .unwrap_err(),
        "no such unit: nope"
    );
    assert!(g
        .apply(r#"{"do":"fly"}"#)
        .unwrap_err()
        .starts_with("bad command"));
    // the failure is reported in the view's events too
    let v = parse(&g.view("").unwrap());
    assert!(v["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["command_failed"] == "Cannot buy that unit"));
    assert!(GameCore::new_game(f64::NAN).is_err());
    assert_eq!(
        GameCore::load("hello", T0, None).unwrap_err(),
        "not a Swarm Simulator save"
    );
}

#[test]
fn buy_all_outcome_lists_upgrade_ids() {
    let mut g = GameCore::new_game(T0).unwrap();
    assert_eq!(
        g.apply(r#"{"do":"buy_all_upgrades","percent":1,"which":{"explicit":["hatchery"]}}"#)
            .unwrap_err(),
        "We require more resources"
    );
    // a mid-game save can afford some
    let mut g = GameCore::load(&fixture("v1"), 2_000_000_000_000.0, None).unwrap();
    let out = parse(
        &g.apply(r#"{"do":"buy_all_upgrades","percent":1,"which":"autobuyable"}"#)
            .unwrap(),
    );
    let ids = out["upgrades"].as_array().unwrap();
    assert!(!ids.is_empty());
    assert!(ids.iter().all(Value::is_u64));
    assert!(out["commands"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["name"] == "buyMaxUpgrade" && c["upgrade"].is_u64()));
}

#[test]
fn load_v1_fixture_with_offline_report() {
    let text = fixture("v1");
    assert_eq!(core::detect_save_format(&text), Some("v1"));
    let mut g = GameCore::load(&text, 2_000_000_000_000.0, None).unwrap();
    let report = parse(&g.load_report());
    assert_eq!(report["format"], "v1");
    assert!(report["offline"]["closed_ms"].is_i64());
    assert_eq!(report["offline"]["resumed_ms"], 2_000_000_000_000_i64);
    let v = parse(&g.view("").unwrap());
    assert!(v["offline"].is_object());
}

#[test]
fn convert_v1_to_v2_and_back() {
    for name in ["v02", "v1", "whitespace"] {
        let v1 = fixture(name);
        let v2 = core::convert_save(&v1, "v2").unwrap();
        assert_eq!(core::detect_save_format(&v2), Some("v2"), "{name}");
        let a = swarm_save::decode_any(&v1).unwrap().state;
        let b = swarm_save::decode_any(&v2).unwrap().state;
        assert_eq!(a, b, "{name}");
        #[cfg(feature = "legacy-write")]
        {
            let again = core::convert_save(&v2, "v1").unwrap();
            assert_eq!(core::detect_save_format(&again), Some("v1"));
            assert_eq!(swarm_save::decode_any(&again).unwrap().state, a, "{name}");
        }
    }
    assert!(core::convert_save(&fixture("v1"), "v3").is_err());
    assert!(core::convert_save("junk", "v2").is_err());
    assert_eq!(core::detect_save_format("junk"), None);
}

#[cfg(feature = "legacy-write")]
#[test]
fn export_legacy_round_trips() {
    let mut g = GameCore::new_game(T0).unwrap();
    g.apply(r#"{"do":"buy_unit","unit":"drone","amount":{"input":"2"}}"#)
        .unwrap();
    let v1 = g.export_legacy(T0 + 1000.0).unwrap();
    assert_eq!(core::detect_save_format(&v1), Some("v1"));
    let mut back = GameCore::load(&v1, T0 + 1000.0, None).unwrap();
    let statics = parse(&back.static_view());
    let drone = unit_index(&statics, "drone");
    assert_eq!(parse(&back.view("").unwrap())["units"][drone]["count"], "2");
}

#[test]
fn resync_and_mark_closed() {
    let mut g = GameCore::new_game(T0).unwrap();
    assert_eq!(g.resync_wall(T0 + 1000.0).unwrap(), None);
    let r = parse(&g.resync_wall(T0 + 3_600_000.0).unwrap().unwrap());
    assert_eq!(r["resumed_ms"], (T0 + 3_600_000.0) as i64);
    g.mark_closed(T0 + 3_600_000.0).unwrap();
    let save = g.export_v2(T0 + 3_600_000.0).unwrap();
    let back = GameCore::load(&save, T0 + 7_200_000.0, None).unwrap();
    let report = parse(&back.load_report());
    assert_eq!(report["offline"]["closed_ms"], (T0 + 3_600_000.0) as i64);
}

#[test]
fn numbers() {
    let g = GameCore::new_game(T0).unwrap();
    assert_eq!(
        g.parse_number("1.5k", None).unwrap().as_deref(),
        Some("1500")
    );
    assert_eq!(
        g.parse_number("2 million", None).unwrap().as_deref(),
        Some("2000000")
    );
    assert_eq!(g.parse_number("abc", None).unwrap(), None);
    assert_eq!(g.parse_number("50%", None).unwrap(), None);
    assert!(g.parse_number("50%", Some("drone")).unwrap().is_some());
    assert!(g.parse_number("1", Some("nope")).is_err());
    assert_eq!(core::format_short_str("1234567").unwrap(), "1.23M");
    assert_eq!(core::format_long_str("1234567").unwrap(), "1.23456 million");
    assert_eq!(core::format_short_str("1.5e+400").unwrap(), "1.5e400");
    assert!(core::format_short_str("x").is_err());
}
