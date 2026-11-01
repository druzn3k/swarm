//! Powers, roots, logarithms and integer rounding.

use crate::Num;

/// Integer exponents up to this magnitude use exponentiation by squaring when
/// the result leaves the `f64` range (at most ~62 multiplications).
const POW_BY_SQUARING_MAX: f64 = 2_147_483_648.0;

/// `f64` results smaller than this are not trusted (subnormal or underflowed)
/// and recomputed through the wide-exponent path.
const F64_TINY: f64 = 1e-300;

/// True if `p` is an odd integer (only possible below `2^53`).
fn is_odd_integer(p: f64) -> bool {
    p.fract() == 0.0 && p.abs() < 9_007_199_254_740_992.0 && (p % 2.0) != 0.0
}

impl Num {
    /// `self` raised to the power `exp`.
    ///
    /// * `x.pow(0.0)` is one for every `x`, including zero.
    /// * Zero to a negative power saturates to [`Num::MAX`].
    /// * A negative base to a non-integer power is a domain error and returns
    ///   zero (JS would give NaN). Negative bases to integer powers work.
    /// * `exp = ±inf` gives `Num::MAX`, zero or one depending on whether
    ///   `|self|` is above, below or at one. `exp = NaN` gives zero.
    ///
    /// Results inside the `f64` range come from `f64::powf`; beyond it,
    /// integer exponents up to `2^31` use exponentiation by squaring and others
    /// go through `log10` (relative error about `|log10(result)| * 1e-16`).
    pub fn pow(&self, exp: f64) -> Num {
        if exp.is_nan() {
            return Num::ZERO;
        }
        if exp == 0.0 {
            return Num::ONE;
        }
        if self.is_zero() {
            return if exp > 0.0 { Num::ZERO } else { Num::MAX };
        }
        let negative_base = self.is_negative();
        if negative_base && exp.is_finite() && exp.fract() != 0.0 {
            return Num::ZERO;
        }
        let a = self.abs();
        if exp.is_infinite() {
            return match (a.cmp(&Num::ONE), exp > 0.0) {
                (core::cmp::Ordering::Equal, _) => Num::ONE,
                (core::cmp::Ordering::Greater, true) | (core::cmp::Ordering::Less, false) => {
                    Num::MAX
                }
                _ => Num::ZERO,
            };
        }
        let magnitude = a.pow_positive(exp);
        if negative_base && is_odd_integer(exp) {
            -magnitude
        } else {
            magnitude
        }
    }

    /// `self.pow(exp)` for a positive `self` and finite non-zero `exp`.
    fn pow_positive(&self, exp: f64) -> Num {
        if self.exponent.abs() <= 300 {
            let r = self.to_f64().powf(exp);
            if r.is_finite() && r >= F64_TINY {
                return Num::from_f64(r);
            }
        }
        if exp.fract() == 0.0 && exp.abs() <= POW_BY_SQUARING_MAX {
            let mut n = exp.abs() as u64;
            let mut base = *self;
            let mut acc = Num::ONE;
            while n > 0 {
                if n & 1 == 1 {
                    acc *= base;
                }
                n >>= 1;
                if n > 0 {
                    base *= base;
                }
            }
            return if exp < 0.0 { acc.recip() } else { acc };
        }
        Num::exp10(self.log10() * exp)
    }

    /// `self` raised to a `Num` power. Exponents beyond the `f64` range act
    /// like `±inf`; otherwise identical to [`Num::pow`].
    pub fn pow_num(&self, exp: &Num) -> Num {
        self.pow(exp.to_f64())
    }

    /// Square root. Negative inputs are a domain error and return zero.
    pub fn sqrt(&self) -> Num {
        if self.is_zero() || self.is_negative() {
            return Num::ZERO;
        }
        if self.exponent.abs() <= 300 {
            return Num::from_f64(self.to_f64().sqrt());
        }
        // make the exponent even, then halve it
        let odd = self.exponent.rem_euclid(2);
        let m = self.mantissa * if odd == 1 { 10.0 } else { 1.0 };
        Num::new(m.sqrt(), (self.exponent - odd) / 2)
    }

    /// The `n`th root, `self^(1/n)`. Odd integer roots of negative numbers
    /// are negative (`(-8).root(3) == -2`); other roots of negative numbers
    /// return zero. `root(0)` behaves like `pow(±inf)`.
    pub fn root(&self, n: f64) -> Num {
        if self.is_negative() && is_odd_integer(n) {
            -(self.abs().pow(1.0 / n))
        } else {
            self.pow(1.0 / n)
        }
    }

    /// Base-10 logarithm, as `f64`. decimal.js's `Decimal#log()` /
    /// `Decimal.log(x)`. Zero gives `-inf`, negative values give NaN.
    pub fn log10(&self) -> f64 {
        if self.is_zero() {
            f64::NEG_INFINITY
        } else if self.is_negative() {
            f64::NAN
        } else {
            self.exponent as f64 + self.mantissa.log10()
        }
    }

    /// Natural logarithm, as `f64`. Zero gives `-inf`, negatives NaN.
    pub fn ln(&self) -> f64 {
        self.log10() * core::f64::consts::LN_10
    }

    /// Logarithm in the given base, as `f64` (`log10(self) / log10(base)`).
    pub fn log(&self, base: f64) -> f64 {
        self.log10() / base.log10()
    }

    /// `1 / self`. The reciprocal of zero is [`Num::MAX`].
    pub fn recip(&self) -> Num {
        Num::ONE / *self
    }

    /// Applies an `f64` integer-rounding function; values of `1e16` and up
    /// are integers already.
    fn integer_op(&self, f: fn(f64) -> f64) -> Num {
        if self.is_zero() || self.exponent >= 16 {
            *self
        } else {
            // to_f64 snaps near-integers, see the crate docs
            Num::from_f64(f(self.to_f64()))
        }
    }

    /// Largest integer `<= self`. Values within a few ulps of an integer are
    /// treated as that integer (crate docs).
    pub fn floor(&self) -> Num {
        self.integer_op(f64::floor)
    }

    /// Smallest integer `>= self`. Values within a few ulps of an integer are
    /// treated as that integer (crate docs).
    pub fn ceil(&self) -> Num {
        self.integer_op(f64::ceil)
    }

    /// Nearest integer, halves away from zero (decimal.js's default
    /// `ROUND_HALF_UP`).
    pub fn round(&self) -> Num {
        self.integer_op(f64::round)
    }

    /// Integer part, rounding toward zero.
    pub fn trunc(&self) -> Num {
        self.integer_op(f64::trunc)
    }

    /// True if the value is an integer. Every value of `1e16` or more is.
    pub fn is_integer(&self) -> bool {
        if self.is_zero() || self.exponent >= 16 {
            true
        } else if self.exponent < 0 {
            false
        } else {
            self.to_f64().fract() == 0.0
        }
    }
}
