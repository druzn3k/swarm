//! Lockstep mode (`rust/PLAN.md` section 6): replay a scenario against the
//! TS engine's recorded result, and wherever that result has the TS state
//! (every `full` snapshot: `initial`, steps 99 and 199, and after each
//! ascend/respec that succeeds), continue from the TS state instead of the
//! Rust one, so divergences don't compound. The corpus has no per-step
//! state (`rust/harness/README.md`, "Snapshot frequency"), so between those
//! points the run is free.
//!
//! Between resyncs, 15-digit `Num` and 20-digit decimal.js can legitimately
//! part ways: spending most of a large count (a 100% buy-max chain takes
//! meat from 1e29 to 1e16) leaves a remainder whose absolute error is that
//! of the large count, and the next purchase computed from it can differ.
//! The runner therefore tracks every unit's peak count since the last
//! resync (Rust side, before and after every step) and:
//!
//! * accepts a count that differs by at most [`Tolerance::cancel`] times its
//!   peak (via [`Comparator::observe_count`]);
//! * classifies the first difference of a segment as a **precision cascade
//!   origin** if it is a purchase quantity or a unit's `maxCostMet` whose
//!   cost resources are that noisy: `|expected - actual| <= n · noise + 1`,
//!   with `noise = max over cost resources r of cancel · peak(r) / count(r)`
//!   (counts at the start of the step). Every later difference up to the
//!   next resync is then reported as downstream ([`Report::downstream`]),
//!   not as a failure.
//!
//! Anything else is a failure. Running the corpus with a TS `full`
//! snapshot after every step (offline, with Node: set `"snapshot": "full"`
//! on every step and run `engine/oracle/run.ts`) resyncs every step and
//! needs no cascades at all; its only difference is one TS estimate that
//! decimal.js's own cancellation makes inaccurate (not in the committed
//! corpus). That is the evidence that the cascades are precision only.

use serde_json::Value;
use swarm_engine::State;
use swarm_num::Num;

use crate::compare::{Comparator, Diff, DiffKind, Report, Tolerance};
use crate::run::{Runner, Scenario, StartError};

/// The TS session state of a `full` snapshot (`snapshot.state`), read the
/// way a save is read.
pub fn state_from_snapshot(state: &Value) -> Option<State> {
    let text = format!(
        "{}{}",
        swarm_save::legacy::PREFIX,
        swarm_save::lz::compress_to_base64(&state.to_string())
    );
    let mut st = swarm_save::legacy::decode(&text).ok()?.state;
    // the reader drops `loaded` (a load sets it); keep the TS one
    st.dates.loaded = state["date"]["loaded"]
        .as_str()
        .and_then(swarm_save::date::parse_iso);
    Some(st)
}

fn counts(r: &Runner) -> Vec<Num> {
    let e = &r.engine;
    e.data().units().iter().map(|u| e.count(u.id)).collect()
}

/// Lockstep state between steps.
struct Tracker {
    /// Peak count of every unit (data order) since the last resync.
    peaks: Vec<Num>,
    /// Counts at the start of the current step.
    before: Vec<Num>,
}

impl Tracker {
    fn observe(&mut self, counts: &[Num], cmp: &mut Comparator<'_>, r: &Runner) {
        let units = r.engine.data().units();
        for ((p, c), u) in self.peaks.iter_mut().zip(counts).zip(units) {
            *p = (*p).max(c.abs());
            cmp.observe_count(&u.name, *p);
        }
    }

    /// The relative noise of buying with these resources: `cancel ·
    /// peak / count`, the largest over the resources.
    fn noise(&self, tol: &Tolerance, resources: &[usize]) -> f64 {
        resources
            .iter()
            .map(|&i| {
                let count = self.before[i].abs();
                if count.is_zero() {
                    return 0.0;
                }
                (self.peaks[i] * Num::from_f64(tol.cancel) / count).to_f64()
            })
            .fold(0.0, f64::max)
    }
}

/// The cost resources (unit indices) of a unit or upgrade, by name.
fn cost_resources(r: &Runner, unit: Option<&str>, upgrade: Option<&str>) -> Vec<usize> {
    let e = &r.engine;
    let d = e.data();
    if let Some(id) = unit.and_then(|n| d.unit_id(n)) {
        e.each_cost(id).iter().map(|c| c.unit.index()).collect()
    } else if let Some(id) = upgrade.and_then(|n| d.upgrade_id(n)) {
        e.total_cost(id).iter().map(|c| c.unit.index()).collect()
    } else {
        Vec::new()
    }
}

fn path_index(path: &str, key: &str) -> Option<usize> {
    let rest = &path[path.find(key)? + key.len()..];
    rest.split(']').next()?.parse().ok()
}

fn num_of(text: &str) -> Option<Num> {
    serde_json::from_str::<Value>(text)
        .ok()?
        .as_str()?
        .parse()
        .ok()
}

/// Whether `d` (the first difference of a segment) is explained by
/// cancellation noise; a description if so.
fn precision_origin(
    r: &Runner,
    t: &Tracker,
    tol: &Tolerance,
    step: usize,
    actual: &Value,
    d: &Diff,
) -> Option<String> {
    let (e, a) = (num_of(&d.expected)?, num_of(&d.actual)?);
    let resources = if d.path.contains(".commands[")
        && (d.path.ends_with(".num") || d.path.ends_with(".twinnum"))
    {
        let k = path_index(&d.path, ".commands[")?;
        let c = &actual["commands"][k];
        cost_resources(r, c["unitname"].as_str(), c["upgradename"].as_str())
    } else if d.path.ends_with(".maxCostMet") || d.path.ends_with(".maxCostMet25") {
        let unit = d.path.rsplit('.').nth(1)?;
        if !d.path.contains(".units.") {
            return None;
        }
        cost_resources(r, Some(unit), None)
    } else {
        return None;
    };
    let noise = t.noise(tol, &resources);
    let allowed = e.abs().max(a.abs()) * Num::from_f64(noise) + Num::ONE;
    ((e - a).abs() <= allowed).then(|| {
        format!(
            "step {step}: {} expected {} actual {}: cost resources at {noise:.1e} relative noise",
            d.path, d.expected, d.actual
        )
    })
}

/// Runs `s` in lockstep with `expected` (its TS result). See the [module
/// docs](self).
pub fn run_lockstep(s: &Scenario, expected: &Value, tol: &Tolerance) -> Result<Report, StartError> {
    let mut r = Runner::start(&s.start)?;
    for step in &s.prefix_steps {
        r.run_step(step);
    }
    let mut cmp = Comparator::new(tol);
    cmp.value("initial", &expected["initial"], &r.snapshot_full());
    resync(&mut r, &expected["initial"]);
    let c = counts(&r);
    let mut t = Tracker {
        peaks: c.clone(),
        before: c,
    };
    let mut cascade = false;
    let mut downstream = Vec::new();
    let mut origins = Vec::new();
    let empty = Vec::new();
    let es = expected["steps"].as_array().unwrap_or(&empty);
    for (i, step) in s.steps.iter().enumerate() {
        t.before = counts(&r);
        let before = t.before.clone();
        t.observe(&before, &mut cmp, &r);
        let a = r.run_step(step);
        let after = counts(&r);
        t.observe(&after, &mut cmp, &r);
        let e = es.get(i).unwrap_or(&Value::Null);
        let n0 = cmp.diffs().len();
        cmp.step(i, e, &a);
        if cmp.diffs().len() > n0 {
            let new = cmp.take_diffs(n0);
            if !cascade {
                if let Some(o) = precision_origin(&r, &t, tol, i, &a, &new[0]) {
                    cascade = true;
                    origins.push(o);
                }
            }
            if cascade {
                downstream.extend(new);
            } else {
                for d in new {
                    cmp.push(d);
                }
            }
        }
        if let Some(snap) = e.get("snapshot") {
            if resync(&mut r, snap) {
                cascade = false;
                cmp.reset_counts();
                let c = counts(&r);
                t.peaks = c;
            }
        }
    }
    if es.len() != s.steps.len() {
        cmp.push(Diff {
            path: "steps.length".into(),
            kind: DiffKind::Value,
            expected: es.len().to_string(),
            actual: s.steps.len().to_string(),
            rel: None,
        });
    }
    let mut report = cmp.finish();
    report.downstream = downstream;
    report.origins = origins;
    Ok(report)
}

fn resync(r: &mut Runner, snapshot: &Value) -> bool {
    match snapshot.get("state").and_then(state_from_snapshot) {
        Some(state) => {
            r.engine.resync_state(state);
            true
        }
        None => false,
    }
}
