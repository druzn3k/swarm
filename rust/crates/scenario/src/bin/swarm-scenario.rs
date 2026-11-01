//! Runs scenarios and compares them with the TS engine's results.
//!
//! ```text
//! swarm-scenario run <scenario.json>                  # print the result (goldenJson)
//! swarm-scenario compare <scenario.json> <expected.json> [--max N] [--lockstep]
//! swarm-scenario golden <golden.json> [--max N]       # replay a golden and compare
//! ```
//!
//! `compare` exits with status 1 when there are differences.

use std::process::ExitCode;

use swarm_scenario::compare::{compare_results, Tolerance};
use swarm_scenario::run::{try_run_scenario, Scenario};
use swarm_scenario::{lockstep, scenario_to_json};

fn read(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

fn main() -> ExitCode {
    match real_main() {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}

fn real_main() -> Result<ExitCode, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let max = args
        .iter()
        .position(|a| a == "--max")
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(40);
    let lockstep_mode = args.iter().any(|a| a == "--lockstep");
    let pos: Vec<&String> = {
        let mut skip = false;
        args.iter()
            .filter(|a| {
                if skip {
                    skip = false;
                    return false;
                }
                if *a == "--max" {
                    skip = true;
                    return false;
                }
                !a.starts_with("--")
            })
            .collect()
    };
    let usage = "usage: swarm-scenario run <scenario> | compare <scenario> <expected> [--max N] [--lockstep] | golden <golden> [--max N]";
    let tol = Tolerance::default();
    match pos.as_slice() {
        [cmd, scenario] if cmd.as_str() == "run" => {
            let s = Scenario::from_json(&read(scenario)?).map_err(|e| e.to_string())?;
            let r = try_run_scenario(&s).map_err(|e| e.to_string())?;
            print!("{}", scenario_to_json(&r));
            Ok(ExitCode::SUCCESS)
        }
        [cmd, scenario, expected] if cmd.as_str() == "compare" => {
            let s = Scenario::from_json(&read(scenario)?).map_err(|e| e.to_string())?;
            let e: serde_json::Value =
                serde_json::from_str(&read(expected)?).map_err(|e| e.to_string())?;
            let report = if lockstep_mode {
                lockstep::run_lockstep(&s, &e, &tol).map_err(|e| e.to_string())?
            } else {
                let r = try_run_scenario(&s).map_err(|e| e.to_string())?;
                compare_results(&e, &r, &tol)
            };
            print!("{}", report.summary(max));
            Ok(if report.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            })
        }
        [cmd, golden] if cmd.as_str() == "golden" => {
            let g: serde_json::Value =
                serde_json::from_str(&read(golden)?).map_err(|e| e.to_string())?;
            let s = Scenario::from_golden(&g);
            let r = try_run_scenario(&s).map_err(|e| e.to_string())?;
            let report = compare_results(&g, &r, &tol);
            print!("{}", report.summary(max));
            Ok(if report.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            })
        }
        _ => Err(usage.into()),
    }
}
