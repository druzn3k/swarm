//! Time estimates (`unit.ts:379-493`).

use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};
use swarm_data::{json_num, UnitId};
use swarm_num::Num;

use crate::engine::Engine;

/// How long until a count is reached.
///
/// The TS returns the JS number `0` when the target is already reached
/// (which makes some callers throw TypeErrors, see
/// [`ASCEND_ESTIMATE_TYPE_ERROR`]), a Decimal otherwise, and `Infinity` when
/// nothing produces the unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Estimate {
    /// Already reached (TS `0`).
    Reached,
    /// Seconds from now.
    Secs(f64),
    /// Never, at the current production (TS `Infinity`).
    Never,
}

/// The TS error `ascendCostDurationSecs` throws when energy already covers
/// the cost (`game.ts:449-464`). Rust returns [`Estimate::Reached`].
pub const ASCEND_ESTIMATE_TYPE_ERROR: &str =
    "energy.estimateSecsUntilEarned(...).toNumber is not a function";

impl Estimate {
    fn from_num(n: Num) -> Estimate {
        let f = n.to_f64();
        if f.is_infinite() || n == Num::MAX {
            Estimate::Never
        } else {
            Estimate::Secs(f)
        }
    }

    /// Seconds, with `Reached` as 0 and `Never` as infinity.
    pub fn secs(&self) -> f64 {
        match self {
            Estimate::Reached => 0.0,
            Estimate::Secs(s) => *s,
            Estimate::Never => f64::INFINITY,
        }
    }
}

impl Serialize for Estimate {
    /// `{"reached":true}`, `{"secs":12.5}` or `{"never":true}`.
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(1))?;
        match self {
            Estimate::Reached => m.serialize_entry("reached", &true)?,
            Estimate::Secs(v) => m.serialize_entry("secs", v)?,
            Estimate::Never => m.serialize_entry("never", &true)?,
        }
        m.end()
    }
}

/// Below this `4ac / b^2`, decimal.js (20 digits) computes the quadratic
/// formula's `-b + sqrt(b^2 - 4ac)` as 0.
pub const QUADRATIC_CANCEL: f64 = 1e-19;

/// Bisection stops when the bracket's half-width is below this many seconds.
const BISECTION_THRESHOLD: f64 = 0.2;
/// Bisection iterations at most.
const BISECTION_ITERATIONS: usize = 50;

impl Engine {
    /// Seconds until this unit's count reaches `target` (`unit.ts:394-455`):
    /// exact for degree 1 (linear) and 2 (quadratic formula); bisection on
    /// the polynomial above that, starting from the linear estimate (or the
    /// one-second rate).
    pub fn estimate_secs_until_earned(&self, unit: UnitId, target: Num) -> Estimate {
        let count = self.count(unit);
        // a remainder below Num's precision is noise: decimal.js (20 digits)
        // sees `target == count` there (golden ascend-respec, step 21)
        let remaining = crate::upgrade::absorbed(target - count, target.abs().max(count.abs()));
        if !remaining.is_positive() {
            return Estimate::Reached;
        }
        let degree = self.max_degree(unit);
        let coeffs = self.coefficients_now(unit);
        let coeff = |d: usize| coeffs.get(d).copied().unwrap_or(Num::ZERO);
        let mut ret: Option<Num> = None;
        let min = |r: Option<Num>, v: Num| Some(r.map_or(v, |r| r.min(v)));
        let mut linear = None;
        if degree > 0 {
            if !coeff(1).is_zero() {
                ret = min(ret, remaining / coeff(1));
                linear = ret;
            }
            if degree > 1 {
                // quadratic formula: (-b + (b^2 - 4ac)^0.5) / 2a
                let b = coeff(1);
                let mut a = coeff(2);
                if !a.is_zero() {
                    let c = -remaining;
                    a /= Num::TWO; // the "/2!" of "c * t^2/2!"
                    let disc = (b * b - a * c * Num::from(4)).sqrt();
                    // TS `(-b + disc) / 2a`; `-b + disc` cancels when
                    // `4ac << b^2`, which 15 digits lose long before
                    // decimal.js's 20 (an overmind upgrade 1e12 s away read
                    // as 0). Same root, without the cancellation...
                    let root = if b.is_negative() {
                        (-b + disc) / (a * Num::TWO)
                    } else if (a * c * Num::from(4)).abs() / (b * b) < json_num(QUADRATIC_CANCEL) {
                        // ...except where decimal.js cancels too: there the
                        // TS root is 0, so the estimate is 0 (PARITY: a
                        // pantheon5twin 330 s away estimated as reached)
                        Num::ZERO
                    } else {
                        (c * Num::TWO).abs() / (b + disc)
                    };
                    ret = min(ret, root);
                }
                if degree > 2 {
                    let max_sec = linear.unwrap_or_else(|| {
                        remaining / (self.count_in_secs_from_now(unit, Num::ONE) - count)
                    });
                    ret = Some(if !max_sec.is_positive() {
                        Num::ONE
                    } else if max_sec == Num::MAX {
                        // TS: bisection over [0, Infinity] gives Infinity
                        return Estimate::Never;
                    } else {
                        self.bisect(unit, target, max_sec)
                    });
                }
            }
        }
        match ret {
            Some(n) => Estimate::from_num(n),
            None => Estimate::Never,
        }
    }

    /// `unit.ts:457-493`.
    fn bisect(&self, unit: UnitId, num: Num, orig_max: Num) -> Num {
        let f = |sec: Num| num - self.count_in_secs_from_now(unit, sec);
        let thresh = Num::from_f64(BISECTION_THRESHOLD);
        let mut min_sec = Num::ZERO;
        let mut max_sec = orig_max;
        let mut min_val = f(min_sec);
        let mut mid_sec = Num::ZERO;
        for _ in 0..BISECTION_ITERATIONS {
            mid_sec = (max_sec + min_sec) / Num::TWO;
            let mid_val = f(mid_sec);
            if mid_val.is_zero() || (max_sec - min_sec) / Num::TWO < thresh {
                break;
            } else if mid_val.is_negative() == min_val.is_negative() {
                min_sec = mid_sec;
                min_val = f(min_sec);
            } else {
                max_sec = mid_sec;
            }
        }
        mid_sec
    }

    /// Seconds until the cap is reached, for capped units (TS
    /// `capDurationSeconds`, which gives 0 for [`Estimate::Reached`]).
    pub fn cap_eta(&self, unit: UnitId) -> Option<Estimate> {
        self.cap(unit)
            .map(|cap| self.estimate_secs_until_earned(unit, cap))
    }
}
