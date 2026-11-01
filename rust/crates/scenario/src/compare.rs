//! A tolerant JSON comparator for scenario results.
//!
//! Numbers and numeric strings (decimal.js `toString` output, `"Infinity"`,
//! `"NaN"`, `{"$number": ...}`) compare as numbers within a relative
//! tolerance that depends on the field's category ([`Tolerance`]); other
//! values compare exactly (error strings, booleans, names, dates). Object
//! key order is ignored. Save strings (`<b64>|Q2hlYXRlciA6KAoK...`) are
//! decoded and their JSON compared the same way.
//!
//! An integer-valued quantity that differs by exactly 1 is reported as a
//! [`DiffKind::BoundaryFlip`]: floor/ceil of a value within rounding error
//! of an integer, where 15-digit `Num` arithmetic and 20-digit decimal.js
//! may disagree (`rust/PLAN.md` section 8.1). Everything else is a
//! [`DiffKind::Value`] (or a structural difference).

use std::fmt;

use serde_json::Value;
use swarm_num::Num;

/// Relative tolerances per field category.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tolerance {
    /// Counts, velocities, costs, stats and everything not listed below.
    pub rel: f64,
    /// Time estimates (`estimateUnit`, `estimateUpgrade`,
    /// `estimateSecsUntilBuyable`, `ascendCostDurationSecs`): bisection
    /// stops at 0.2 s and the quadratic formula cancels in f64.
    pub estimate_rel: f64,
    /// Absolute seconds for estimates.
    pub estimate_abs: f64,
    /// Values whose magnitude is at most this compare as equal to zero
    /// (`count - paid` cancellation in `costMetPercent` and the like).
    pub zero: f64,
    /// Unit counts: an absolute tolerance of this times the largest count
    /// of that unit seen so far in the expected result. Spending most of a
    /// large count leaves a small remainder whose absolute error is that of
    /// the large count (15 digits here, 20 in decimal.js), so relative
    /// error alone would flag `0.1896` vs `0.2485` left of 2e12 larvae.
    pub cancel: f64,
    /// Unit counts with the same integer part are accepted too (and
    /// counted in [`Report::remainders`]) when this is set: the peak a
    /// remainder was spent from is often not in any snapshot. Game logic
    /// only spends whole units, so the fraction matters only where its
    /// floor flips, which shows up as a [`DiffKind::BoundaryFlip`] in a
    /// purchase.
    pub same_floor_counts: bool,
    /// `costMetPercent` (a 0..=1 progress fraction, `(count - paid) /
    /// (cost - paid)` with the same cancellation): absolute tolerance.
    pub fraction_abs: f64,
    /// A unit's `maxCostMet`/`maxCostMet25` (`floor(resource / cost)`, so
    /// it carries the cancellation error of a resource left over from a
    /// large purchase): relative tolerance. Purchases themselves
    /// (`commands[].num`) stay at [`Tolerance::rel`].
    pub quotient_rel: f64,
}

impl Default for Tolerance {
    /// `rel` 1e-9; estimates 1e-6 relative or 0.5 s; zero below 1e-9; counts
    /// within 1e-13 of their largest magnitude or with the same integer
    /// part; `costMetPercent` 1e-4 absolute; unit `maxCostMet` 1e-4
    /// relative.
    fn default() -> Tolerance {
        Tolerance {
            rel: 1e-9,
            estimate_rel: 1e-6,
            estimate_abs: 0.5,
            zero: 1e-9,
            cancel: 1e-13,
            same_floor_counts: true,
            fraction_abs: 1e-4,
            quotient_rel: 1e-4,
        }
    }
}

/// The category of a field, which picks its tolerance.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    /// [`Tolerance::rel`].
    Default,
    /// [`Tolerance::estimate_rel`] / [`Tolerance::estimate_abs`].
    Estimate,
}

/// What kind of difference.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum DiffKind {
    /// Integers that differ by exactly 1: a floor/ceil precision flip.
    BoundaryFlip,
    /// Numbers out of tolerance, or different strings/booleans.
    Value,
    /// Different JSON types.
    Type,
    /// A key only the expected side has (or a shorter array).
    Missing,
    /// A key only the actual side has (or a longer array).
    Extra,
}

/// One difference.
#[derive(Clone, Debug, PartialEq)]
pub struct Diff {
    /// JSON path, like `steps[12].snapshot.units.meat.count`.
    pub path: String,
    /// What kind.
    pub kind: DiffKind,
    /// The expected value (compact JSON).
    pub expected: String,
    /// The actual value (compact JSON).
    pub actual: String,
    /// The relative difference, for numbers.
    pub rel: Option<f64>,
}

impl fmt::Display for Diff {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:?} {}: expected {} actual {}",
            self.kind, self.path, self.expected, self.actual
        )?;
        if let Some(r) = self.rel {
            write!(f, " (rel {r:.3e})")?;
        }
        Ok(())
    }
}

/// The differences between two results.
#[derive(Clone, Debug, Default)]
pub struct Report {
    /// Every difference, in document order.
    pub diffs: Vec<Diff>,
    /// Numbers compared.
    pub numbers: usize,
    /// The largest relative difference among numbers within tolerance.
    pub max_rel_ok: f64,
    /// Counts accepted by [`Tolerance::same_floor_counts`] only.
    pub remainders: usize,
    /// The largest absolute difference among those.
    pub max_remainder: f64,
    /// Lockstep runs: differences accepted as downstream of a precision
    /// cascade (see [`crate::lockstep`]); not in `diffs`.
    pub downstream: Vec<Diff>,
    /// Lockstep runs: where each precision cascade started, and why it is
    /// precision.
    pub origins: Vec<String>,
}

impl Report {
    /// No differences.
    pub fn is_empty(&self) -> bool {
        self.diffs.is_empty()
    }

    /// Differences other than those `allow` accepts.
    pub fn failures(&self, allow: impl Fn(&Diff) -> bool) -> Vec<&Diff> {
        self.diffs.iter().filter(|d| !allow(d)).collect()
    }

    /// A human-readable report of the first `n` differences and counts by
    /// kind.
    pub fn summary(&self, n: usize) -> String {
        let mut counts = std::collections::BTreeMap::new();
        for d in &self.diffs {
            *counts.entry(d.kind).or_insert(0usize) += 1;
        }
        let mut out = format!(
            "{} differences {:?}; {} numbers compared, max rel diff within tolerance {:.3e}, {} count remainders (max abs {:.3e}), {} downstream of {} precision cascades\n",
            self.diffs.len(),
            counts,
            self.numbers,
            self.max_rel_ok,
            self.remainders,
            self.max_remainder,
            self.downstream.len(),
            self.origins.len()
        );
        for o in &self.origins {
            out.push_str(&format!("  cascade: {o}\n"));
        }
        for d in self.diffs.iter().take(n) {
            out.push_str(&format!("  {d}\n"));
        }
        if self.diffs.len() > n {
            out.push_str(&format!("  ... {} more\n", self.diffs.len() - n));
        }
        out
    }
}

/// A number as the comparator sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Numeric {
    Finite(Num),
    PosInf,
    NegInf,
    NaN,
}

fn parse_numeric_str(s: &str) -> Option<Numeric> {
    match s {
        "Infinity" => return Some(Numeric::PosInf),
        "-Infinity" => return Some(Numeric::NegInf),
        "NaN" => return Some(Numeric::NaN),
        _ => {}
    }
    let first = s.bytes().next()?;
    if !(first.is_ascii_digit() || first == b'-' || first == b'.') {
        return None;
    }
    if !s
        .bytes()
        .all(|c| c.is_ascii_digit() || b".+-eE".contains(&c))
    {
        return None;
    }
    s.parse::<Num>().ok().map(Numeric::Finite)
}

fn numeric(v: &Value) -> Option<Numeric> {
    match v {
        Value::Number(n) => {
            let x = n.as_f64()?;
            Some(Numeric::Finite(Num::from_f64(x)))
        }
        Value::String(s) => parse_numeric_str(s),
        Value::Object(m) if m.len() == 1 => m.get("$number").and_then(|x| match x {
            Value::String(s) => parse_numeric_str(s),
            _ => None,
        }),
        _ => None,
    }
}

/// Whether a string is a v1 save.
pub fn is_save_string(s: &str) -> bool {
    s.len() > 40 && swarm_save::legacy::is_legacy(s)
}

/// The JSON body of a v1 save.
pub fn save_body(s: &str) -> Option<Value> {
    let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let body = match s.split_once('|') {
        Some((_, b)) => b.to_owned(),
        None => s,
    };
    let body = body.get(swarm_save::legacy::PREFIX.len()..)?;
    let json = swarm_save::lz::decompress_from_base64(body)?;
    serde_json::from_str(&json).ok()
}

struct Walker<'a> {
    tol: &'a Tolerance,
    report: Report,
    /// Largest expected count seen so far, per unit (see
    /// [`Tolerance::cancel`]).
    count_scale: std::collections::HashMap<String, Num>,
}

/// The unit a count field belongs to: `...units.<unit>.count` or
/// `...unittypes.<unit>`.
fn count_unit(path: &str) -> Option<&str> {
    if let Some(rest) = path.strip_suffix(".count") {
        let (head, unit) = rest.rsplit_once('.')?;
        return head.ends_with("units").then_some(unit);
    }
    let (head, unit) = path.rsplit_once('.')?;
    head.ends_with("unittypes").then_some(unit)
}

fn compact(v: &Value) -> String {
    let s = v.to_string();
    if s.len() > 120 {
        format!(
            "{}...",
            &s[..s.char_indices().nth(117).map_or(s.len(), |(i, _)| i)]
        )
    } else {
        s
    }
}

impl Walker<'_> {
    fn push(&mut self, path: &str, kind: DiffKind, e: &Value, a: &Value, rel: Option<f64>) {
        self.report.diffs.push(Diff {
            path: path.to_owned(),
            kind,
            expected: compact(e),
            actual: compact(a),
            rel,
        });
    }

    fn numbers(
        &mut self,
        path: &str,
        cat: Category,
        ev: &Value,
        av: &Value,
        e: Numeric,
        a: Numeric,
    ) {
        self.report.numbers += 1;
        let (e, a) = match (e, a) {
            (Numeric::Finite(e), Numeric::Finite(a)) => (e, a),
            (x, y) if x == y => return,
            _ => return self.push(path, DiffKind::Value, ev, av, None),
        };
        let unit_scale = count_unit(path).map(|u| {
            let s = self.count_scale.entry(u.to_owned()).or_insert(Num::ZERO);
            *s = (*s).max(e.abs());
            *s
        });
        if e == a {
            return;
        }
        let diff = (e - a).abs();
        let scale = e.abs().max(a.abs());
        let rel = (diff / scale).to_f64();
        let cancel = unit_scale.is_some_and(|s| diff <= s * Num::from_f64(self.tol.cancel));
        if !cancel
            && unit_scale.is_some()
            && self.tol.same_floor_counts
            && e.floor() == a.floor()
            && rel > self.tol.rel
        {
            self.report.remainders += 1;
            self.report.max_remainder = self.report.max_remainder.max(diff.to_f64());
            return;
        }
        let fraction = path.ends_with(".costMetPercent") && diff.to_f64() <= self.tol.fraction_abs;
        let quotient = (path.ends_with(".maxCostMet") || path.ends_with(".maxCostMet25"))
            && path.contains(".units.")
            && rel <= self.tol.quotient_rel;
        let ok = match cat {
            Category::Default => {
                rel <= self.tol.rel
                    || scale.to_f64() <= self.tol.zero
                    || cancel
                    || fraction
                    || quotient
            }
            Category::Estimate => {
                rel <= self.tol.estimate_rel || diff.to_f64() <= self.tol.estimate_abs
            }
        };
        if ok {
            self.report.max_rel_ok = self.report.max_rel_ok.max(rel);
            return;
        }
        let flip = e.is_integer() && a.is_integer() && diff == Num::ONE;
        let kind = if flip {
            DiffKind::BoundaryFlip
        } else {
            DiffKind::Value
        };
        self.push(path, kind, ev, av, Some(rel));
    }

    fn walk(&mut self, path: &str, cat: Category, e: &Value, a: &Value) {
        if let (Some(ne), Some(na)) = (numeric(e), numeric(a)) {
            return self.numbers(path, cat, e, a, ne, na);
        }
        match (e, a) {
            (Value::String(se), Value::String(sa)) => {
                if se == sa {
                    return;
                }
                if is_save_string(se) && is_save_string(sa) {
                    if let (Some(je), Some(ja)) = (save_body(se), save_body(sa)) {
                        return self.walk(&format!("{path}<save>"), cat, &je, &ja);
                    }
                }
                self.push(path, DiffKind::Value, e, a, None)
            }
            (Value::Array(ae), Value::Array(aa)) => {
                for (i, (x, y)) in ae.iter().zip(aa).enumerate() {
                    self.walk(&format!("{path}[{i}]"), cat, x, y);
                }
                for (i, x) in ae.iter().enumerate().skip(aa.len()) {
                    self.push(
                        &format!("{path}[{i}]"),
                        DiffKind::Missing,
                        x,
                        &Value::Null,
                        None,
                    );
                }
                for (i, y) in aa.iter().enumerate().skip(ae.len()) {
                    self.push(
                        &format!("{path}[{i}]"),
                        DiffKind::Extra,
                        &Value::Null,
                        y,
                        None,
                    );
                }
            }
            (Value::Object(me), Value::Object(ma)) => {
                for (k, x) in me {
                    let p = if path.is_empty() {
                        k.clone()
                    } else {
                        format!("{path}.{k}")
                    };
                    let c = if matches!(
                        k.as_str(),
                        "estimateSecsUntilBuyable" | "ascendCostDurationSecs"
                    ) {
                        Category::Estimate
                    } else {
                        cat
                    };
                    match ma.get(k) {
                        Some(y) => self.walk(&p, c, x, y),
                        None => self.push(&p, DiffKind::Missing, x, &Value::Null, None),
                    }
                }
                for (k, y) in ma {
                    if !me.contains_key(k) {
                        let p = if path.is_empty() {
                            k.clone()
                        } else {
                            format!("{path}.{k}")
                        };
                        self.push(&p, DiffKind::Extra, &Value::Null, y, None);
                    }
                }
            }
            _ if e == a => {}
            // TS `watchedAt` reads legacy booleans as 1/0; the Rust state
            // stores the number
            (Value::Bool(b), Value::Number(n)) if path.contains(".watched.") => {
                if n.as_f64() != Some(f64::from(u8::from(*b))) {
                    self.push(path, DiffKind::Value, e, a, None)
                }
            }
            _ => {
                let kind = if std::mem::discriminant(e) == std::mem::discriminant(a) {
                    DiffKind::Value
                } else {
                    DiffKind::Type
                };
                self.push(path, kind, e, a, None)
            }
        }
    }
}

impl Walker<'_> {
    fn step(&mut self, i: usize, e: &Value, a: &Value) {
        let cat = result_category(&e["action"]);
        let base = format!("steps[{i}]");
        if let (Value::Object(me), Value::Object(ma)) = (e, a) {
            for (k, x) in me {
                let c = if k == "result" {
                    cat
                } else {
                    Category::Default
                };
                match ma.get(k) {
                    Some(y) => self.walk(&format!("{base}.{k}"), c, x, y),
                    None => self.push(
                        &format!("{base}.{k}"),
                        DiffKind::Missing,
                        x,
                        &Value::Null,
                        None,
                    ),
                }
            }
            for (k, y) in ma {
                if !me.contains_key(k) {
                    self.push(
                        &format!("{base}.{k}"),
                        DiffKind::Extra,
                        &Value::Null,
                        y,
                        None,
                    );
                }
            }
        } else {
            self.walk(&base, cat, e, a);
        }
    }
}

impl<'a> Walker<'a> {
    fn new(tol: &'a Tolerance) -> Walker<'a> {
        Walker {
            tol,
            report: Report::default(),
            count_scale: Default::default(),
        }
    }
}

/// An incremental comparison, for lockstep runs: compare parts of two
/// results one after the other, then take the [`Report`].
pub struct Comparator<'a>(Walker<'a>);

impl<'a> Comparator<'a> {
    /// An empty comparison.
    pub fn new(tol: &'a Tolerance) -> Comparator<'a> {
        Comparator(Walker::new(tol))
    }

    /// Compares step `i` of two results.
    pub fn step(&mut self, i: usize, expected: &Value, actual: &Value) {
        self.0.step(i, expected, actual);
    }

    /// Compares two values at `path`.
    pub fn value(&mut self, path: &str, expected: &Value, actual: &Value) {
        self.0.walk(path, Category::Default, expected, actual);
    }

    /// Records a difference found by the caller.
    pub fn push(&mut self, diff: Diff) {
        self.0.report.diffs.push(diff);
    }

    /// Raises the count scale of a unit (see [`Tolerance::cancel`]), for
    /// callers that know a count's history better than the snapshots do.
    pub fn observe_count(&mut self, unit: &str, count: Num) {
        let s = self
            .0
            .count_scale
            .entry(unit.to_owned())
            .or_insert(Num::ZERO);
        *s = (*s).max(count.abs());
    }

    /// Forgets the count scales (after a lockstep resync).
    pub fn reset_counts(&mut self) {
        self.0.count_scale.clear();
    }

    /// The differences found so far.
    pub fn diffs(&self) -> &[Diff] {
        &self.0.report.diffs
    }

    /// Takes the differences from index `from` on, for reclassification.
    pub fn take_diffs(&mut self, from: usize) -> Vec<Diff> {
        self.0.report.diffs.split_off(from)
    }

    /// The report so far, mutably.
    pub fn report_mut(&mut self) -> &mut Report {
        &mut self.0.report
    }

    /// The differences found.
    pub fn finish(self) -> Report {
        self.0.report
    }
}

/// The category of a step's `result`, from its action.
pub fn result_category(action: &Value) -> Category {
    match action.get("do").and_then(Value::as_str) {
        Some("estimateUnit" | "estimateUpgrade" | "ascendInfo") => Category::Estimate,
        _ => Category::Default,
    }
}

/// Compares two JSON values (any shape) with the default category.
pub fn compare_values(expected: &Value, actual: &Value, tol: &Tolerance) -> Report {
    let mut w = Walker::new(tol);
    w.walk("", Category::Default, expected, actual);
    w.report
}

/// Compares two scenario results (`runScenario` output), step by step, with
/// estimate tolerances for estimate results.
pub fn compare_results(expected: &Value, actual: &Value, tol: &Tolerance) -> Report {
    let mut w = Walker::new(tol);
    let empty = Vec::new();
    for key in [
        "name",
        "description",
        "oldEngineVersion",
        "start",
        "initial",
    ] {
        w.walk(
            key,
            Category::Default,
            expected.get(key).unwrap_or(&Value::Null),
            actual.get(key).unwrap_or(&Value::Null),
        );
    }
    let se = expected["steps"].as_array().unwrap_or(&empty);
    let sa = actual["steps"].as_array().unwrap_or(&empty);
    if se.len() != sa.len() {
        w.push(
            "steps.length",
            DiffKind::Value,
            &Value::from(se.len()),
            &Value::from(sa.len()),
            None,
        );
    }
    for (i, (e, a)) in se.iter().zip(sa).enumerate() {
        w.step(i, e, a);
    }
    w.report
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_within_tolerance() {
        let t = Tolerance::default();
        let r = compare_values(
            &json!({"a": "181027177.7035388471", "b": 3, "c": {"$number": "Infinity"}}),
            &json!({"a": "181027177.703539", "b": "3", "c": {"$number": "Infinity"}}),
            &t,
        );
        assert!(r.is_empty(), "{}", r.summary(10));
        assert_eq!(r.numbers, 3);
    }

    #[test]
    fn classifies_boundary_flips() {
        let t = Tolerance::default();
        let r = compare_values(&json!({"n": "41"}), &json!({"n": "42"}), &t);
        assert_eq!(r.diffs[0].kind, DiffKind::BoundaryFlip);
        assert_eq!(r.diffs[0].path, "n");
        let r = compare_values(&json!({"n": "41"}), &json!({"n": "43"}), &t);
        assert_eq!(r.diffs[0].kind, DiffKind::Value);
        let r = compare_values(&json!({"n": "1.5"}), &json!({"n": "2.5"}), &t);
        assert_eq!(r.diffs[0].kind, DiffKind::Value);
    }

    #[test]
    fn structure_and_strings() {
        let t = Tolerance::default();
        let r = compare_values(
            &json!({"a": [1, 2], "e": "x", "m": 1}),
            &json!({"a": [1], "e": "y", "x": 1}),
            &t,
        );
        let kinds: Vec<_> = r.diffs.iter().map(|d| (d.path.as_str(), d.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                ("a[1]", DiffKind::Missing),
                ("e", DiffKind::Value),
                ("m", DiffKind::Missing),
                ("x", DiffKind::Extra)
            ]
        );
    }

    #[test]
    fn estimates_have_their_own_tolerance() {
        let t = Tolerance::default();
        let e = json!({"steps": [{"action": {"do": "estimateUnit"}, "result": "100.3"}]});
        let a = json!({"steps": [{"action": {"do": "estimateUnit"}, "result": "100"}]});
        assert!(compare_results(&e, &a, &t).is_empty());
        let e = json!({"steps": [{"action": {"do": "countInSecs"}, "result": "100.3"}]});
        let a = json!({"steps": [{"action": {"do": "countInSecs"}, "result": "100"}]});
        assert_eq!(compare_results(&e, &a, &t).diffs.len(), 1);
    }
}
