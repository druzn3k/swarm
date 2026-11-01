//! Format v2: round trips (xorshift property test), detection, and
//! v1 -> engine -> v2 -> engine.

mod common;

use common::*;
use serde_json::{json, Value};
use swarm_data::GameData;
use swarm_engine::state::{UnitStatistics, UpgradeStatistics, VersionInfo};
use swarm_engine::State;
use swarm_num::Num;
use swarm_save::{
    decode_any, decode_v2, detect, encode_v2, export_v2, legacy, load, load_legacy, Format,
    SaveError, V2Error,
};

fn rand_num(r: &mut Rng) -> Num {
    match r.below(6) {
        0 => Num::ZERO,
        1 => Num::from(r.range(0, 1_000_000)),
        2 => Num::from_f64(r.f64() * 1e6),
        _ => {
            let m = 1.0 + r.f64() * 9.0;
            let m = if r.chance(0.1) { -m } else { m };
            Num::new(m, r.range(-30, 100_000))
        }
    }
}

fn rand_name(r: &mut Rng) -> String {
    const NAMES: &[&str] = &[
        "meat",
        "larva",
        "drone",
        "queen",
        "nest",
        "hatchery",
        "nexus",
        "crystal",
        "mutagen",
        "ünknown-ünit",
        "a\"quote",
        "",
    ];
    NAMES[r.below(NAMES.len() as u64) as usize].to_owned()
}

fn rand_value(r: &mut Rng, depth: u32) -> Value {
    match r.below(if depth > 2 { 4 } else { 6 }) {
        0 => Value::Null,
        1 => Value::Bool(r.chance(0.5)),
        2 => Value::from(r.range(-1_000_000_000, 1_000_000_000)),
        3 => Value::from(rand_name(r)),
        4 => Value::Array((0..r.below(3)).map(|_| rand_value(r, depth + 1)).collect()),
        _ => Value::Object(
            (0..r.below(3))
                .map(|_| (rand_name(r), rand_value(r, depth + 1)))
                .collect(),
        ),
    }
}

/// A random mutation of a state. `legacy_safe` keeps it inside what the v1
/// format can hold (JS date range, a valid version, no `loaded`).
fn mutate(s: &mut State, r: &mut Rng, legacy_safe: bool) {
    let date = |r: &mut Rng| {
        if legacy_safe {
            r.range(-8_000_000_000_000_000, 8_000_000_000_000_000)
        } else {
            r.next() as i64
        }
    };
    match r.below(14) {
        0 => {
            s.units.insert(rand_name(r), rand_num(r));
        }
        1 => {
            s.upgrades.insert(rand_name(r), rand_num(r));
        }
        2 => {
            s.dates.started = date(r);
            s.dates.reified = date(r);
        }
        3 => {
            s.dates.restarted = r.chance(0.7).then(|| date(r));
            s.dates.saved = r.chance(0.7).then(|| date(r));
            s.dates.closed = r.chance(0.7).then(|| date(r));
            if !legacy_safe {
                s.dates.loaded = r.chance(0.5).then(|| date(r));
            }
        }
        4 => {
            let k = format!("other{}", r.below(3));
            s.dates.other.insert(k, date(r));
        }
        5 => {
            s.timers.insert(rand_name(r), date(r));
        }
        6 => s.skipped_ms = r.range(0, i64::MAX / 2),
        7 => {
            s.achievements.insert(rand_name(r), r.range(0, 1 << 50));
        }
        8 => {
            s.watched.insert(rand_name(r), r.range(-1, 1000) as i32);
        }
        9 => {
            s.statistics.clicks = r.below(1 << 40);
            s.statistics.by_unit.insert(
                rand_name(r),
                UnitStatistics {
                    clicks: r.below(1000),
                    num: rand_num(r),
                    twinnum: rand_num(r),
                    elapsed_first: r.chance(0.8).then(|| r.range(0, 1 << 40)),
                    ..Default::default()
                },
            );
        }
        10 => {
            s.statistics.by_upgrade.insert(
                rand_name(r),
                UpgradeStatistics {
                    clicks: r.below(1000),
                    num: rand_num(r),
                    elapsed_first: r.chance(0.8).then(|| r.range(0, 1 << 40)),
                    ..Default::default()
                },
            );
        }
        11 => {
            s.options.insert(rand_name(r), rand_value(r, 0));
        }
        12 => {
            if !legacy_safe {
                s.version = r.chance(0.8).then(|| VersionInfo {
                    started: r.chance(0.8).then(|| "1.0.15".into()),
                    saved: r.chance(0.5).then(|| "1.1.17".into()),
                });
            }
            s.kongregate = [None, Some(true), Some(false)][r.below(3) as usize];
        }
        _ => {
            let k = format!("unknown{}", r.below(4));
            s.unknown.insert(k, rand_value(r, 0));
        }
    }
}

#[test]
fn v2_round_trip_property() {
    let mut r = Rng(0x2545_F491_4F6C_DD1D);
    for case in 0..300 {
        let mut s = State::new(r.range(0, 2_000_000_000_000));
        for _ in 0..r.below(60) {
            mutate(&mut s, &mut r, false);
        }
        let enc = encode_v2(&s);
        assert!(enc.starts_with("SW2|"));
        let d = decode_v2(&enc).unwrap_or_else(|e| panic!("case {case}: {e}"));
        assert_eq!(d.state, s, "case {case}");
        assert_eq!(d.format, 2);
        assert!(d.warnings.is_empty());
        // and through decode_any, with line breaks
        let wrapped: String = enc
            .chars()
            .enumerate()
            .flat_map(|(i, c)| (i % 76 == 75).then_some('\n').into_iter().chain([c]))
            .collect();
        let any = decode_any(&wrapped).unwrap();
        assert_eq!(any.format, Format::V2);
        assert_eq!(any.state, s);
    }
}

#[cfg(feature = "legacy-write")]
#[test]
fn legacy_round_trip_property() {
    let mut r = Rng(0x9E37_79B9_7F4A_7C15);
    for case in 0..300 {
        let mut s = State::new(r.range(0, 2_000_000_000_000));
        s.dates.loaded = None;
        for _ in 0..r.below(60) {
            mutate(&mut s, &mut r, true);
        }
        let d = legacy::decode(&legacy::encode(&s)).unwrap_or_else(|e| panic!("case {case}: {e}"));
        assert_eq!(d.state, s, "case {case}");
    }
}

#[test]
fn detects_formats() {
    let v1 = session_save("v1");
    assert_eq!(detect(&v1), Some(Format::V1));
    assert_eq!(detect(&session_save("whitespace")), Some(Format::V1));
    let bare = v1.split_once('|').unwrap().1;
    assert_eq!(detect(bare), Some(Format::V1));
    let v2 = encode_v2(&State::new(0));
    assert_eq!(detect(&v2), Some(Format::V2));
    assert_eq!(detect(&format!("  {v2}")), Some(Format::V2));
    assert_eq!(detect("{\"format\":2}"), None);
    assert_eq!(detect(""), None);
    assert_eq!(decode_any("hello"), Err(SaveError::Unrecognized));
    assert_eq!(decode_any(&v1).unwrap().format, Format::V1);
    // publictest saves are still v1, and still refused
    assert!(matches!(
        decode_any(&session_save("publictestImported")),
        Err(SaveError::Legacy(_))
    ));
    // a v2 save is not a v1 save and vice versa
    assert_eq!(decode_v2(&v1), Err(V2Error::NotV2));
    assert!(legacy::decode(&v2).is_err());
}

#[test]
fn refuses_newer_formats() {
    let json = swarm_save::v2::to_json(&State::new(0)).replace("\"format\":2", "\"format\":3");
    let save = format!("SW2|{}", swarm_save::lz::compress_to_base64(&json));
    assert_eq!(decode_v2(&save), Err(V2Error::TooNew(3)));
    let save = format!("SW2|{}", swarm_save::lz::compress_to_base64("[1]"));
    assert!(matches!(decode_v2(&save), Err(V2Error::Json(_))));
    assert_eq!(decode_v2("SW2|"), Err(V2Error::Decompress));
}

#[test]
fn warns_about_other_data_schemas() {
    let json =
        swarm_save::v2::to_json(&State::new(0)).replace("\"data_schema\":1", "\"data_schema\":99");
    let d = swarm_save::v2::from_json(&json).unwrap();
    assert_eq!(d.data_schema, 99);
    assert_eq!(d.warnings.len(), 1);
}

#[test]
fn v2_json_layout() {
    let mut s = State::new(1000);
    s.units.insert("meat".into(), "253232.571".parse().unwrap());
    s.kongregate = Some(true);
    let v: Value = serde_json::from_str(&swarm_save::v2::to_json(&s)).unwrap();
    assert_eq!(v["format"], 2);
    assert_eq!(v["game_version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(v["units"]["meat"], "253232.571");
    assert_eq!(v["dates"]["started"], 1000);
    assert_eq!(v["flags"], json!({"kongregate": true}));
}

/// v1 -> Engine::load -> v2 -> Engine::load: the same counts.
#[test]
fn v1_to_engine_to_v2_and_back() {
    let data = GameData::embedded();
    for (name, save) in accepted_saves() {
        let decoded = legacy::decode(&save).unwrap();
        let wall = decoded.state.dates.reified + 3_600_000;
        let first = load_legacy(data, &save, wall, None).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(first.offline.is_some(), "{name}");
        let v2 = export_v2(&first.engine, wall);
        let second = load(data, &v2, wall, None).unwrap_or_else(|e| panic!("{name}: {e}"));
        for u in data.units() {
            assert_eq!(
                first.engine.count(u.id),
                second.engine.count(u.id),
                "{name}: {}",
                u.name
            );
        }
        let (mut a, mut b) = (first.engine.state().clone(), second.engine.state().clone());
        for s in [&mut a, &mut b] {
            s.dates.saved = None;
            s.dates.loaded = None;
            if let Some(v) = &mut s.version {
                v.saved = None;
            }
        }
        assert_eq!(a, b, "{name}");
        // and some units actually have counts
        let meat = data.unit_id("meat").unwrap();
        assert!(second.engine.count(meat) > Num::ZERO, "{name}");
    }
}

#[test]
fn load_merges_decoder_warnings() {
    let json = r#"{"unittypes":{"meat":"NaN"},"upgrades":{},
        "date":{"started":"2015-01-01T00:00:00.000Z","reified":"2015-01-01T00:00:00.000Z"},
        "version":{"started":"1.1.17"}}"#;
    let save = format!(
        "MS4xLjE3|{}{}",
        legacy::PREFIX,
        swarm_save::lz::compress_to_base64(json)
    );
    let out = load_legacy(
        GameData::embedded(),
        &save,
        1_420_070_500_000,
        Some(1_420_070_450_000),
    )
    .unwrap();
    assert!(out.warnings[0].contains("NaN"));
    let off = out.offline.unwrap();
    assert_eq!(off.closed_ms, 1_420_070_450_000);
}
