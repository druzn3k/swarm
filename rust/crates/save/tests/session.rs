//! Port of `engine/test/session.test.ts` (and the Coffee session spec) for
//! the legacy reader and writer.

mod common;

use common::*;
use swarm_engine::state::DEFAULT_VERSION;
use swarm_num::Num;
use swarm_save::legacy::{self, validate_save_version, LegacyError, VersionError};

#[test]
fn validates_the_save_version_programmatically() {
    let v =
        |a: Option<&str>, b: Option<&str>| validate_save_version(a, b.unwrap_or(DEFAULT_VERSION));
    let ok = |a, b| assert_eq!(v(a, b), Ok(()), "{a:?} into {b:?}");
    let err = |a, b| assert!(v(a, b).is_err(), "{a:?} into {b:?} should fail");
    ok(Some("0.1.0"), Some("0.1.0"));
    ok(Some("0.1.0"), Some("0.1.30"));
    ok(Some("0.1.30"), Some("0.1.0"));
    err(Some("0.1.30"), Some("0.2.0"));
    err(Some("0.2.30"), Some("0.3.0"));
    err(Some("0.2.0"), Some("0.1.30"));
    err(Some("0.3.0"), Some("0.2.30"));
    ok(Some("0.2.30"), Some("0.2.0"));
    ok(Some("0.2.0"), Some("0.2.0"));
    ok(Some("1.0.0"), Some("1.0.0"));
    ok(Some("0.9.0"), Some("1.0.0"));
    err(Some("1.0.0"), Some("0.9.0"));
    err(Some("0.1.0"), Some("1.0.0"));
    ok(Some("1.9.0"), Some("1.0.0"));
    ok(Some("1.0.0"), Some("1.9.0"));
    ok(Some("2.0.0"), Some("1.0.0"));
    ok(Some("1.0.0"), Some("2.0.0"));
    ok(None, Some("0.1.0"));
    err(None, Some("0.2.0"));
    err(Some("0.1.0"), None);
    ok(Some("0.2.0"), None);
    ok(Some("1.0.0"), None);
    err(None, None);
    for p in [
        "1.0.0-publictest1",
        "1.0.0-publictest8",
        "1.0.0-publictest20",
    ] {
        assert_eq!(v(Some(p), None), Err(VersionError::Blacklisted));
    }
    // the TS messages
    assert_eq!(
        v(Some("0.1.30"), Some("0.2.0")).unwrap_err().to_string(),
        "Beta save from different minor version"
    );
    assert_eq!(
        v(Some("1.0.0"), Some("0.9.0")).unwrap_err().to_string(),
        "1.0 save in 0.x game"
    );
    assert_eq!(
        v(None, None).unwrap_err().to_string(),
        "nice try, no 0.1.x saves"
    );
}

#[test]
fn validates_the_format_version_on_import_blocking_all_publictest_imports() {
    let v02 = legacy::decode(&session_save("v02")).unwrap();
    assert_eq!(v02.format_version.as_deref(), Some("0.2.22"));
    let v1 = legacy::decode(&session_save("v1")).unwrap();
    assert_eq!(v1.format_version.as_deref(), Some("1.0.0"));
    // publictestCreated: version.started is a publictest build
    assert_eq!(
        legacy::decode(&session_save("publictestCreated")),
        Err(LegacyError::SaveVersion(VersionError::Blacklisted))
    );
    // imported/broken: a fine version.started, but a publictest header
    for name in ["publictestImported", "publictestBroken"] {
        assert_eq!(
            legacy::decode(&session_save(name)),
            Err(LegacyError::FormatVersion(VersionError::Blacklisted)),
            "{name}"
        );
    }
}

#[test]
fn ignores_whitespace() {
    let ws = session_save("whitespace");
    assert!(ws.contains('\n'));
    let d = legacy::decode(&ws).unwrap();
    assert_eq!(d.format_version.as_deref(), Some("1.0.48"));
    assert_eq!(d.state.units["ascension"], Num::from(9));
    assert_eq!(d.state.upgrades.len(), 87);
    assert_eq!(d.state.achievements.len(), 93);
    // legacy booleans
    assert_eq!(d.state.watched["dronetwin"], 0);
    assert_eq!(d.state.skipped_ms, 1_045_470_841_408);
    assert!(d.state.unknown.contains_key("achievementsShown"));
}

#[test]
fn reads_v1_fields() {
    let d = legacy::decode(&session_save("v1")).unwrap();
    let s = &d.state;
    assert_eq!(s.units["meat"], "253232.571".parse().unwrap());
    assert_eq!(s.units["drone"], Num::from(17));
    assert_eq!(s.dates.started, 1_423_614_499_372); // 2015-02-11T00:28:19.372Z
    assert_eq!(s.dates.reified, 1_423_629_456_026);
    assert_eq!(s.dates.saved, Some(1_423_629_456_143));
    assert_eq!(s.dates.loaded, None);
    assert_eq!(s.achievements["drone1"], 29403);
    assert_eq!(s.statistics.clicks, 3);
    assert_eq!(s.statistics.by_unit["drone"].twinnum, Num::from(17));
    assert_eq!(s.statistics.by_unit["drone"].elapsed_first, Some(29403));
    assert_eq!(
        s.version.as_ref().unwrap().started.as_deref(),
        Some("1.0.0")
    );
    assert_eq!(s.unknown["id"], "v0.2");
    assert!(d.warnings.is_empty(), "{:?}", d.warnings);
}

#[test]
fn reads_timers_and_numeric_watch_levels() {
    let p = persist();
    let nests = &p["exports"][1];
    let d = legacy::decode(nests["export_"].as_str().unwrap()).unwrap();
    assert_eq!(d.format_version.as_deref(), Some("1.1.14"));
    let s = &d.state;
    // 2022-12-13T20:22:33.149Z
    assert_eq!(s.timers["crystal"], 1_670_962_953_149);
    assert!(!s.dates.other.contains_key("addUnitTimed-crystal"));
    assert_eq!(s.watched["dronetwin"], -1);
    assert_eq!(s.watched["queenprod"], 2);
    assert_eq!(
        s.units["meat"],
        "1.1562356659316217338e+21".parse().unwrap()
    );
}

#[test]
fn reads_js_number_counts_with_to_precision_15() {
    // a hand-made save with JS-number counts, as the oldest saves had
    let json = r#"{"unittypes":{"meat":0.30000000000000004,"drone":1e39},"upgrades":{"x":"NaN"},
        "date":{"started":"2015-01-01T00:00:00.000Z","reified":1420070400000},
        "version":{"started":"1.0.0"},"watched":{"a":true}}"#;
    let save = format!(
        "{}{}",
        legacy::PREFIX,
        swarm_save::lz::compress_to_base64(json)
    );
    let d = legacy::decode(&save).unwrap();
    assert_eq!(d.format_version, None);
    assert_eq!(d.state.units["meat"].to_string(), "0.3");
    assert_eq!(d.state.units["drone"], Num::new(1.0, 39));
    assert_eq!(d.state.upgrades["x"], Num::ZERO);
    assert_eq!(d.state.watched["a"], 1);
    assert_eq!(d.state.dates.reified, 1_420_070_400_000);
    assert_eq!(d.warnings.len(), 1, "{:?}", d.warnings);
}

#[test]
fn rejects_garbage() {
    assert!(legacy::decode("").is_err());
    assert!(legacy::decode("MS4wLjA=|Q2hlYXRlciA6KAoK!!!!").is_err());
    // persist.test.json "null" body
    let p = persist();
    let null = p["format"][0]["export_"].as_str().unwrap();
    assert!(matches!(legacy::decode(null), Err(LegacyError::Shape(_))));
    // a bad header
    let v1 = session_save("v1");
    let bad = format!("M!S4wLjA={}", &v1[8..]);
    assert!(matches!(legacy::decode(&bad), Err(LegacyError::Header(_))));
}

#[cfg(feature = "legacy-write")]
mod write {
    use super::*;
    use serde_json::Value;
    use swarm_engine::State;
    use swarm_save::prepare_save;

    fn body_json(save: &str) -> Value {
        let body = save.split('|').nth(1).unwrap();
        let json = swarm_save::lz::decompress_from_base64(&body[legacy::PREFIX.len()..]).unwrap();
        serde_json::from_str(&json).unwrap()
    }

    #[test]
    fn encodes_the_ts_header() {
        let s = State::new(1_577_836_800_000);
        let enc = legacy::encode(&s);
        let (v, body) = enc.split_once('|').unwrap();
        assert_eq!(v, "MS4xLjE3"); // btoa("1.1.17")
        assert!(body.starts_with("Q2hlYXRlciA6KAoK"));
        let j = body_json(&enc);
        assert_eq!(j["date"]["started"], "2020-01-01T00:00:00.000Z");
        assert!(j["date"].get("loaded").is_none());
        let keys: Vec<&str> = j.as_object().unwrap().keys().map(String::as_str).collect();
        // serde_json sorts keys when parsing; check the raw text order instead
        assert!(keys.contains(&"skippedMillis"));
        let text = legacy::to_legacy_json(&s);
        assert!(text.starts_with(
            r#"{"unittypes":{},"date":{"started":"2020-01-01T00:00:00.000Z","restarted":"#
        ));
        assert!(
            text.ends_with(r#""skippedMillis":0,"version":{"started":"1.1.17","saved":"1.1.17"}}"#)
        );
    }

    #[test]
    fn saves_loads() {
        let mut s = State::new(1_600_000_000_000);
        prepare_save(&mut s, 1_600_000_000_005);
        let loaded = legacy::decode(&legacy::encode(&s)).unwrap();
        assert_eq!(loaded.state, s);
    }

    #[test]
    fn saves_loads_versionless() {
        let enc = legacy::encode(&State::new(5));
        let (_, body) = enc.split_once('|').unwrap();
        assert!(!body.contains('|'));
        assert!(legacy::decode(body).is_ok());
    }

    #[test]
    fn validates_the_save_version_on_import() {
        let mut s = State::new(5);
        let mut with = |v: Option<&str>| {
            s.version = v.map(|v| swarm_engine::state::VersionInfo {
                started: Some(v.into()),
                saved: None,
            });
            legacy::decode(&legacy::encode(&s))
        };
        assert!(with(Some("0.0.1")).is_err());
        assert!(with(Some("1.0.0")).is_ok());
        assert!(with(Some(DEFAULT_VERSION)).is_ok());
        // missing version is assumed to be 0.1.0
        assert!(with(None).is_err());
    }

    #[test]
    fn round_trips_every_fixture() {
        for (name, save) in accepted_saves() {
            let a = legacy::decode(&save).unwrap();
            let b = legacy::decode(&legacy::encode(&a.state)).unwrap();
            assert_eq!(b.state, a.state, "{name}");
        }
    }

    /// The written JSON has the same structure as the original: every key
    /// is there with the same value (decimals compared as numbers), and the
    /// only extra keys are empty defaults (`watched`, statistics) that the
    /// TS also creates on load.
    #[test]
    fn writes_the_original_json_structure() {
        fn same(a: &Value, b: &Value, path: &str) {
            match (a, b) {
                (Value::Object(a), Value::Object(b)) => {
                    for (k, va) in a {
                        let p = format!("{path}.{k}");
                        // `date.loaded` is reset on load; `elapsedFirstStr` is
                        // a display string the Coffee statistics page cached
                        // in the save (`Statistics` has no bag for extras).
                        if p.ends_with("date.loaded") || k == "elapsedFirstStr" {
                            continue;
                        }
                        let vb = b.get(k).unwrap_or_else(|| panic!("missing {p}"));
                        same(va, vb, &p);
                    }
                    for (k, vb) in b {
                        if !a.contains_key(k) {
                            let empty = matches!(vb, Value::Object(m) if m.is_empty())
                                || vb.as_i64() == Some(0);
                            assert!(
                                empty && (path.ends_with("statistics") || !path.contains('.')),
                                "extra {path}.{k}: {vb}"
                            );
                        }
                    }
                }
                (Value::String(x), Value::String(y)) if x != y => {
                    let (x, y): (Num, Num) = (x.parse().unwrap(), y.parse().unwrap());
                    assert_eq!(x, y, "{path}");
                }
                (Value::Bool(x), Value::Number(y)) if path.contains(".watched.") => {
                    assert_eq!(i64::from(*x), y.as_i64().unwrap(), "{path}");
                }
                _ => assert_eq!(a, b, "{path}"),
            }
        }
        for (name, save) in accepted_saves() {
            let orig = body_json(&save.split_whitespace().collect::<String>());
            let d = legacy::decode(&save).unwrap();
            let ours = body_json(&legacy::encode(&d.state));
            same(&orig, &ours, &name);
        }
    }
}
