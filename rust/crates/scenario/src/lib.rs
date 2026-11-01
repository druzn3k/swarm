//! `swarm-scenario`: the dual-engine parity harness on the Rust side
//! (`rust/PLAN.md` section 6, `rust/harness/README.md`).
//!
//! * [`run`]: the scenario action language of `engine/oracle/scenario.ts`
//!   over [`swarm_engine::Engine`] (with its `parity` feature), producing
//!   the same result object as the TS `runScenario`: steps with results,
//!   errors, command logs and snapshots, serialised by the TS `ser` rules
//!   (Decimal → decimal.js string, JS number → number or
//!   `{"$number": "Infinity"}`, Date → ISO).
//! * [`jsjson`]: `JSON.stringify(result, null, 1)` text
//!   ([`scenario_to_json`]), with JS number formatting.
//! * [`compare`]: a tolerant comparator that reports differences by JSON
//!   path and tells floor/ceil boundary flips from real divergences.
//! * [`lockstep`]: the comparison against a TS result that continues from
//!   the TS state at each full snapshot and classifies precision cascades.
//!
//! The `swarm-scenario` binary runs and compares scenarios from the command
//! line; `tests/` replays the 12 goldens of the original game and the 60
//! corpus scenarios of `rust/harness/`.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod compare;
pub mod jsjson;
pub mod lockstep;
pub mod run;
pub mod state_json;

pub use compare::{
    compare_results, compare_values, Category, Comparator, Diff, DiffKind, Report, Tolerance,
};
pub use run::{
    run_scenario, scenario_to_json, try_run_scenario, Runner, Scenario, SnapshotKind, Step,
};
