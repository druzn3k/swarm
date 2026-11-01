//! Times the idle tick's `Engine::view` (default request) and its JSON on
//! the late-game `whitespace` fixture:
//! `cargo run --release -p swarm-wasm --example view_timing`.

use std::time::{Duration, Instant};

use swarm_data::GameData;
use swarm_engine::{Sections, ViewRequest};

const SAVES: &str = include_str!("../../../../engine/test/fixtures/session-saves.json");
const NOW: i64 = 1_793_534_400_000;

fn main() {
    let v: serde_json::Value = serde_json::from_str(SAVES).unwrap();
    let save = v["whitespace"].as_str().unwrap();
    let mut e = swarm_save::load(GameData::embedded(), save, NOW, None)
        .unwrap()
        .engine;
    let req = ViewRequest::default();
    let n: u32 = std::env::var("N")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2000);
    let (mut tv, mut tj, mut size) = (Duration::ZERO, Duration::ZERO, 0);
    for i in 0..n + 20 {
        e.advance(Duration::from_millis(16));
        let t = Instant::now();
        let view = e.view(&req);
        let t2 = Instant::now();
        let json = serde_json::to_string(&view).unwrap();
        let t3 = Instant::now();
        if i >= 20 {
            tv += t2 - t;
            tj += t3 - t2;
        }
        size = json.len();
    }
    for (name, sec) in [
        (
            "units",
            Sections {
                units: true,
                ..Sections::NONE
            },
        ),
        (
            "upgrades",
            Sections {
                upgrades: true,
                ..Sections::NONE
            },
        ),
        (
            "tabs",
            Sections {
                tabs: true,
                ..Sections::NONE
            },
        ),
        (
            "achievements",
            Sections {
                achievements: true,
                ..Sections::NONE
            },
        ),
        (
            "ascension",
            Sections {
                ascension: true,
                ..Sections::NONE
            },
        ),
        (
            "statistics",
            Sections {
                statistics: true,
                ..Sections::NONE
            },
        ),
        ("none", Sections::NONE),
    ] {
        let r = ViewRequest {
            sections: sec,
            ..ViewRequest::default()
        };
        let mut t = Duration::ZERO;
        let mut size = 0;
        for _ in 0..n {
            e.advance(Duration::from_millis(16));
            let s = Instant::now();
            let v = e.view(&r);
            t += s.elapsed();
            size = serde_json::to_string(&v).unwrap().len();
        }
        println!(
            "  {name}: {:.1} us, {size} bytes",
            t.as_secs_f64() * 1e6 / n as f64
        );
    }
    println!(
        "view {:.1} us, json {:.1} us, {} bytes",
        tv.as_secs_f64() * 1e6 / n as f64,
        tj.as_secs_f64() * 1e6 / n as f64,
        size
    );
}
