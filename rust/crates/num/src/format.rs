//! Human-readable number formatting, ported from `app/src/format.ts`
//! (itself a port of swarm-numberformat 0.2.0, the old game's formatter).
//!
//! ```
//! use swarm_num::Num;
//! use swarm_num::format::{format_long, format_short};
//!
//! assert_eq!(format_short(&Num::from(1_234_567)), "1.23M");
//! assert_eq!(format_long(&Num::from(1_234_567)), "1.23456 million");
//! assert_eq!(format_short(&Num::from(12_345)), "12,345");
//! assert_eq!(format_short(&"1.5e400".parse().unwrap()), "1.5e400");
//! ```
//!
//! Like the TypeScript formatter, numbers round *down* (`ROUND_FLOOR`) and
//! trailing zeros are dropped. Differences: there are no NaN or infinite
//! inputs, so `"?"` is never produced, and [`Num::MAX`] / [`Num::MIN`] (the
//! saturated stand-ins for infinity) print as `"∞"` / `"-∞"`.

use crate::display::Rounding;
use crate::suffixes::{NUMBER_SUFFIXES_LONG, NUMBER_SUFFIXES_SHORT};
use crate::Num;

/// Which notation to use for large numbers (`Notation` in `format.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Notation {
    /// Suffixes from the tables (`"1.23M"`, `"1.23 million"`), falling back
    /// to `"1.23e303"` past the end of the table.
    #[default]
    StandardDecimal,
    /// Always `"1.23e6"`.
    ScientificE,
    /// Suffixes up to decillion (index 11), then `"1.23e36"`.
    Hybrid,
    /// Exponents that are multiples of three: `"1.23E6"`.
    Engineering,
}

/// Short (`bignum`) or long (`longnum`) output (`Flavor` in `format.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Flavor {
    /// `"1.23M"`.
    #[default]
    Short,
    /// `"1.2345 million"`.
    Full,
}

/// Options for [`format_number`] (`NumberOptions` in `format.ts`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FormatOptions {
    /// Notation for large numbers.
    pub notation: Notation,
    /// Short or long suffixes.
    pub flavor: Flavor,
    /// Significant figures for suffixed numbers. `None`: 3 for
    /// [`Flavor::Short`], 5 for [`Flavor::Full`].
    pub sigfigs: Option<usize>,
    /// Numbers below this are written out in full, floored and grouped
    /// (`"12,345"`). Default `1e5`.
    pub min_suffix: f64,
    /// Numbers below this keep their decimals (e.g. energy). Default `0`.
    pub max_small: f64,
}

impl Default for FormatOptions {
    fn default() -> FormatOptions {
        FormatOptions {
            notation: Notation::StandardDecimal,
            flavor: Flavor::Short,
            sigfigs: None,
            min_suffix: 1e5,
            max_small: 0.0,
        }
    }
}

/// Short format, like the app's `Formatter.num` / the old `bignum` filter:
/// `"99,999"`, `"100K"`, `"1.23M"`, `"1.5e400"`.
pub fn format_short(value: &Num) -> String {
    format_number(value, &FormatOptions::default())
}

/// Long format, like the app's `Formatter.long` / the old `longnum` filter
/// (six significant figures): `"123.456 thousand"`, `"8 million"`.
pub fn format_long(value: &Num) -> String {
    format_number(
        value,
        &FormatOptions {
            flavor: Flavor::Full,
            sigfigs: Some(6),
            ..FormatOptions::default()
        },
    )
}

/// `formatNumber` from `format.ts`.
pub fn format_number(value: &Num, opts: &FormatOptions) -> String {
    if *value == Num::MAX {
        return "∞".to_owned();
    }
    if *value == Num::MIN {
        return "-∞".to_owned();
    }
    let sigfigs = opts.sigfigs.unwrap_or(match opts.flavor {
        Flavor::Short => 3,
        Flavor::Full => 5,
    });
    let abs = value.abs();
    if abs < Num::from_f64(opts.max_small) {
        return trim_zeros(&value.to_precision_with(sigfigs, Rounding::Floor));
    }
    if abs < Num::from_f64(opts.min_suffix) {
        return grouped(&value.floor());
    }
    let index = value.exponent().div_euclid(3);
    match suffix_for(opts.notation, opts.flavor, index) {
        None => trim_zeros(
            &value
                .to_exponential_with(sigfigs.saturating_sub(1), Rounding::Floor)
                .replace("e+", "e"),
        ),
        Some(suffix) => {
            // divide by 1000^index exactly, by shifting the exponent
            let prefix = Num::new(value.mantissa(), value.exponent() - index * 3);
            let mut out = trim_zeros(&prefix.to_precision_with(sigfigs, Rounding::Floor));
            out.push_str(&suffix);
            out
        }
    }
}

fn suffix_for(notation: Notation, flavor: Flavor, index: i64) -> Option<String> {
    if index < 0 {
        return Some(String::new());
    }
    match notation {
        Notation::Engineering => Some(if index == 0 {
            String::new()
        } else {
            format!("E{}", index * 3)
        }),
        Notation::ScientificE => None,
        Notation::Hybrid | Notation::StandardDecimal => {
            let list = match flavor {
                Flavor::Full => NUMBER_SUFFIXES_LONG,
                Flavor::Short => NUMBER_SUFFIXES_SHORT,
            };
            let limit = if notation == Notation::Hybrid {
                12
            } else {
                list.len()
            };
            if (index as u64) < limit as u64 {
                Some(list[index as usize].to_owned())
            } else {
                None
            }
        }
    }
}

/// An integer-valued `Num` with en-US thousands separators: `"-1,234,567"`.
fn grouped(int: &Num) -> String {
    let c = int.canonical_digits();
    let mut plain = String::new();
    if c.digits.is_empty() {
        return "0".to_owned();
    }
    c.plain(&mut plain);
    let (sign, digits) = match plain.strip_prefix('-') {
        Some(d) => ("-", d),
        None => ("", plain.as_str()),
    };
    let mut out = String::with_capacity(plain.len() + digits.len() / 3);
    out.push_str(sign);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// Drops trailing zeros after the decimal point, like `trimZeros` in
/// `format.ts`: `"8.00000"` becomes `"8"`, `"1.50e300"` becomes `"1.5e300"`.
/// Only the first decimal point's digits are touched.
pub fn trim_zeros(s: &str) -> String {
    let mut out = s.to_owned();
    // /(\.\d*?)0+(?=\D|$)/ -> "$1": the first '.' whose digit run ends in 0
    let bytes = out.as_bytes();
    let mut cut = None;
    for (i, _) in out.match_indices('.') {
        let mut end = i + 1;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end > i + 1 && bytes[end - 1] == b'0' {
            let mut start = end;
            while start > i + 1 && bytes[start - 1] == b'0' {
                start -= 1;
            }
            cut = Some((start, end));
            break;
        }
    }
    if let Some((start, end)) = cut {
        out.replace_range(start..end, "");
    }
    // /\.(?=\D|$)/ -> "": the first '.' not followed by a digit
    let bytes = out.as_bytes();
    let dot = (0..bytes.len())
        .find(|&i| bytes[i] == b'.' && !bytes.get(i + 1).is_some_and(u8::is_ascii_digit));
    if let Some(i) = dot {
        out.remove(i);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_zeros_matches_regexes() {
        assert_eq!(trim_zeros("8.00000"), "8");
        assert_eq!(trim_zeros("1.50e300"), "1.5e300");
        assert_eq!(trim_zeros("1.23"), "1.23");
        assert_eq!(trim_zeros("100"), "100");
        assert_eq!(trim_zeros("1.00e+5"), "1e+5");
        assert_eq!(trim_zeros("120.0 million"), "120 million");
        assert_eq!(trim_zeros("0.0010"), "0.001");
    }

    #[test]
    fn grouping() {
        assert_eq!(grouped(&Num::from(0)), "0");
        assert_eq!(grouped(&Num::from(999)), "999");
        assert_eq!(grouped(&Num::from(1000)), "1,000");
        assert_eq!(grouped(&Num::from(-1_234_567)), "-1,234,567");
    }
}
