//! Replays the 12 goldens recorded from the original CoffeeScript game
//! (`engine/test/golden/*.json`, the TS `golden.test.ts`) and compares them
//! with the tolerant comparator.

use std::path::{Path, PathBuf};

use serde_json::Value;
use swarm_scenario::compare::{compare_results, Tolerance};
use swarm_scenario::jsjson::golden_json;
use swarm_scenario::run::{run_scenario, Scenario};

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../engine/test/golden")
}

fn goldens() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(golden_dir())
        .expect("engine/test/golden")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    v.sort();
    v
}

#[test]
fn there_are_12_goldens() {
    assert_eq!(goldens().len(), 12);
}

#[test]
fn golden_json_writes_the_golden_text_back() {
    // JSON.stringify(x, null, 1) layout, JS numbers, key order
    for path in goldens() {
        let text = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert!(golden_json(&v) == text, "{}", path.display());
    }
}

#[test]
fn goldens_match_the_original_game() {
    let tol = Tolerance::default();
    let mut failures = Vec::new();
    for path in goldens() {
        let golden: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let actual = run_scenario(&Scenario::from_golden(&golden));
        let report = compare_results(&golden, &actual, &tol);
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        println!("{name}: {}", report.summary(0).trim_end());
        if !report.is_empty() {
            failures.push(format!("{name}: {}", report.summary(20)));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
