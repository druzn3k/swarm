//! `swarm-num`: the big-number type of the Swarm Simulator engine.
//!
//! The TypeScript engine uses decimal.js at arbitrary precision. Swarm's
//! numbers grow far past `f64` (units are capped at `1e100000`, see
//! `engine/src/unit.ts` `UNIT_LIMIT`), but nothing in the game needs more than
//! about 15 significant digits. [`Num`] is therefore a
//! break_infinity.js-style float with a wide exponent:
//!
//! ```text
//! value = mantissa * 10^exponent      mantissa: f64, exponent: i64
//! ```
//!
//! # Representation
//!
//! A `Num` is always *normalised*: either exactly zero (`mantissa == 0.0`,
//! `exponent == 0`), or `1 <= |mantissa| < 10`. The sign lives in the
//! mantissa. The exponent is bounded by [`EXP_MAX`] (about `9e15`), so it is
//! exactly representable as an `f64` and sums of two exponents never overflow.
//! Because the representation is unique, equality and hashing are structural
//! and [`Ord`] is a genuine total order.
//!
//! # Precision guarantee
//!
//! Every value carries an `f64` mantissa, i.e. a little under 16 significant
//! decimal digits. The crate guarantees **15 significant digits**:
//!
//! * Parsing, [`Display`](core::fmt::Display), [`Num::to_precision`] and the
//!   [`format`](mod@format) module all work on the value rounded to 15 significant digits,
//!   so `parse(display(x))` prints identically to `x` (saves are stable).
//! * Integers below `1e15` (every integer of up to 15 digits) are exact:
//!   when both operands of `+ - * / %` lie comfortably inside the `f64` range
//!   the operation is done in `f64` and the result re-normalised, so integer
//!   counts add, multiply and compare exactly.
//! * Near-integers within a few ulps (relative `2 * f64::EPSILON`) of an
//!   integer are treated as that integer by [`Num::to_f64`], [`Num::floor`],
//!   [`Num::ceil`], [`Num::round`] and [`Num::is_integer`]. This stops
//!   `3 * 0.1 * 10` from flooring to 2, the classic break_infinity bug.
//! * Beyond the `f64` range arithmetic is done on mantissa/exponent, with a
//!   relative error of a few ulps per operation. Powers with non-integer
//!   exponents go through `log10`, whose absolute error grows with the size of
//!   the exponent (about `1e-11` relative at `1e100000`).
//!
//! # No NaN, no infinity
//!
//! A `Num` can never be NaN or infinite. Operations that would produce one
//! saturate instead, and this is documented on each method:
//!
//! * overflow (exponent above [`EXP_MAX`]) saturates to [`Num::MAX`] /
//!   [`Num::MIN`]; underflow flushes to [`Num::ZERO`];
//! * `x / 0` is `±Num::MAX` (sign of `x`), `0 / 0` is zero;
//! * domain errors (`sqrt` of a negative, a negative base to a non-integer
//!   power) return zero;
//! * `From<f64>` maps NaN to zero and `±inf` to `±Num::MAX`. Use
//!   [`Num::MAX`] wherever the TypeScript engine uses `new Decimal(Infinity)`
//!   as a "no limit" sentinel.
//!
//! Methods returning `f64` ([`Num::log10`], [`Num::ln`], [`Num::log`],
//! [`Num::to_f64`]) follow plain `f64` semantics: `log10(0)` is `-inf`,
//! `log10` of a negative number is NaN, and `to_f64` of a value beyond the
//! `f64` range is `±inf`.
//!
//! # Features
//!
//! * `serde` (default): `Num` serialises as its canonical `Display` string
//!   and deserialises from a string or a JSON number.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod display;
pub mod format;
mod math;
mod ops;
mod parse;
mod pow10;
#[cfg(feature = "serde")]
mod serde_impl;
pub mod suffixes;

use core::cmp::Ordering;
use core::hash::{Hash, Hasher};

pub use display::Rounding;
pub use parse::ParseNumError;
use pow10::{POW10, POW10_OFFSET};

/// Largest exponent a [`Num`] can have; larger values saturate to
/// [`Num::MAX`]. Smaller than `2^53`, so it is exact as an `f64`, and twice it
/// fits in an `i64`.
pub const EXP_MAX: i64 = 9_000_000_000_000_000;

/// Smallest exponent a non-zero [`Num`] can have; smaller values flush to
/// zero.
pub const EXP_MIN: i64 = -EXP_MAX;

/// Largest `f64` strictly below 10: the biggest normalised mantissa.
const MANTISSA_MAX: f64 = 9.999_999_999_999_998;

/// Exponents within this range are handled by plain `f64` arithmetic in the
/// fast paths (with headroom so that sums, products and quotients of two such
/// values stay normal `f64`s).
const F64_SAFE_EXP: i64 = 150;

/// A big decimal floating-point number: `mantissa * 10^exponent`.
///
/// See the [crate documentation](crate) for the representation, the precision
/// guarantee and how NaN and infinity are avoided.
#[derive(Clone, Copy, Debug)]
pub struct Num {
    mantissa: f64,
    exponent: i64,
}

/// `10^e` as the nearest `f64`, for `-308 <= e <= 308`.
#[inline]
pub(crate) fn pow10(e: i64) -> f64 {
    debug_assert!((-POW10_OFFSET..=POW10_OFFSET).contains(&e));
    POW10[(e + POW10_OFFSET) as usize]
}

/// Multiplies `x` by `10^e` for any `e`, saturating to `±inf` / `0` like
/// `f64` would. Divides by exact powers where that is more accurate.
fn scale_f64(x: f64, e: i64) -> f64 {
    if e == 0 || x == 0.0 {
        x
    } else if e > 0 {
        if e > 2 * POW10_OFFSET {
            x * f64::INFINITY
        } else if e > POW10_OFFSET {
            x * pow10(POW10_OFFSET) * pow10(e - POW10_OFFSET)
        } else {
            x * pow10(e)
        }
    } else if e < -2 * POW10_OFFSET {
        x * 0.0
    } else if e < -POW10_OFFSET {
        x / pow10(POW10_OFFSET) / pow10(-e - POW10_OFFSET)
    } else {
        x / pow10(-e)
    }
}

impl Num {
    /// Zero.
    pub const ZERO: Num = Num {
        mantissa: 0.0,
        exponent: 0,
    };
    /// One.
    pub const ONE: Num = Num {
        mantissa: 1.0,
        exponent: 0,
    };
    /// Two.
    pub const TWO: Num = Num {
        mantissa: 2.0,
        exponent: 0,
    };
    /// Ten.
    pub const TEN: Num = Num {
        mantissa: 1.0,
        exponent: 1,
    };
    /// The largest representable value (`9.999999999999998e9000000000000000`).
    /// Overflow saturates here; use it where the TS engine uses `Infinity`.
    pub const MAX: Num = Num {
        mantissa: MANTISSA_MAX,
        exponent: EXP_MAX,
    };
    /// The most negative representable value, `-Num::MAX`.
    pub const MIN: Num = Num {
        mantissa: -MANTISSA_MAX,
        exponent: EXP_MAX,
    };
    /// The smallest positive value, `1e-9000000000000000`.
    pub const MIN_POSITIVE: Num = Num {
        mantissa: 1.0,
        exponent: EXP_MIN,
    };

    /// Builds `mantissa * 10^exponent`, normalising. Any finite mantissa is
    /// accepted; a NaN mantissa gives zero and an infinite one `±Num::MAX`.
    /// Exponents out of range saturate (see the crate docs).
    pub fn new(mantissa: f64, exponent: i64) -> Num {
        if mantissa.is_nan() || mantissa == 0.0 {
            return Num::ZERO;
        }
        if mantissa.is_infinite() {
            return Num::saturated(mantissa < 0.0);
        }
        let (m, k) = split_f64(mantissa);
        Num::checked_parts(m, exponent.saturating_add(k))
    }

    /// Builds a `Num` from an already normalised mantissa and exponent,
    /// without any arithmetic. Usable in `const` context.
    ///
    /// # Panics
    ///
    /// If the parts are not normalised: `mantissa` must be `0.0` with
    /// `exponent == 0`, or satisfy `1 <= |mantissa| < 10` with
    /// `EXP_MIN <= exponent <= EXP_MAX`. Use [`Num::new`] for anything else.
    pub const fn from_parts(mantissa: f64, exponent: i64) -> Num {
        let abs = if mantissa < 0.0 { -mantissa } else { mantissa };
        let zero = mantissa == 0.0 && exponent == 0;
        let normal = abs >= 1.0 && abs < 10.0 && exponent >= EXP_MIN && exponent <= EXP_MAX;
        assert!(zero || normal, "Num::from_parts: parts are not normalised");
        // canonicalise -0.0
        let mantissa = if zero { 0.0 } else { mantissa };
        Num { mantissa, exponent }
    }

    /// The mantissa: `0.0`, or `1 <= |m| < 10`.
    #[inline]
    pub const fn mantissa(&self) -> f64 {
        self.mantissa
    }

    /// The decimal exponent (`0` for zero). For non-zero values this is
    /// `floor(log10(|self|))`, decimal.js's `Decimal#e`.
    #[inline]
    pub const fn exponent(&self) -> i64 {
        self.exponent
    }

    /// `±Num::MAX`.
    #[inline]
    pub(crate) fn saturated(negative: bool) -> Num {
        if negative {
            Num::MIN
        } else {
            Num::MAX
        }
    }

    /// `mantissa` already in `[1, 10)` (or 0); applies the exponent bounds.
    #[inline]
    pub(crate) fn checked_parts(mantissa: f64, exponent: i64) -> Num {
        if mantissa == 0.0 {
            Num::ZERO
        } else if exponent > EXP_MAX {
            Num::saturated(mantissa < 0.0)
        } else if exponent < EXP_MIN {
            Num::ZERO
        } else {
            Num { mantissa, exponent }
        }
    }

    /// Converts an `f64`. NaN becomes zero and `±inf` becomes `±Num::MAX`.
    pub fn from_f64(x: f64) -> Num {
        Num::new(x, 0)
    }

    /// Ten to the power `x`, for any finite `x`. `exp10(f64::INFINITY)` is
    /// [`Num::MAX`], `exp10(-inf)` is zero and `exp10(NaN)` is zero.
    pub fn exp10(x: f64) -> Num {
        if x.is_nan() {
            return Num::ZERO;
        }
        if x >= EXP_MAX as f64 + 1.0 {
            return Num::MAX;
        }
        if x < EXP_MIN as f64 {
            return Num::ZERO;
        }
        if x.fract() == 0.0 {
            return Num::checked_parts(1.0, x as i64);
        }
        let e = x.floor();
        let m = 10f64.powf(x - e);
        Num::new(m, e as i64)
    }

    /// True for zero.
    #[inline]
    pub fn is_zero(&self) -> bool {
        self.mantissa == 0.0
    }

    /// True for values strictly below zero.
    #[inline]
    pub fn is_negative(&self) -> bool {
        self.mantissa < 0.0
    }

    /// True for values strictly above zero.
    #[inline]
    pub fn is_positive(&self) -> bool {
        self.mantissa > 0.0
    }

    /// `-1`, `0` or `1`.
    #[inline]
    pub fn signum(&self) -> i32 {
        if self.mantissa > 0.0 {
            1
        } else if self.mantissa < 0.0 {
            -1
        } else {
            0
        }
    }

    /// Absolute value.
    #[inline]
    pub fn abs(&self) -> Num {
        Num {
            mantissa: self.mantissa.abs(),
            exponent: self.exponent,
        }
    }

    /// True if both values are within `rel_tol` of each other, relative to the
    /// larger magnitude: `|a - b| <= rel_tol * max(|a|, |b|)`. Two zeros are
    /// equal; zero is only approximately equal to zero.
    pub fn approx_eq(&self, other: &Num, rel_tol: f64) -> bool {
        if self == other {
            return true;
        }
        if self.is_zero() || other.is_zero() {
            return false;
        }
        let diff = (*self - *other).abs();
        let big = self.abs().max(other.abs());
        diff <= big * Num::from_f64(rel_tol)
    }

    /// Converts to `f64`. Values beyond the `f64` range give `±inf` (like
    /// decimal.js `toNumber`), tiny values give `0`. Values within a few ulps
    /// of an integer below `1e16` snap to that integer, so integer counts
    /// round-trip exactly (see the crate docs).
    pub fn to_f64(&self) -> f64 {
        let x = scale_f64(self.mantissa, self.exponent);
        if (0..16).contains(&self.exponent) {
            snap_integer(x)
        } else {
            x
        }
    }

    /// Converts to `i64`, truncating toward zero and saturating at
    /// `i64::MIN` / `i64::MAX`.
    pub fn to_i64(&self) -> i64 {
        // `as` saturates and truncates
        self.to_f64() as i64
    }

    /// `Some(n)` if this is a non-negative integer that fits in a `u64`.
    pub fn to_u64_opt(&self) -> Option<u64> {
        if self.is_negative() || !self.is_integer() {
            return None;
        }
        let x = self.to_f64();
        // 2^64 as f64; anything at or above it doesn't fit
        if x >= 18_446_744_073_709_551_616.0 {
            None
        } else {
            Some(x as u64)
        }
    }
}

/// Splits a finite non-zero `f64` into `(m, k)` with `1 <= |m| < 10` and
/// `x ~= m * 10^k`, dividing by exact (or nearest) powers of ten.
pub(crate) fn split_f64(x: f64) -> (f64, i64) {
    debug_assert!(x.is_finite() && x != 0.0);
    let a = x.abs();
    // initial guess; may be one off either way
    let mut k = a.log10().floor() as i64;
    k = k.clamp(-POW10_OFFSET - 16, POW10_OFFSET);
    let mut m = scale_f64(x, -k);
    // fix up rounding of the guess and of the division
    for _ in 0..3 {
        let am = m.abs();
        if am >= 10.0 {
            k += 1;
            m = scale_f64(x, -k);
        } else if am < 1.0 {
            k -= 1;
            m = scale_f64(x, -k);
        } else {
            break;
        }
    }
    // a quotient can still round up to exactly 10 (or down below 1)
    let am = m.abs();
    if am >= 10.0 {
        m /= 10.0;
        k += 1;
    } else if am < 1.0 {
        m *= 10.0;
        k -= 1;
    }
    if m.abs() >= 10.0 {
        m = MANTISSA_MAX.copysign(m);
    }
    (m, k)
}

/// Snaps `x` to the nearest integer when it is within `2 * EPSILON` relative
/// (the error of one normalisation plus one `to_f64`).
#[inline]
pub(crate) fn snap_integer(x: f64) -> f64 {
    let r = x.round();
    if r != x && (x - r).abs() <= x.abs() * (2.0 * f64::EPSILON) {
        r
    } else {
        x
    }
}

impl Default for Num {
    /// Zero.
    fn default() -> Num {
        Num::ZERO
    }
}

impl PartialEq for Num {
    #[inline]
    fn eq(&self, other: &Num) -> bool {
        self.exponent == other.exponent && self.mantissa == other.mantissa
    }
}

impl Eq for Num {}

impl Hash for Num {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // normalised, and zero is always +0.0, so bits are canonical
        self.mantissa.to_bits().hash(state);
        self.exponent.hash(state);
    }
}

impl PartialOrd for Num {
    #[inline]
    fn partial_cmp(&self, other: &Num) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Num {
    fn cmp(&self, other: &Num) -> Ordering {
        let (sa, sb) = (self.signum(), other.signum());
        if sa != sb {
            return sa.cmp(&sb);
        }
        if sa == 0 {
            return Ordering::Equal;
        }
        let mag = self
            .exponent
            .cmp(&other.exponent)
            .then_with(|| self.mantissa.abs().total_cmp(&other.mantissa.abs()));
        if sa > 0 {
            mag
        } else {
            mag.reverse()
        }
    }
}

impl From<f64> for Num {
    /// See [`Num::from_f64`]: NaN becomes zero, `±inf` becomes `±Num::MAX`.
    fn from(x: f64) -> Num {
        Num::from_f64(x)
    }
}

impl From<f32> for Num {
    fn from(x: f32) -> Num {
        Num::from_f64(x as f64)
    }
}

impl From<i32> for Num {
    fn from(x: i32) -> Num {
        Num::from_f64(x as f64)
    }
}

impl From<u32> for Num {
    fn from(x: u32) -> Num {
        Num::from_f64(x as f64)
    }
}

impl From<i64> for Num {
    /// Exact below `1e15`; larger magnitudes keep about 16 significant digits.
    fn from(x: i64) -> Num {
        Num::from_f64(x as f64)
    }
}

impl From<u64> for Num {
    /// Exact below `1e15`; larger values keep about 16 significant digits.
    fn from(x: u64) -> Num {
        Num::from_f64(x as f64)
    }
}

impl From<usize> for Num {
    fn from(x: usize) -> Num {
        Num::from_f64(x as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_handles_edges() {
        for x in [
            1.0,
            9.999999999999998,
            10.0,
            0.1,
            f64::MAX,
            f64::MIN_POSITIVE,
            5e-324,
            -123.0,
            1e22,
            1e23,
        ] {
            let (m, k) = split_f64(x);
            assert!((1.0..10.0).contains(&m.abs()), "{x}: {m}");
            let back = scale_f64(m, k);
            assert!(
                (back - x).abs() <= x.abs() * 1e-15,
                "{x} -> {m}e{k} -> {back}"
            );
        }
    }

    #[test]
    fn from_parts_const() {
        const K: Num = Num::from_parts(1.5, 3);
        assert_eq!(K.to_f64(), 1500.0);
        assert_eq!(Num::from_parts(-0.0, 0), Num::ZERO);
    }

    #[test]
    #[should_panic]
    fn from_parts_rejects_unnormalised() {
        let _ = Num::from_parts(15.0, 0);
    }
}
