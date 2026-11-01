//! Replays the 60 corpus scenarios (`rust/harness/corpus`) and compares them
//! with the TS engine's results (`rust/harness/expected`) in lockstep mode
//! (`swarm_scenario::lockstep`): the run continues from the TS state at
//! every full snapshot, and divergences that start from cancellation noise
//! (15-digit `Num` against 20-digit decimal.js) are reported as precision
//! cascades, not failures. Scenarios run on all cores.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use swarm_scenario::compare::{Diff, Tolerance};
use swarm_scenario::lockstep::run_lockstep;
use swarm_scenario::run::Scenario;

fn harness() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../harness")
}

/// Differences accepted although they are outside the tolerances and not
/// downstream of a precision cascade, as (scenario, JSON path prefix,
/// why). Each must be precision-only and investigated; keep this short.
/// Empty: the one such difference found (an overmindprod estimate in
/// fixture-session-whitespace that the TS computes with decimal.js
/// cancellation, 4ac/b^2 = 3e-18) only shows with a snapshot every step.
const WHITELIST: &[(&str, &str, &str)] = &[];

fn whitelisted(scenario: &str, d: &Diff) -> bool {
    WHITELIST
        .iter()
        .any(|(s, p, _)| *s == scenario && d.path.starts_with(p))
}

#[test]
fn corpus_matches_the_ts_engine() {
    let mut names: Vec<String> = std::fs::read_dir(harness().join("corpus"))
        .expect("rust/harness/corpus")
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    assert_eq!(names.len(), 60);
    let queue = Mutex::new(names.clone());
    let results = Mutex::new(Vec::new());
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| loop {
                let Some(name) = queue.lock().unwrap().pop() else {
                    break;
                };
                let read =
                    |dir: &str| std::fs::read_to_string(harness().join(dir).join(&name)).unwrap();
                let scenario = Scenario::from_json(&read("corpus")).unwrap();
                let expected: Value = serde_json::from_str(&read("expected")).unwrap();
                let report = run_lockstep(&scenario, &expected, &Tolerance::default())
                    .unwrap_or_else(|e| panic!("{name}: {e}"));
                results.lock().unwrap().push((name, report));
            });
        }
    });
    let mut results = results.into_inner().unwrap();
    results.sort_by(|a, b| a.0.cmp(&b.0));
    let mut failures = Vec::new();
    let (mut cascades, mut downstream) = (0, 0);
    for (name, report) in &results {
        let scenario = name.trim_end_matches(".json");
        let bad: Vec<&Diff> = report.failures(|d| whitelisted(scenario, d));
        cascades += report.origins.len();
        downstream += report.downstream.len();
        println!("{name}: {}", report.summary(0).trim_end());
        if !bad.is_empty() {
            let shown: Vec<String> = bad.iter().take(20).map(|d| format!("  {d}")).collect();
            failures.push(format!(
                "{name}: {} failures\n{}",
                bad.len(),
                shown.join("\n")
            ));
        }
    }
    println!(
        "{} scenarios, {} pass; {cascades} precision cascades with {downstream} downstream differences",
        results.len(),
        results.len() - failures.len()
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
