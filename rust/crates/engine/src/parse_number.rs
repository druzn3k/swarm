//! Port of `engine/src/parsenumber.ts` (itself a port of the Coffee
//! `parsenumber` service): user number input.
//!
//! Accepted forms, after stripping the first comma:
//!
//! * plain numbers, `12345`, `12.345e3`, `1,000`;
//! * suffixes, short (`12k`, `12qa`) or long (`12 thousand`), matched
//!   case-insensitively against [`swarm_num::suffixes`];
//! * `N%`: that percentage (clamped to 0..100, unparseable counts as 0) of
//!   what the unit can afford, via [`ParseNumberUnit::max_cost_met`];
//! * `=N`: exactly `N` units, ignoring twins (`ceil(N / twin_mult)` purchases);
//! * `@N`: enough purchases to *have* `N` units afterwards.
//!
//! The result is always at least 1 and whole.
//!
//! # Differences from the TypeScript
//!
//! * The TS parses with decimal.js (arbitrary precision, rounding up at 20
//!   digits); here `Num` keeps 15 significant digits, so inputs with more than
//!   15 digits are rounded to nearest by `Num`, not ceiled. Ceil semantics are
//!   kept where they are observable on `Num` (after the twin division).
//! * decimal.js also accepts hex/binary/octal literals; integer ones are
//!   supported (`0x10`), fractional ones (`0x1.8`, `0x1p3`) are not.
//! * Whitespace other than the single space before a long suffix makes the
//!   input unparseable (decimal.js rejects it too).
//! * `%`, `=` and `@` with no unit return `None` (the TS throws or returns
//!   `undefined`).

use swarm_num::suffixes::{NUMBER_SUFFIXES_LONG, NUMBER_SUFFIXES_SHORT};
use swarm_num::Num;

/// The slice of a unit that parsing needs; the engine implements it.
pub trait ParseNumberUnit {
    /// How many of this unit can be bought with `percent` (0..=1) of the
    /// resources currently available; [`Num::MAX`] without costs (TS
    /// `Infinity`), which makes `%` input unparseable like the TS.
    fn max_cost_met(&self, percent: Num) -> Num;
    /// Current count of the unit.
    fn count(&self) -> Num;
    /// Twin multiplier: units gained per purchase.
    fn twin_mult(&self) -> Num;
}

/// Looks up a (lowercased) suffix, including a long suffix's leading space,
/// and returns the replacement exponent text, e.g. `"e3"`.
fn suffix_replacement(lowercase: &str) -> Option<String> {
    for table in [NUMBER_SUFFIXES_SHORT, NUMBER_SUFFIXES_LONG] {
        for (index, suffix) in table.iter().enumerate() {
            if !suffix.is_empty() && suffix.to_ascii_lowercase() == lowercase {
                return Some(format!("e{}", index * 3));
            }
        }
    }
    None
}

/// decimal.js's `0x`/`0b`/`0o` integer literals (`new Decimal("0x10")` is
/// 16), with an optional sign. Fractional and `p`-exponent forms, which
/// decimal.js also reads, are not supported.
fn parse_radix(s: &str) -> Option<Num> {
    let (neg, rest) = match s.as_bytes().first()? {
        b'-' => (true, &s[1..]),
        b'+' => (false, &s[1..]),
        _ => (false, s),
    };
    let radix = match rest.get(..2)? {
        "0x" | "0X" => 16,
        "0b" | "0B" => 2,
        "0o" | "0O" => 8,
        _ => return None,
    };
    let digits = &rest[2..];
    if digits.is_empty() {
        return None;
    }
    let mut v = Num::ZERO;
    for c in digits.chars() {
        v = v * Num::from(radix) + Num::from(c.to_digit(radix)?);
    }
    Some(if neg { -v } else { v })
}

/// Strict decimal parse: only digits, `.`, signs and `e`/`E` (or a
/// [`parse_radix`] literal), so that whitespace, `inf`, `nan` and stray text
/// are all rejected.
fn parse_plain(s: &str) -> Option<Num> {
    if let Some(n) = parse_radix(s) {
        return Some(n);
    }
    if s.is_empty()
        || !s
            .bytes()
            .all(|c| c.is_ascii_digit() || b".+-eE".contains(&c))
    {
        return None;
    }
    s.parse::<Num>().ok()
}

/// Parses user-entered number text. See the [module docs](self).
///
/// Returns `None` where the TS returns `undefined`: unparseable input, or the
/// `%`/`=`/`@` forms without a `unit`.
pub fn parse_number(input: &str, unit: Option<&dyn ParseNumberUnit>) -> Option<Num> {
    // TS `replace(",", "")` removes the first comma only.
    let mut value = input.replacen(',', "", 1);
    let mut notwins = false;
    let mut target = false;

    let parsed: Num = if value.ends_with('%') {
        // percentage of max buyable; the result skips suffix/=/@ handling
        let text = value.replacen('%', "", 1);
        let percent = match parse_plain(&text) {
            Some(p) => p.max(Num::ZERO).min(Num::from(100)),
            None => Num::ZERO,
        };
        let max = unit?.max_cost_met(percent / Num::from(100));
        if max == Num::MAX {
            // the TS Infinity of a unit without costs: not finite, undefined
            return None;
        }
        max
    } else {
        // replace suffixes ('billion'): first run of letters, with an
        // optional preceding space
        let bytes = value.as_bytes();
        if let Some(first) = bytes.iter().position(|c| c.is_ascii_alphabetic()) {
            let start = if first > 0 && bytes[first - 1] == b' ' {
                first - 1
            } else {
                first
            };
            let end = start
                + bytes[start..]
                    .iter()
                    .skip_while(|c| **c == b' ')
                    .take_while(|c| c.is_ascii_alphabetic())
                    .count()
                + (first - start);
            let word = value[start..end].to_ascii_lowercase();
            if let Some(rep) = suffix_replacement(&word) {
                value.replace_range(start..end, &rep);
            }
        }
        // exact-value, accounting for twins
        if let Some(rest) = value.strip_prefix('=') {
            notwins = true;
            value = rest.to_string();
        } else if let Some(rest) = value.strip_prefix('@') {
            // target-value: buy enough units to have this many afterward
            target = true;
            notwins = true;
            value = rest.to_string();
        }
        parse_plain(&value)?
    };

    let mut ret = parsed.max(Num::ONE);
    if target {
        ret = (ret - unit?.count()).max(Num::ONE);
    }
    if notwins {
        // twins round up: buy at least as many as requested
        Some((ret / unit?.twin_mult()).ceil())
    } else {
        // normally, decimal numbers round down
        Some(ret.floor())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        count: Num,
        twin: Num,
        max_cost: Num,
    }
    impl Fake {
        fn new() -> Fake {
            Fake {
                count: Num::ZERO,
                twin: Num::ONE,
                max_cost: Num::ZERO,
            }
        }
    }
    impl ParseNumberUnit for Fake {
        fn max_cost_met(&self, percent: Num) -> Num {
            if self.max_cost == Num::MAX {
                return Num::MAX;
            }
            (self.max_cost * percent).floor()
        }
        fn count(&self) -> Num {
            self.count
        }
        fn twin_mult(&self) -> Num {
            self.twin
        }
    }

    fn p(s: &str) -> Option<f64> {
        parse_number(s, None).map(|n| n.to_f64())
    }
    fn pu(s: &str, u: &Fake) -> Option<f64> {
        parse_number(s, Some(u)).map(|n| n.to_f64())
    }
    fn n(s: &str) -> Num {
        s.parse().unwrap()
    }

    #[test]
    fn formats() {
        for s in [
            "12345",
            "12,345",
            "12.345e3",
            "12.345E3",
            "12.345e+3",
            "12.345E+3",
        ] {
            assert_eq!(p(s), Some(12345.0), "{s}");
        }
        for s in [
            "fgsfds", "12e", "12E", "", "  ", "abc1", "inf", "Infinity", "NaN",
        ] {
            assert_eq!(p(s), None, "{s}");
        }
        assert_eq!(p("-1"), Some(1.0));
        assert_eq!(p("0"), Some(1.0));
        assert_eq!(p("-5"), Some(1.0));
        assert_eq!(p("12.999"), Some(12.0));
        assert_eq!(p("1,000"), Some(1000.0));
        // only the first comma is stripped
        assert_eq!(p("1,000,000"), None);
        assert_eq!(parse_number("1e3000", None), Some(n("1e3000")));
        // decimal.js reads radix literals (golden parsenumber.json step 48)
        assert_eq!(p("0x10"), Some(16.0));
        // like the TS, "b" is first read as the billions suffix: "0e9101"
        assert_eq!(p("0b101"), Some(1.0));
        assert_eq!(parse_radix("0b101"), Some(Num::from(5)));
        assert_eq!(p("0o17"), Some(15.0));
        assert_eq!(p("0x"), None);
        // a unit without costs: maxCostMet is Infinity, so undefined
        let free = Fake {
            max_cost: Num::MAX,
            ..Fake::new()
        };
        assert_eq!(pu("50%", &free), None);
        assert_eq!(p("0xg"), None);
        assert_eq!(parse_number("55e3000", None), Some(n("5.5e3001")));
    }

    #[test]
    fn suffixes() {
        assert_eq!(p("12 thousand"), Some(12000.0));
        assert_eq!(p("12.345 thousand"), Some(12345.0));
        assert_eq!(p("12k"), Some(12000.0));
        assert_eq!(p("12.345k"), Some(12345.0));
        assert_eq!(p("12.345 ThOuSaNd"), Some(12345.0));
        assert_eq!(p("12.345K"), Some(12345.0));
        assert_eq!(p("12 million"), Some(12e6));
        assert_eq!(p("12 billion"), Some(12e9));
        assert_eq!(p("12 trillion"), Some(12e12));
        assert_eq!(p("12 quadrillion"), Some(12e15));
        assert_eq!(p("12 brazillion"), None);
        assert_eq!(p("12m"), Some(12e6));
        assert_eq!(p("12b"), Some(12e9));
        assert_eq!(p("12t"), Some(12e12));
        assert_eq!(p("12q"), None);
        assert_eq!(p("12qa"), Some(12e15));
        assert_eq!(p("1.5 billion"), Some(1.5e9));
        assert_eq!(p("2B"), Some(2e9));
        assert_eq!(p("12 k"), None);
        assert_eq!(p("12thousand"), None);
    }

    #[test]
    fn no_duplicate_suffixes() {
        let mut seen = std::collections::HashSet::new();
        for table in [NUMBER_SUFFIXES_SHORT, NUMBER_SUFFIXES_LONG] {
            for s in table.iter().filter(|s| !s.is_empty()) {
                assert!(seen.insert(s.to_ascii_lowercase()), "duplicate suffix {s}");
            }
        }
    }

    #[test]
    fn percents() {
        let mut u = Fake::new();
        u.max_cost = Num::from(10);
        assert_eq!(pu("100%", &u), Some(10.0));
        assert_eq!(pu("50%", &u), Some(5.0));
        assert_eq!(pu("49.99999%", &u), Some(4.0));
        assert_eq!(pu("0%", &u), Some(1.0));
        assert_eq!(pu("-1%", &u), Some(1.0));
        assert_eq!(pu("9999%", &u), Some(10.0));
        assert_eq!(pu("garbage%", &u), Some(1.0));
        assert_eq!(p("50%"), None);
    }

    #[test]
    fn twins() {
        let mut u = Fake::new();
        assert_eq!(pu("=1000", &u), Some(1000.0));
        u.twin = Num::from(2);
        assert_eq!(pu("=1000", &u), Some(500.0));
        assert_eq!(pu("=1001", &u), Some(501.0));
        assert_eq!(pu("=12.5", &u), Some(7.0));
        u.twin = Num::from(8);
        assert_eq!(pu("=100", &u), Some(13.0));
        assert_eq!(pu("=1000", &u), Some(125.0));
        assert_eq!(pu("=1001", &u), Some(126.0));
        assert_eq!(pu("=1k", &u), Some(125.0));
        assert_eq!(pu("=1.001k", &u), Some(126.0));
        assert_eq!(pu("=1 thousand", &u), Some(125.0));
        assert_eq!(p("=5"), None);
    }

    #[test]
    fn target() {
        let mut u = Fake::new();
        assert_eq!(pu("@1000", &u), Some(1000.0));
        u.count = Num::from(200);
        assert_eq!(pu("@1000", &u), Some(800.0));
        u.twin = Num::from(2);
        u.count = Num::ZERO;
        assert_eq!(pu("@1000", &u), Some(500.0));
        assert_eq!(pu("@1001", &u), Some(501.0));
        u.twin = Num::from(8);
        assert_eq!(pu("@100", &u), Some(13.0));
        assert_eq!(pu("@1000", &u), Some(125.0));
        assert_eq!(pu("@1001", &u), Some(126.0));
        assert_eq!(pu("@1k", &u), Some(125.0));
        assert_eq!(pu("@1.001k", &u), Some(126.0));
        assert_eq!(pu("@1 thousand", &u), Some(125.0));
        u.count = Num::from(200);
        assert_eq!(pu("@100", &u), Some(1.0));
        assert_eq!(pu("@1000", &u), Some(100.0));
        assert_eq!(pu("@1k", &u), Some(100.0));
        u.twin = Num::ONE;
        u.count = Num::from(40);
        assert_eq!(pu("@100", &u), Some(60.0));
        assert_eq!(p("@5"), None);
    }

    #[test]
    fn equals_percent_is_one() {
        // #617
        let u = Fake::new();
        assert_eq!(pu("=50%", &u), Some(1.0));
    }
}
