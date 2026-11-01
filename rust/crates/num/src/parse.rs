//! Parsing: [`FromStr`] for [`Num`].

use core::fmt;
use core::str::FromStr;

use crate::Num;

/// Why a string could not be parsed as a [`Num`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ParseNumError {
    /// The string was empty (after trimming whitespace).
    Empty,
    /// The string was not a decimal number.
    Invalid,
    /// The string was `NaN`, which a [`Num`] cannot represent.
    NaN,
}

impl fmt::Display for ParseNumError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ParseNumError::Empty => "cannot parse a number from an empty string",
            ParseNumError::Invalid => "invalid number",
            ParseNumError::NaN => "NaN is not a valid number",
        })
    }
}

impl std::error::Error for ParseNumError {}

impl FromStr for Num {
    type Err = ParseNumError;

    /// Parses a decimal number, accepting everything decimal.js's `toString`
    /// and JS `Number#toString` produce, and what old saves contain:
    ///
    /// * optional leading `+` or `-`;
    /// * digits with an optional `.` (`"12"`, `"1.5"`, `".5"`, `"5."`);
    /// * an optional exponent `e`/`E` with optional sign (`"1.5e300"`,
    ///   `"1e+21"`, `"1E5"`, `"2.5e-7"`);
    /// * `Infinity` / `-Infinity` (any case, also `inf`), which saturate to
    ///   `±Num::MAX`.
    ///
    /// Surrounding ASCII whitespace is ignored. Arbitrarily long digit strings
    /// are rounded correctly to the nearest `f64` mantissa; exponents too large
    /// for `i64` saturate. `NaN` is rejected with [`ParseNumError::NaN`].
    fn from_str(s: &str) -> Result<Num, ParseNumError> {
        parse(s)
    }
}

fn parse(s: &str) -> Result<Num, ParseNumError> {
    let s = s.trim_matches(|c: char| c.is_ascii_whitespace());
    if s.is_empty() {
        return Err(ParseNumError::Empty);
    }
    let bytes = s.as_bytes();
    let (negative, body) = match bytes[0] {
        b'-' => (true, &bytes[1..]),
        b'+' => (false, &bytes[1..]),
        _ => (false, bytes),
    };
    if body.eq_ignore_ascii_case(b"infinity") || body.eq_ignore_ascii_case(b"inf") {
        return Ok(Num::saturated(negative));
    }
    if body.eq_ignore_ascii_case(b"nan") {
        return Err(ParseNumError::NaN);
    }

    // split mantissa / exponent
    let (mant, exp) = match body.iter().position(|&c| c == b'e' || c == b'E') {
        Some(i) => (&body[..i], Some(&body[i + 1..])),
        None => (body, None),
    };
    let (int_part, frac_part) = match mant.iter().position(|&c| c == b'.') {
        Some(i) => (&mant[..i], &mant[i + 1..]),
        None => (mant, &mant[mant.len()..]),
    };
    if int_part.is_empty() && frac_part.is_empty() {
        return Err(ParseNumError::Invalid);
    }
    if !int_part.iter().chain(frac_part).all(u8::is_ascii_digit) {
        return Err(ParseNumError::Invalid);
    }

    let exp_value = match exp {
        None => 0i64,
        Some(e) => parse_exponent(e)?,
    };

    // position of the first significant digit, as a power of ten
    let (first_exp, sig_digits): (i64, Vec<u8>) = match int_part.iter().position(|&c| c != b'0') {
        Some(i) => {
            let e = (int_part.len() - 1 - i) as i64;
            (e, int_part[i..].iter().chain(frac_part).copied().collect())
        }
        None => match frac_part.iter().position(|&c| c != b'0') {
            Some(j) => (-(j as i64) - 1, frac_part[j..].to_vec()),
            None => return Ok(Num::ZERO),
        },
    };

    // "d.ddd..." always parses to [1, 10] (10 only by rounding up)
    let mut text = String::with_capacity(sig_digits.len() + 2);
    if negative {
        text.push('-');
    }
    text.push(sig_digits[0] as char);
    if sig_digits.len() > 1 {
        text.push('.');
        text.extend(sig_digits[1..].iter().map(|&c| c as char));
    }
    let mantissa: f64 = text.parse().map_err(|_| ParseNumError::Invalid)?;
    Ok(Num::new(mantissa, exp_value.saturating_add(first_exp)))
}

/// Parses `[+-]?digits`, saturating at the `i64` bounds.
fn parse_exponent(e: &[u8]) -> Result<i64, ParseNumError> {
    let (neg, digits) = match e.first() {
        Some(b'-') => (true, &e[1..]),
        Some(b'+') => (false, &e[1..]),
        _ => (false, e),
    };
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
        return Err(ParseNumError::Invalid);
    }
    let mut v: i64 = 0;
    for &d in digits {
        v = v.saturating_mul(10).saturating_add((d - b'0') as i64);
    }
    Ok(if neg { -v } else { v })
}
