//! Shared fixtures and a small PRNG for the integration tests.
#![allow(dead_code)]

use serde_json::Value;

pub const SESSION_SAVES: &str =
    include_str!("../../../../../engine/test/fixtures/session-saves.json");
pub const PERSIST: &str = include_str!("../../../../../swarmsim-ts/src/persist.test.json");

/// A save from `engine/test/fixtures/session-saves.json`.
pub fn session_save(name: &str) -> String {
    let v: Value = serde_json::from_str(SESSION_SAVES).unwrap();
    v[name].as_str().unwrap().to_owned()
}

/// `swarmsim-ts/src/persist.test.json`.
pub fn persist() -> Value {
    serde_json::from_str(PERSIST).unwrap()
}

/// Every fixture save the TS engine accepts.
pub fn accepted_saves() -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = ["v02", "v1", "whitespace"]
        .iter()
        .map(|n| (n.to_string(), session_save(n)))
        .collect();
    for e in persist()["exports"].as_array().unwrap() {
        out.push((
            format!("exports.{}", e["name"].as_str().unwrap()),
            e["export_"].as_str().unwrap().to_owned(),
        ));
    }
    out
}

/// A tiny xorshift64 PRNG for property tests.
pub struct Rng(pub u64);

impl Rng {
    pub fn next(&mut self) -> u64 {
        let mut s = self.0;
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        self.0 = s;
        s
    }
    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo) as u64 + 1) as i64
    }
    pub fn f64(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn chance(&mut self, p: f64) -> bool {
        self.f64() < p
    }
}
