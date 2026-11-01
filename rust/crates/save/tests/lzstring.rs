//! lz-string compatibility against `swarmsim-ts/src/persist.test.json`.

mod common;

use common::*;
use swarm_save::lz;

#[test]
fn simple_vectors() {
    let p = persist();
    for v in p["simple"].as_array().unwrap() {
        let dec = v["dec"].as_str().unwrap();
        let enc = v["lz"].as_str().unwrap();
        assert_eq!(lz::compress_to_base64(dec), enc, "{dec:?}");
        assert_eq!(lz::decompress_from_base64(enc).as_deref(), Some(dec));
    }
}

#[test]
fn export_vectors_compress_byte_for_byte() {
    let p = persist();
    let all = p["format"]
        .as_array()
        .unwrap()
        .iter()
        .chain(p["exports"].as_array().unwrap());
    for v in all {
        let body = v["body"].as_str().unwrap();
        let export = v["export_"].as_str().unwrap();
        let (header, rest) = export.split_once('|').unwrap();
        let lzpart = &rest[swarm_save::legacy::PREFIX.len()..];
        assert_eq!(lz::decompress_from_base64(lzpart).as_deref(), Some(body));
        assert_eq!(lz::compress_to_base64(body), lzpart);
        assert_eq!(header.len() % 4, 0);
    }
}

#[test]
fn session_fixtures_decompress() {
    // written by older lz-string versions with other padding; still readable
    for name in [
        "v02",
        "v1",
        "publictestImported",
        "publictestCreated",
        "publictestBroken",
        "whitespace",
    ] {
        let s: String = session_save(name).split_whitespace().collect();
        let body = &s.split_once('|').unwrap().1[16..];
        let json = lz::decompress_from_base64(body).unwrap();
        assert!(
            serde_json::from_str::<serde_json::Value>(&json).is_ok(),
            "{name}"
        );
        assert_eq!(
            lz::decompress_from_base64(&lz::compress_to_base64(&json)),
            Some(json)
        );
    }
}

#[test]
fn non_ascii_round_trips() {
    for s in ["é中😀", "{\"options\":{\"theme\":\"ünïcødé\"}}", "x"] {
        assert_eq!(
            lz::decompress_from_base64(&lz::compress_to_base64(s)).as_deref(),
            Some(s)
        );
    }
    assert_eq!(lz::compress_to_base64("é中😀"), "JeWjlLwbgAe0A===");
}
