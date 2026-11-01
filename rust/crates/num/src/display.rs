//! Decimal string output: [`Display`](fmt::Display), `to_precision`,
//! `to_fixed`, `to_exponential`.
//!
//! All output starts from the value's *canonical digits*: the mantissa
//! rounded to 15 significant digits (see the crate docs). Further rounding
//! (to fewer digits, in any [`Rounding`] mode) is then exact decimal rounding
//! of those digits, as decimal.js would do on a 15-digit value.

use core::fmt;

use crate::Num;

/// Significant digits in canonical output.
pub(crate) const CANONICAL_DIGITS: usize = 15;

/// Largest digit count accepted by the `to_*` methods, like JS.
const MAX_DIGITS: usize = 100;

/// How to round when a value has more digits than requested. Mirrors the
/// decimal.js rounding modes that Swarm uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Rounding {
    /// Round to nearest, halves away from zero (`ROUND_HALF_UP`, the
    /// decimal.js and JS default).
    #[default]
    HalfUp,
    /// Toward negative infinity (`ROUND_FLOOR`).
    Floor,
    /// Toward positive infinity (`ROUND_CEIL`).
    Ceil,
    /// Toward zero (`ROUND_DOWN`).
    Down,
    /// Away from zero (`ROUND_UP`).
    Up,
}

/// A decimal digit string: `d0.d1d2... * 10^exp`, digit values 0..=9.
/// Empty `digits` means zero.
#[derive(Clone, Debug)]
pub(crate) struct Digits {
    pub(crate) neg: bool,
    pub(crate) digits: Vec<u8>,
    pub(crate) exp: i64,
}

impl Digits {
    /// Rounds so that the last digit has place value `10^place`. The result
    /// has exactly `exp - place + 1` digits, or is zero.
    fn round_to_place(&self, place: i64, mode: Rounding) -> Digits {
        let len = self.digits.len() as i64;
        let keep = self.exp - place + 1;
        if keep >= len {
            let mut digits = self.digits.clone();
            digits.resize(keep as usize, 0);
            return Digits {
                neg: self.neg,
                digits,
                exp: self.exp,
            };
        }
        let cut = keep.max(0) as usize;
        let any_nonzero = self.digits[cut..].iter().any(|&d| d != 0);
        let first_dropped = if keep >= 0 { self.digits[cut] } else { 0 };
        let round_up = match mode {
            Rounding::Down => false,
            Rounding::Up => any_nonzero,
            Rounding::Floor => self.neg && any_nonzero,
            Rounding::Ceil => !self.neg && any_nonzero,
            Rounding::HalfUp => first_dropped >= 5,
        };
        if keep <= 0 {
            return Digits {
                neg: self.neg,
                digits: if round_up { vec![1] } else { Vec::new() },
                exp: place,
            };
        }
        let mut digits = self.digits[..cut].to_vec();
        let mut exp = self.exp;
        if round_up {
            let mut i = digits.len();
            loop {
                if i == 0 {
                    digits.insert(0, 1);
                    exp += 1;
                    break;
                }
                i -= 1;
                if digits[i] == 9 {
                    digits[i] = 0;
                } else {
                    digits[i] += 1;
                    break;
                }
            }
        }
        Digits {
            neg: self.neg,
            digits,
            exp,
        }
    }

    fn is_zero(&self) -> bool {
        self.digits.is_empty()
    }

    /// Plain notation with every digit (no exponent). Requires the digits to
    /// reach at least the units place or the value to be < 1.
    pub(crate) fn plain(&self, out: &mut String) {
        if self.neg {
            out.push('-');
        }
        let last_place = self.exp - self.digits.len() as i64 + 1;
        if self.exp >= 0 {
            for p in (0..=self.exp).rev() {
                out.push(self.digit_at(p));
            }
        } else {
            out.push('0');
        }
        if last_place < 0 {
            out.push('.');
            for p in (last_place..0).rev() {
                out.push(self.digit_at(p));
            }
        }
    }

    /// `d.ddd` followed by `e`, `sign`, exponent.
    fn exponential(&self, out: &mut String, plus: bool) {
        if self.neg {
            out.push('-');
        }
        out.push((b'0' + self.digits[0]) as char);
        if self.digits.len() > 1 {
            out.push('.');
            out.extend(self.digits[1..].iter().map(|&d| (b'0' + d) as char));
        }
        out.push('e');
        if plus && self.exp >= 0 {
            out.push('+');
        }
        out.push_str(&self.exp.to_string());
    }

    fn digit_at(&self, place: i64) -> char {
        let i = self.exp - place;
        if i >= 0 && (i as usize) < self.digits.len() {
            (b'0' + self.digits[i as usize]) as char
        } else {
            '0'
        }
    }
}

impl Num {
    /// The canonical digits: rounded to 15 significant digits, trailing zeros
    /// removed.
    pub(crate) fn canonical_digits(&self) -> Digits {
        if self.is_zero() {
            return Digits {
                neg: false,
                digits: Vec::new(),
                exp: 0,
            };
        }
        // "d.dddddddddddddde<k>" with k = 0, or 1 when rounding reached 10
        let s = format!("{:.*e}", CANONICAL_DIGITS - 1, self.mantissa.abs());
        let (m, k) = s.split_once('e').expect("exponential format");
        let k: i64 = k.parse().expect("exponent");
        let mut digits: Vec<u8> = m
            .bytes()
            .filter(u8::is_ascii_digit)
            .map(|c| c - b'0')
            .collect();
        while digits.last() == Some(&0) {
            digits.pop();
        }
        Digits {
            neg: self.is_negative(),
            digits,
            exp: self.exponent.saturating_add(k),
        }
    }

    /// Like JS `Number#toPrecision` / decimal.js `toPrecision`, rounding
    /// half-up: `digits` significant digits, in exponential notation
    /// (`"1.23e+5"`) when the exponent is below -6 or at least `digits`,
    /// otherwise plain (`"123.0"`). `digits` is clamped to `1..=100`. Digits
    /// past the 15th are zeros.
    pub fn to_precision(&self, digits: usize) -> String {
        self.to_precision_with(digits, Rounding::HalfUp)
    }

    /// [`Num::to_precision`] with an explicit rounding mode.
    pub fn to_precision_with(&self, digits: usize, mode: Rounding) -> String {
        let p = digits.clamp(1, MAX_DIGITS);
        let mut out = String::new();
        if self.is_zero() {
            out.push('0');
            if p > 1 {
                out.push('.');
                out.extend(core::iter::repeat_n('0', p - 1));
            }
            return out;
        }
        let c = self.canonical_digits();
        let mut r = c.round_to_place(c.exp - p as i64 + 1, mode);
        r.digits.truncate(p); // a carry adds a trailing zero
        if r.exp < -6 || r.exp >= p as i64 {
            r.exponential(&mut out, true);
        } else {
            r.plain(&mut out);
        }
        out
    }

    /// Like JS `Number#toExponential(fraction_digits)`: one digit before the
    /// point, `fraction_digits` after, always with an exponent (`"1.50e+3"`).
    /// Rounds half-up; `fraction_digits` is clamped to `0..=100`.
    pub fn to_exponential(&self, fraction_digits: usize) -> String {
        self.to_exponential_with(fraction_digits, Rounding::HalfUp)
    }

    /// [`Num::to_exponential`] with an explicit rounding mode.
    pub fn to_exponential_with(&self, fraction_digits: usize, mode: Rounding) -> String {
        let p = fraction_digits.min(MAX_DIGITS) + 1;
        let mut out = String::new();
        if self.is_zero() {
            let zero = Digits {
                neg: false,
                digits: vec![0; p],
                exp: 0,
            };
            zero.exponential(&mut out, true);
            return out;
        }
        let c = self.canonical_digits();
        let mut r = c.round_to_place(c.exp - p as i64 + 1, mode);
        r.digits.truncate(p);
        r.exponential(&mut out, true);
        out
    }

    /// Like JS `Number#toFixed(digits)`: plain notation with exactly `digits`
    /// decimals, rounding half-up. As in JS, values of `1e21` or more are
    /// returned as [`Display`](fmt::Display) would print them (this also keeps
    /// `1e100000` from becoming a 100 kB string). `digits` is clamped to
    /// `0..=100`.
    pub fn to_fixed(&self, digits: usize) -> String {
        self.to_fixed_with(digits, Rounding::HalfUp)
    }

    /// [`Num::to_fixed`] with an explicit rounding mode.
    pub fn to_fixed_with(&self, digits: usize, mode: Rounding) -> String {
        let dp = digits.min(MAX_DIGITS) as i64;
        if self.exponent >= 21 {
            return self.to_string();
        }
        let c = self.canonical_digits();
        let r = c.round_to_place(-dp, mode);
        let mut out = String::new();
        if r.is_zero() {
            // JS keeps the sign: (-0.001).toFixed(2) == "-0.00"
            if c.neg {
                out.push('-');
            }
            out.push('0');
            if dp > 0 {
                out.push('.');
                out.extend(core::iter::repeat_n('0', dp as usize));
            }
            return out;
        }
        r.plain(&mut out);
        out
    }
}

impl Num {
    /// The value as decimal.js 7 `Decimal#toString` lays it out, from the
    /// canonical 15 significant digits: plain notation when the decimal
    /// exponent is in `-7 < e < 21` (`"0.000001"`, `"123456789"`),
    /// otherwise `d.ddde+X` / `d.ddde-X` (`"1e+21"`, `"1.5e-7"`,
    /// `"1e+100000"`). Differs from [`Display`](fmt::Display) only in the
    /// `+` of positive exponents. Zero prints `"0"` (decimal.js prints
    /// negative zero as `"0"` too).
    pub fn to_decimal_js_string(&self) -> String {
        if self.is_zero() {
            return "0".to_owned();
        }
        let c = self.canonical_digits();
        let mut out = String::new();
        if c.exp > -7 && c.exp < 21 {
            c.plain(&mut out);
        } else {
            c.exponential(&mut out, true);
        }
        out
    }
}

impl fmt::Display for Num {
    /// The canonical, round-trippable form, rounded to 15 significant digits:
    /// plain notation when `1e-7 < |x| < 1e21` (`"0"`, `"123"`, `"0.5"`,
    /// `"123456789012345000000"`), otherwise exponential without a `+`
    /// (`"1.5e300"`, `"1e-7"`, `"-2.5e100000"`). Integers below `1e21` are
    /// printed in full, as JS does. Parsing the output gives back a value that
    /// prints identically.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_zero() {
            return f.pad("0");
        }
        let c = self.canonical_digits();
        let mut out = String::new();
        if c.exp > -7 && c.exp < 21 {
            c.plain(&mut out);
        } else {
            c.exponential(&mut out, false);
        }
        f.pad(&out)
    }
}

#[cfg(test)]
mod decimal_js_tests {
    use crate::Num;

    fn js(s: &str) -> String {
        s.parse::<Num>().unwrap().to_decimal_js_string()
    }

    #[test]
    fn matches_decimal_js_to_string() {
        // decimal.js 7.1.1 defaults: toExpNeg -7, toExpPos 21
        assert_eq!(js("0"), "0");
        assert_eq!(js("-0"), "0");
        assert_eq!(js("35"), "35");
        assert_eq!(js("181027177.703539"), "181027177.703539");
        assert_eq!(js("1e21"), "1e+21");
        assert_eq!(js("1.2345e21"), "1.2345e+21");
        assert_eq!(js("123456789012345678901"), "123456789012346000000");
        assert_eq!(js("1e-7"), "1e-7");
        assert_eq!(js("1.5e-7"), "1.5e-7");
        assert_eq!(js("0.000001"), "0.000001");
        assert_eq!(js("0.0000015"), "0.0000015");
        assert_eq!(js("-2.5e300"), "-2.5e+300");
        assert_eq!(js("1e100000"), "1e+100000");
        assert_eq!(js("-1253203"), "-1253203");
        assert!(Num::MAX.to_decimal_js_string().contains("e+"));
    }
}
