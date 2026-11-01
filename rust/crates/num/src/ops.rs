//! Arithmetic operator implementations.
//!
//! All four basic operations take an `f64` fast path when both operands have
//! exponents within ±[`F64_SAFE_EXP`]: the operation is done in `f64` and the
//! result re-normalised, which keeps integer arithmetic below `1e15` exact.
//! Otherwise they work on mantissa and exponent directly.

use core::iter::{Product, Sum};
use core::ops::{
    Add, AddAssign, Div, DivAssign, Mul, MulAssign, Neg, Rem, RemAssign, Sub, SubAssign,
};

use crate::{pow10, Num, F64_SAFE_EXP};

#[inline]
fn both_safe(a: &Num, b: &Num) -> bool {
    a.exponent.abs() <= F64_SAFE_EXP && b.exponent.abs() <= F64_SAFE_EXP
}

/// Exponent difference beyond which the smaller addend cannot affect the
/// larger one's `f64` mantissa.
const ADD_IGNORE_DIGITS: i64 = 17;

fn add(a: Num, b: Num) -> Num {
    if a.is_zero() {
        return b;
    }
    if b.is_zero() {
        return a;
    }
    if both_safe(&a, &b) {
        return Num::from_f64(a.to_f64() + b.to_f64());
    }
    let (big, small) = if a.exponent >= b.exponent {
        (a, b)
    } else {
        (b, a)
    };
    let d = big.exponent - small.exponent;
    if d > ADD_IGNORE_DIGITS {
        return big;
    }
    Num::new(big.mantissa + small.mantissa / pow10(d), big.exponent)
}

fn mul(a: Num, b: Num) -> Num {
    if a.is_zero() || b.is_zero() {
        return Num::ZERO;
    }
    if both_safe(&a, &b) {
        return Num::from_f64(a.to_f64() * b.to_f64());
    }
    // exponents are bounded by EXP_MAX, so the sum cannot overflow i64
    Num::new(a.mantissa * b.mantissa, a.exponent + b.exponent)
}

fn div(a: Num, b: Num) -> Num {
    if b.is_zero() {
        return if a.is_zero() {
            Num::ZERO
        } else {
            Num::saturated(a.is_negative())
        };
    }
    if a.is_zero() {
        return Num::ZERO;
    }
    if both_safe(&a, &b) {
        return Num::from_f64(a.to_f64() / b.to_f64());
    }
    Num::new(a.mantissa / b.mantissa, a.exponent - b.exponent)
}

/// Truncated remainder: the result has the sign of the dividend, like JS `%`
/// and decimal.js's default `modulo`.
fn rem(a: Num, b: Num) -> Num {
    if a.is_zero() || b.is_zero() {
        return Num::ZERO;
    }
    if a.abs() < b.abs() {
        return a;
    }
    if a.exponent.abs() <= 300 && b.exponent.abs() <= 300 {
        // fmod is exact
        return Num::from_f64(a.to_f64() % b.to_f64());
    }
    if a.exponent - b.exponent > 16 {
        // the quotient has no fractional digits left at this precision
        return Num::ZERO;
    }
    let q = (a / b).trunc();
    a - q * b
}

impl Neg for Num {
    type Output = Num;
    #[inline]
    fn neg(self) -> Num {
        if self.is_zero() {
            self
        } else {
            Num {
                mantissa: -self.mantissa,
                exponent: self.exponent,
            }
        }
    }
}

impl Neg for &Num {
    type Output = Num;
    #[inline]
    fn neg(self) -> Num {
        -*self
    }
}

macro_rules! binop {
    ($Trait:ident, $method:ident, $AssignTrait:ident, $assign:ident, $f:ident, $doc:literal) => {
        impl $Trait<Num> for Num {
            type Output = Num;
            #[doc = $doc]
            #[inline]
            fn $method(self, rhs: Num) -> Num {
                $f(self, rhs)
            }
        }
        impl $Trait<&Num> for Num {
            type Output = Num;
            #[doc = $doc]
            #[inline]
            fn $method(self, rhs: &Num) -> Num {
                $f(self, *rhs)
            }
        }
        impl $Trait<Num> for &Num {
            type Output = Num;
            #[doc = $doc]
            #[inline]
            fn $method(self, rhs: Num) -> Num {
                $f(*self, rhs)
            }
        }
        impl $Trait<&Num> for &Num {
            type Output = Num;
            #[doc = $doc]
            #[inline]
            fn $method(self, rhs: &Num) -> Num {
                $f(*self, *rhs)
            }
        }
        impl $Trait<f64> for Num {
            type Output = Num;
            #[doc = $doc]
            #[doc = ""]
            #[doc = "The `f64` is converted with [`Num::from_f64`]."]
            #[inline]
            fn $method(self, rhs: f64) -> Num {
                $f(self, Num::from_f64(rhs))
            }
        }
        impl $Trait<f64> for &Num {
            type Output = Num;
            #[doc = $doc]
            #[doc = ""]
            #[doc = "The `f64` is converted with [`Num::from_f64`]."]
            #[inline]
            fn $method(self, rhs: f64) -> Num {
                $f(*self, Num::from_f64(rhs))
            }
        }
        impl $AssignTrait<Num> for Num {
            #[inline]
            fn $assign(&mut self, rhs: Num) {
                *self = $f(*self, rhs);
            }
        }
        impl $AssignTrait<&Num> for Num {
            #[inline]
            fn $assign(&mut self, rhs: &Num) {
                *self = $f(*self, *rhs);
            }
        }
        impl $AssignTrait<f64> for Num {
            #[inline]
            fn $assign(&mut self, rhs: f64) {
                *self = $f(*self, Num::from_f64(rhs));
            }
        }
    };
}

binop!(
    Add,
    add,
    AddAssign,
    add_assign,
    add,
    "Addition. Saturates at `±Num::MAX`."
);
binop!(
    Sub,
    sub,
    SubAssign,
    sub_assign,
    sub_num,
    "Subtraction. Saturates at `±Num::MAX`."
);
binop!(
    Mul,
    mul,
    MulAssign,
    mul_assign,
    mul,
    "Multiplication. Saturates at `±Num::MAX`, underflows to zero."
);
binop!(
    Div,
    div,
    DivAssign,
    div_assign,
    div,
    "Division. `x / 0` is `±Num::MAX` (sign of `x`) and `0 / 0` is zero."
);
binop!(
    Rem,
    rem,
    RemAssign,
    rem_assign,
    rem,
    "Truncated remainder with the sign of the dividend (JS `%`, decimal.js `modulo`). \
     `x % 0` is zero; when `|x / y|` exceeds about `1e16` the result is zero."
);

#[inline]
fn sub_num(a: Num, b: Num) -> Num {
    add(a, -b)
}

impl Sum for Num {
    fn sum<I: Iterator<Item = Num>>(iter: I) -> Num {
        iter.fold(Num::ZERO, add)
    }
}

impl<'a> Sum<&'a Num> for Num {
    fn sum<I: Iterator<Item = &'a Num>>(iter: I) -> Num {
        iter.fold(Num::ZERO, |a, b| add(a, *b))
    }
}

impl Product for Num {
    fn product<I: Iterator<Item = Num>>(iter: I) -> Num {
        iter.fold(Num::ONE, mul)
    }
}

impl<'a> Product<&'a Num> for Num {
    fn product<I: Iterator<Item = &'a Num>>(iter: I) -> Num {
        iter.fold(Num::ONE, |a, b| mul(a, *b))
    }
}
