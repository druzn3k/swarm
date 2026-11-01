//! Unit and property-style tests for `Num`.
#![allow(clippy::op_ref)] // operator forms on references are tested on purpose

use std::collections::HashSet;

use swarm_num::format::{format_long, format_short};
use swarm_num::{Num, ParseNumError, Rounding, EXP_MAX};

/// xorshift64*: tiny deterministic PRNG for property tests.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.max(1))
    }
    fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    /// Uniform in [0, 1).
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
    /// A random f64 with magnitude 10^[lo, hi) and random sign.
    fn f64_mag(&mut self, lo: f64, hi: f64) -> f64 {
        let x = 10f64.powf(self.range(lo, hi));
        if self.next_u64() & 1 == 0 {
            x
        } else {
            -x
        }
    }
    /// A random Num with exponent in [lo, hi) and random sign.
    fn num(&mut self, lo: i64, hi: i64) -> Num {
        let m = self.range(1.0, 10.0);
        let e = lo + (self.next_u64() % (hi - lo) as u64) as i64;
        let m = if self.next_u64() & 1 == 0 { m } else { -m };
        Num::new(m, e)
    }
}

const ITERS: usize = 20_000;

fn n(s: &str) -> Num {
    s.parse().unwrap()
}

fn rel_close(a: f64, b: f64, tol: f64) -> bool {
    a == b || (a - b).abs() <= tol * a.abs().max(b.abs())
}

fn assert_normalised(x: &Num) {
    if x.is_zero() {
        assert_eq!(x.mantissa().to_bits(), 0.0f64.to_bits(), "{x:?}");
        assert_eq!(x.exponent(), 0, "{x:?}");
    } else {
        let m = x.mantissa().abs();
        assert!((1.0..10.0).contains(&m), "not normalised: {x:?}");
        assert!(x.exponent().abs() <= EXP_MAX, "{x:?}");
    }
}

// ---------------------------------------------------------------- construction

#[test]
fn constants() {
    assert_eq!(Num::ZERO.to_f64(), 0.0);
    assert_eq!(Num::ONE.to_f64(), 1.0);
    assert_eq!(Num::TWO.to_f64(), 2.0);
    assert_eq!(Num::TEN.to_f64(), 10.0);
    assert_eq!(Num::default(), Num::ZERO);
    assert!(Num::MAX > n("1e100000"));
    assert!(Num::MIN < n("-1e100000"));
    assert_eq!(-Num::MAX, Num::MIN);
    assert!(Num::MIN_POSITIVE > Num::ZERO);
    for c in [
        Num::ZERO,
        Num::ONE,
        Num::TWO,
        Num::TEN,
        Num::MAX,
        Num::MIN,
        Num::MIN_POSITIVE,
    ] {
        assert_normalised(&c);
    }
}

#[test]
fn new_normalises() {
    assert_eq!(Num::new(150.0, 1), n("1500"));
    assert_eq!(Num::new(0.015, 3), n("15"));
    assert_eq!(Num::new(-0.0, 7), Num::ZERO);
    assert_eq!(Num::new(f64::NAN, 3), Num::ZERO);
    assert_eq!(Num::new(f64::INFINITY, 3), Num::MAX);
    assert_eq!(Num::new(f64::NEG_INFINITY, 3), Num::MIN);
    assert_eq!(Num::new(5.0, EXP_MAX + 1), Num::MAX);
    assert_eq!(Num::new(-5.0, i64::MAX), Num::MIN);
    assert_eq!(Num::new(5.0, -EXP_MAX - 1), Num::ZERO);
    assert_eq!(Num::new(5.0, i64::MIN), Num::ZERO);
    let x = Num::new(1234.5, 100);
    assert_eq!((x.mantissa(), x.exponent()), (1.2345, 103));
}

#[test]
fn from_integers_and_floats() {
    assert_eq!(Num::from(12345i32).to_f64(), 12345.0);
    assert_eq!(Num::from(-7i64).to_i64(), -7);
    assert_eq!(Num::from(u64::MAX).to_u64_opt(), None); // 2^64 after rounding
    assert_eq!(Num::from(1u64 << 52).to_u64_opt(), Some(1 << 52));
    assert_eq!(Num::from(f64::NAN), Num::ZERO);
    assert_eq!(Num::from(f64::INFINITY), Num::MAX);
    assert!(Num::from(5e-324).approx_eq(&Num::new(4.940656458412465, -324), 1e-15));
    assert_eq!(Num::from(5e-324).to_f64(), 5e-324);
    assert_eq!(Num::from(f64::MAX).to_f64(), f64::MAX);
}

#[test]
fn integers_round_trip_exactly() {
    let mut rng = Rng::new(1);
    for _ in 0..ITERS {
        let i = (rng.next_u64() % 1_000_000_000_000_000) as i64
            * if rng.next_u64() & 1 == 0 { 1 } else { -1 };
        let x = Num::from(i);
        assert_normalised(&x);
        assert_eq!(x.to_i64(), i, "{x:?}");
        assert!(x.is_integer());
        assert_eq!(x.floor(), x);
        assert_eq!(x.ceil(), x);
        assert_eq!(
            x.to_string(),
            if i.unsigned_abs() < 1_000_000_000_000_000 {
                i.to_string()
            } else {
                x.to_string()
            }
        );
    }
}

#[test]
fn normalisation_invariant_holds_everywhere() {
    let mut rng = Rng::new(2);
    for _ in 0..ITERS {
        let a = rng.num(-400, 400);
        let b = rng.num(-400, 400);
        let p = rng.range(-5.0, 5.0);
        for r in [
            a + b,
            a - b,
            a * b,
            a / b,
            a % b,
            a.pow(p),
            a.abs().sqrt(),
            a.floor(),
            a.ceil(),
            a.round(),
            a.recip(),
            -a,
            Num::from(rng.f64_mag(-320.0, 308.0)),
            Num::exp10(rng.range(-1e6, 1e6)),
        ] {
            assert_normalised(&r);
        }
    }
}

// ---------------------------------------------------------------- arithmetic

#[test]
fn arithmetic_matches_f64() {
    let mut rng = Rng::new(3);
    for _ in 0..ITERS {
        let x = rng.f64_mag(-100.0, 100.0);
        let y = rng.f64_mag(-100.0, 100.0);
        let (a, b) = (Num::from(x), Num::from(y));
        let tol = 1e-14;
        assert!(rel_close((a * b).to_f64(), x * y, tol), "{x} * {y}");
        assert!(rel_close((a / b).to_f64(), x / y, tol), "{x} / {y}");
        // addition: tolerance relative to the operands (cancellation)
        let scale = x.abs().max(y.abs());
        assert!(
            ((a + b).to_f64() - (x + y)).abs() <= scale * tol,
            "{x} + {y}"
        );
        assert!(
            ((a - b).to_f64() - (x - y)).abs() <= scale * tol,
            "{x} - {y}"
        );
    }
}

#[test]
fn arithmetic_outside_f64_range_matches_mantissa_math() {
    let mut rng = Rng::new(4);
    for _ in 0..ITERS {
        let a = rng.num(-200_000, 200_000);
        let b = rng.num(-200_000, 200_000);
        let p = a * b;
        assert!(rel_close(
            p.mantissa(),
            {
                let m = a.mantissa() * b.mantissa();
                if m.abs() >= 10.0 {
                    m / 10.0
                } else {
                    m
                }
            },
            1e-15
        ));
        assert!(p.exponent() - (a.exponent() + b.exponent()) <= 1);
        // (a * b) / b == a
        assert!((p / b).approx_eq(&a, 1e-14), "{a} {b}");
        // (a + b) - b == a when a dominates
        if a.exponent() > b.exponent() + 2 {
            assert!(((a + b) - b).approx_eq(&a, 1e-13), "{a} {b}");
        }
        // log10 of a product is the sum of logs
        let (aa, bb) = (a.abs(), b.abs());
        let (l, r) = ((aa * bb).log10(), aa.log10() + bb.log10());
        let scale = aa.log10().abs().max(bb.log10().abs()).max(1.0);
        assert!((l - r).abs() <= 1e-15 * scale, "{l} {r}");
    }
}

#[test]
fn integer_arithmetic_is_exact() {
    let mut rng = Rng::new(5);
    for _ in 0..ITERS {
        let x = (rng.next_u64() >> 40) as i64; // < 2^24 so products stay below 1e15
        let y = (rng.next_u64() >> 40) as i64 + 1;
        let (a, b) = (Num::from(x), Num::from(y));
        assert_eq!(a + b, Num::from(x + y));
        assert_eq!(a - b, Num::from(x - y));
        assert_eq!(a * b, Num::from(x * y));
        assert_eq!(a % b, Num::from(x % y));
        assert_eq!((a * b / b), a);
        assert_eq!((a / b).floor(), Num::from(x / y));
    }
    // counting up one at a time stays exact
    let mut c = Num::ZERO;
    for i in 1..=10_000 {
        c += Num::ONE;
        assert_eq!(c, Num::from(i));
    }
    // decimal drift is snapped by floor
    let tenth = n("0.1");
    assert_eq!((tenth * 3.0 * 10.0).floor(), Num::from(3));
    assert_eq!(
        (n("0.7") + n("0.1") + n("0.1") + n("0.1")).floor(),
        Num::ONE
    );
}

#[test]
fn operator_forms() {
    let a = Num::from(6);
    let b = Num::from(4);
    assert_eq!(a + b, Num::from(10));
    assert_eq!(&a + &b, Num::from(10));
    assert_eq!(a + &b, Num::from(10));
    assert_eq!(&a + b, Num::from(10));
    assert_eq!(&a - 1.0, Num::from(5));
    assert_eq!(a * 2.5, Num::from(15));
    assert_eq!(a / b, n("1.5"));
    assert_eq!(a % b, Num::TWO);
    assert_eq!(-&a, Num::from(-6));
    let mut c = a;
    c += b;
    c -= &b;
    c *= 2.0;
    c /= Num::from(3);
    c %= 3.0;
    assert_eq!(c, Num::ONE);
    let v = [Num::ONE, Num::TWO, Num::TEN];
    assert_eq!(v.iter().sum::<Num>(), Num::from(13));
    assert_eq!(v.iter().copied().product::<Num>(), Num::from(20));
}

#[test]
fn saturation_and_division_by_zero() {
    assert_eq!(Num::ONE / Num::ZERO, Num::MAX);
    assert_eq!(-Num::ONE / Num::ZERO, Num::MIN);
    assert_eq!(Num::ZERO / Num::ZERO, Num::ZERO);
    assert_eq!(Num::ZERO.recip(), Num::MAX);
    assert_eq!(Num::MAX * Num::MAX, Num::MAX);
    assert_eq!(Num::MAX * Num::MIN, Num::MIN);
    assert_eq!(Num::MAX + Num::MAX, Num::MAX);
    assert_eq!(Num::MIN_POSITIVE * Num::MIN_POSITIVE, Num::ZERO);
    assert_eq!(Num::MAX - Num::MAX, Num::ZERO);
    assert_eq!(Num::MAX.to_f64(), f64::INFINITY);
    assert_eq!(Num::MIN.to_f64(), f64::NEG_INFINITY);
    assert_eq!(n("1e-400").to_f64(), 0.0);
    assert_eq!(Num::MAX.to_i64(), i64::MAX);
    assert_eq!(Num::MIN.to_i64(), i64::MIN);
    assert_eq!(Num::from(5) % Num::ZERO, Num::ZERO);
    assert_eq!(n("1e100") % n("7"), Num::from(1e100 % 7.0));
    assert_eq!(n("1e400") % n("7"), Num::ZERO);
    assert_eq!(n("-7") % n("3"), n("-1"));
    assert_eq!(n("7.5e320") % n("1e320"), n("5e319"));
}

// ---------------------------------------------------------------- comparison

#[test]
fn ordering_is_total_and_consistent() {
    let mut rng = Rng::new(6);
    let mut v: Vec<Num> = (0..2000).map(|_| rng.num(-50, 50)).collect();
    v.push(Num::ZERO);
    v.push(Num::MAX);
    v.push(Num::MIN);
    v.sort();
    for w in v.windows(2) {
        assert!(w[0] <= w[1]);
        let (a, b) = (w[0], w[1]);
        if a.exponent().abs() < 300 && b.exponent().abs() < 300 {
            assert!(a.to_f64() <= b.to_f64(), "{a} {b}");
        }
    }
    assert_eq!(v[0], Num::MIN);
    assert_eq!(*v.last().unwrap(), Num::MAX);
    assert!(n("-1e10") < n("-1e9"));
    assert!(n("-1e-10") > n("-1e-9"));
    assert!(n("1e100000") > n("9.99e99999"));
    assert_eq!(n("2").max(n("3")), n("3"));
    assert_eq!(n("2").min(n("3")), n("2"));
    assert_eq!(n("5").clamp(Num::ZERO, Num::ONE), Num::ONE);
    assert!(n("1").lt(&n("2")) && n("2").ge(&n("2")));
    let set: HashSet<Num> = [n("1.5"), n("15e-1"), n("0.15e1"), Num::new(-0.0, 4)]
        .into_iter()
        .collect();
    assert_eq!(set.len(), 2);
}

#[test]
fn approx_eq_and_predicates() {
    assert!(n("1").approx_eq(&n("1.0000000001"), 1e-9));
    assert!(!n("1").approx_eq(&n("1.001"), 1e-9));
    assert!(Num::ZERO.approx_eq(&Num::ZERO, 0.0));
    assert!(!Num::ZERO.approx_eq(&n("1e-300"), 0.5));
    assert!(n("-3").is_negative() && !n("0").is_negative() && n("3").is_positive());
    assert_eq!(
        (n("-3").signum(), Num::ZERO.signum(), n("1e-9").signum()),
        (-1, 0, 1)
    );
    assert!(
        n("1e20").is_integer()
            && n("1e100000").is_integer()
            && !n("1.5").is_integer()
            && !n("0.5").is_integer()
    );
    assert!(Num::ZERO.is_zero() && !Num::MIN_POSITIVE.is_zero());
}

// ---------------------------------------------------------------- rounding

#[test]
fn integer_rounding() {
    let cases = [
        ("1.5", "1", "2", "2", "1"),
        ("-1.5", "-2", "-1", "-2", "-1"),
        ("0.4", "0", "1", "0", "0"),
        ("-0.4", "-1", "0", "0", "0"),
        ("-0.5", "-1", "0", "-1", "0"),
        ("1e-300", "0", "1", "0", "0"),
        (
            "123456789.99",
            "123456789",
            "123456790",
            "123456790",
            "123456789",
        ),
        ("1e100000", "1e100000", "1e100000", "1e100000", "1e100000"),
        (
            "2.5e15",
            "2500000000000000",
            "2500000000000000",
            "2500000000000000",
            "2500000000000000",
        ),
    ];
    for (x, fl, ce, ro, tr) in cases {
        let x = n(x);
        assert_eq!(x.floor(), n(fl), "floor {x}");
        assert_eq!(x.ceil(), n(ce), "ceil {x}");
        assert_eq!(x.round(), n(ro), "round {x}");
        assert_eq!(x.trunc(), n(tr), "trunc {x}");
    }
    let mut rng = Rng::new(7);
    for _ in 0..ITERS {
        let x = rng.f64_mag(-3.0, 12.0);
        if (x - x.round()).abs() <= x.abs() * 8.0 * f64::EPSILON {
            continue; // snapped on purpose, see crate docs
        }
        let a = Num::from(x);
        assert_eq!(a.floor().to_f64(), x.floor(), "{x}");
        assert_eq!(a.ceil().to_f64(), x.ceil(), "{x}");
    }
}

// ---------------------------------------------------------------- powers and logs

#[test]
fn pow_and_log_consistency() {
    let mut rng = Rng::new(8);
    for _ in 0..ITERS {
        let x = rng.num(-100_000, 100_000).abs();
        // 10^log10(x) == x
        let back = Num::exp10(x.log10());
        let tol = 1e-15 * x.log10().abs().max(1.0) * 4.0;
        assert!(back.approx_eq(&x, tol), "{x} -> {back}");
        // (x^p)^(1/p) == x
        let p = rng.range(0.5, 3.0);
        let y = x.pow(p).pow(1.0 / p);
        assert!(y.approx_eq(&x, tol * 8.0), "{x} ^ {p}: {y}");
        // ln and log agree
        assert!(rel_close(
            x.ln(),
            x.log10() * std::f64::consts::LN_10,
            1e-15
        ));
        assert!(rel_close(x.log(2.0), x.log10() / 2f64.log10(), 1e-15));
        // sqrt^2 == x
        let s = x.sqrt();
        assert!((s * s).approx_eq(&x, 1e-14), "sqrt {x}");
    }
}

#[test]
fn pow_matches_f64() {
    let mut rng = Rng::new(9);
    for _ in 0..ITERS {
        let x = rng.f64_mag(-5.0, 5.0).abs();
        let p = rng.range(-20.0, 20.0);
        let expect = x.powf(p);
        assert!(
            rel_close(Num::from(x).pow(p).to_f64(), expect, 1e-14),
            "{x}^{p}"
        );
        let k = (rng.next_u64() % 40) as i32 - 20;
        assert!(
            rel_close(Num::from(x).pow(k as f64).to_f64(), x.powi(k), 1e-13),
            "{x}^{k}"
        );
    }
    assert_eq!(Num::TWO.pow(10.0), Num::from(1024));
    assert_eq!(Num::from(-2).pow(3.0), Num::from(-8));
    assert_eq!(Num::from(-2).pow(2.0), Num::from(4));
    assert_eq!(Num::from(-2).pow(0.5), Num::ZERO);
    assert_eq!(Num::ZERO.pow(0.0), Num::ONE);
    assert_eq!(Num::ZERO.pow(-1.0), Num::MAX);
    assert_eq!(Num::ZERO.pow(2.0), Num::ZERO);
    assert_eq!(Num::TWO.pow(f64::INFINITY), Num::MAX);
    assert_eq!(n("0.5").pow(f64::INFINITY), Num::ZERO);
    assert_eq!(Num::TWO.pow(f64::NAN), Num::ZERO);
    assert_eq!(Num::from(-8).root(3.0), Num::from(-2));
    assert_eq!(Num::from(27).root(3.0), Num::from(3));
    assert_eq!(Num::from(-4).sqrt(), Num::ZERO);
    assert_eq!(Num::from(1024).log(2.0), 10.0);
    assert_eq!(Num::ZERO.log10(), f64::NEG_INFINITY);
    assert!(Num::from(-1).log10().is_nan());
    assert_eq!(Num::exp10(f64::INFINITY), Num::MAX);
    assert_eq!(Num::exp10(f64::NEG_INFINITY), Num::ZERO);
    assert_eq!(Num::exp10(100000.0), n("1e100000"));
}

#[test]
fn pow_num_with_huge_values() {
    // 1.12^ascends, the ascension penalty
    let p = Num::from(1.12).pow_num(&Num::from(10_000));
    assert!(rel_close(p.log10(), 10_000.0 * 1.12f64.log10(), 1e-12));
    assert_eq!(Num::TWO.pow_num(&n("1e400")), Num::MAX);
    assert_eq!(n("0.5").pow_num(&n("1e400")), Num::ZERO);
    assert_eq!(Num::TWO.pow_num(&n("-1e400")), Num::ZERO);
    // integer powers beyond f64 use squaring: 2^4000 exactly-ish
    let big = Num::TWO.pow(4000.0);
    assert!(rel_close(big.log10(), 4000.0 * 2f64.log10(), 1e-15));
    assert!(big.approx_eq(&Num::exp10(4000.0 * 2f64.log10()), 1e-12));
    // huge base, fractional power
    let r = n("1e100000").pow(0.5);
    assert_eq!(r, n("1e50000"));
    assert_eq!(n("1e100001").sqrt(), Num::new(10f64.sqrt(), 50000));
}

// ---------------------------------------------------------------- 1e100000 scale

#[test]
fn unit_limit_scale() {
    let limit = n("1e100000");
    assert_eq!(limit.exponent(), 100_000);
    assert_eq!(limit.to_string(), "1e100000");
    assert_eq!(limit.log10(), 100_000.0);
    assert_eq!((limit * 2.0).to_string(), "2e100000");
    assert_eq!((limit / limit), Num::ONE);
    assert_eq!(limit + Num::ONE, limit);
    assert_eq!(limit - limit, Num::ZERO);
    assert_eq!((limit + limit).to_string(), "2e100000");
    assert_eq!((limit * limit).to_string(), "1e200000");
    assert_eq!(limit.min(Num::MAX), limit);
    assert_eq!(n("1e99999") * 10.0, limit);
    assert_eq!(format_short(&limit), "1e100000");
    assert_eq!(format_long(&n("1.234567e100000")), "1.23456e100000");
    let mut rng = Rng::new(10);
    for _ in 0..1000 {
        let a = rng.num(99_000, 100_000).abs();
        let b = rng.num(99_000, 100_000).abs();
        let s = a + b;
        assert!(s >= a.max(b) && s <= a.max(b) * 2.0);
        assert!(((s - b) - a).abs() <= s * 1e-14);
    }
}

// ---------------------------------------------------------------- geometric series (upgrade.ts)

#[test]
fn geometric_series_cost_sum() {
    // sumCost: a * (1 - f^n) / (1 - f) == sum_{k<n} a * f^k
    let mut rng = Rng::new(11);
    for _ in 0..300 {
        let a = Num::from(rng.range(1.0, 1e6)) * Num::exp10(rng.range(0.0, 50.0).floor());
        let f = Num::from(rng.range(1.01, 3.0));
        let count = (rng.next_u64() % 200) as i64 + 1;
        let closed = a * (Num::ONE - f.pow(count as f64)) / (Num::ONE - f);
        let mut sum = Num::ZERO;
        let mut term = a;
        for _ in 0..count {
            sum += term;
            term *= f;
        }
        assert!(
            closed.approx_eq(&sum, 1e-11),
            "a={a} f={f} n={count}: {closed} vs {sum}"
        );
        // maxCostMet inverts it: n = log(1 - have*(1-f)/a) / log(f)
        let have = closed;
        let m = (Num::ONE - have * (Num::ONE - f) / a).log10() / f.log10();
        assert!((m - count as f64).abs() < 1e-6, "{m} vs {count}");
    }
    // a huge one: price factor 1.5, 100000 levels, way past f64
    let a = Num::from(10);
    let f = n("1.5");
    let closed = a * (Num::ONE - f.pow(100_000.0)) / (Num::ONE - f);
    assert!(rel_close(
        closed.log10(),
        1.0 + 100_000.0 * 1.5f64.log10() - 0.5f64.log10(),
        1e-12
    ));
}

// ---------------------------------------------------------------- parsing

#[test]
fn parse_accepts_save_and_input_forms() {
    let ok = [
        ("0", "0"),
        ("-0", "0"),
        ("123", "123"),
        ("+123", "123"),
        ("-123", "-123"),
        ("1.5", "1.5"),
        (".5", "0.5"),
        ("5.", "5"),
        ("000123.4500", "123.45"),
        ("1.5e300", "1.5e300"),
        ("1.5e+300", "1.5e300"),
        ("1E5", "100000"),
        ("2.5e-7", "2.5e-7"),
        ("1e100000", "1e100000"),
        ("-1e100000", "-1e100000"),
        ("1e21", "1e21"),
        ("100000000000000000000", "100000000000000000000"),
        ("123456789012345678901234567890", "1.23456789012346e29"),
        ("0.000000000000000000001", "1e-21"),
        ("  42 \n", "42"),
        ("1.000000000000001", "1"),
    ];
    for (s, want) in ok {
        let x: Num = s.parse().unwrap_or_else(|e| panic!("{s}: {e}"));
        assert_normalised(&x);
        assert_eq!(x.to_string(), want, "{s}");
    }
    assert_eq!(n("Infinity"), Num::MAX);
    assert_eq!(n("-Infinity"), Num::MIN);
    assert_eq!(n("1e99999999999999999999999"), Num::MAX);
    assert_eq!(n("1e-99999999999999999999999"), Num::ZERO);
    assert_eq!(n("0e99999999999999999999999"), Num::ZERO);
    assert_eq!(n("1.5e9000000000000000"), Num::new(1.5, EXP_MAX));
    assert_eq!("".parse::<Num>(), Err(ParseNumError::Empty));
    assert_eq!("NaN".parse::<Num>(), Err(ParseNumError::NaN));
    for bad in [
        "abc", "1.2.3", "1e", "e5", "-", "+", ".", "1e5.5", "1,000", "12a", "--1", "0x10", "1 2",
    ] {
        assert_eq!(bad.parse::<Num>(), Err(ParseNumError::Invalid), "{bad}");
    }
    assert_eq!(ParseNumError::Invalid.to_string(), "invalid number");
}

#[test]
fn parse_matches_f64_parse() {
    let mut rng = Rng::new(12);
    for _ in 0..ITERS {
        let x = rng.f64_mag(-300.0, 300.0);
        for s in [format!("{x}"), format!("{x:e}"), format!("{x:.3e}")] {
            let want: f64 = s.parse().unwrap();
            let got = n(&s).to_f64();
            assert!(
                rel_close(got, want, 4.0 * f64::EPSILON),
                "{s}: {got} vs {want}"
            );
        }
    }
}

// ---------------------------------------------------------------- display

#[test]
fn display_canonical_forms() {
    let cases = [
        (Num::ZERO, "0"),
        (Num::from(123), "123"),
        (Num::from(-123), "-123"),
        (Num::from(0.5), "0.5"),
        (Num::from(1e20), "100000000000000000000"),
        (Num::from(1e21), "1e21"),
        (Num::from(1.5e300), "1.5e300"),
        (Num::from(1e-6), "0.000001"),
        (Num::from(1e-7), "1e-7"),
        (Num::from(0.1 + 0.2), "0.3"),
        (Num::from(9007199254740993u64), "9007199254740990"),
        (Num::from(123456789012345678.0), "123456789012346000"),
        (Num::new(9.9999999999999995, 4), "100000"),
        (Num::MAX, "1e9000000000000001"),
    ];
    for (x, s) in cases {
        assert_eq!(x.to_string(), s, "{x:?}");
    }
    assert_eq!(format!("{:>6}", Num::from(42)), "    42");
}

#[test]
fn display_round_trips() {
    let mut rng = Rng::new(13);
    for i in 0..ITERS {
        let x = if i % 2 == 0 {
            rng.num(-200_000, 200_000)
        } else {
            Num::from(rng.f64_mag(-30.0, 30.0))
        };
        let s = x.to_string();
        let y = n(&s);
        assert_eq!(y.to_string(), s, "{x:?}");
        assert!(y.approx_eq(&x, 1e-14), "{x:?} -> {s} -> {y:?}");
        // parse(display(parse(s))) is a fixed point
        assert_eq!(n(&y.to_string()), y);
    }
}

#[test]
fn precision_methods() {
    assert_eq!(n("123.456").to_precision(4), "123.5");
    assert_eq!(n("123456").to_precision(2), "1.2e+5");
    assert_eq!(n("1.5e300").to_precision(3), "1.50e+300");
    assert_eq!(n("1e100000").to_precision(2), "1.0e+100000");
    assert_eq!(n("0").to_precision(3), "0.00");
    assert_eq!(n("1.99").to_precision_with(2, Rounding::Floor), "1.9");
    assert_eq!(n("-1.91").to_precision_with(2, Rounding::Floor), "-2.0");
    assert_eq!(n("1.91").to_precision_with(2, Rounding::Ceil), "2.0");
    assert_eq!(n("1.95").to_precision_with(2, Rounding::Down), "1.9");
    assert_eq!(n("1.91").to_precision_with(2, Rounding::Up), "2.0");
    assert_eq!(n("12.345").to_precision(20), "12.345000000000000000");
    assert_eq!(n("12.345").to_fixed(1), "12.3");
    assert_eq!(n("12.355").to_fixed(2), "12.36");
    assert_eq!(n("-0.001").to_fixed(2), "-0.00");
    assert_eq!(n("1e21").to_fixed(2), "1e21");
    assert_eq!(n("0.000456").to_fixed_with(4, Rounding::Ceil), "0.0005");
    assert_eq!(n("1234.5").to_exponential(2), "1.23e+3");
    assert_eq!(n("0").to_exponential(1), "0.0e+0");
    assert_eq!(n("1e-100000").to_exponential(0), "1e-100000");
    // a value just under an integer after arithmetic still floors as expected
    let x = n("0.1") * 3.0 * 1e6; // 300000 with drift
    assert_eq!(x.to_precision_with(3, Rounding::Floor), "3.00e+5");
}

#[test]
fn formatting_examples() {
    assert_eq!(format_short(&n("0")), "0");
    assert_eq!(format_short(&n("99999.9")), "99,999");
    assert_eq!(format_short(&n("100000")), "100K");
    assert_eq!(format_short(&n("1234567")), "1.23M");
    assert_eq!(format_short(&n("-1234567")), "-1.24M");
    assert_eq!(format_short(&n("1e270")), "1NOg");
    assert_eq!(format_short(&n("1e273")), "1e273");
    assert_eq!(format_short(&n("1.234e306")), "1.23e306");
    assert_eq!(format_long(&n("123456")), "123.456 thousand");
    assert_eq!(format_long(&n("8e6")), "8 million");
    assert_eq!(format_short(&Num::MAX), "∞");
    assert_eq!(format_short(&Num::MIN), "-∞");
    // drift doesn't knock a value down a digit
    assert_eq!(format_short(&(n("0.1") * 3.0 * 1e6)), "300K");
}

// ---------------------------------------------------------------- serde

#[cfg(feature = "serde")]
#[test]
fn serde_round_trip() {
    let v = vec![n("0"), n("123"), n("1.5e300"), n("-2.5e-7"), n("1e100000")];
    let json = serde_json::to_string(&v).unwrap();
    assert_eq!(json, r#"["0","123","1.5e300","-2.5e-7","1e100000"]"#);
    let back: Vec<Num> = serde_json::from_str(&json).unwrap();
    assert_eq!(back, v);
    let from_numbers: Vec<Num> =
        serde_json::from_str("[0, 12, -3, 1.5e300, 18446744073709551615]").unwrap();
    assert_eq!(from_numbers[1], Num::from(12));
    assert_eq!(from_numbers[2], Num::from(-3));
    assert_eq!(from_numbers[3], n("1.5e300"));
    assert_eq!(from_numbers[4], Num::from(u64::MAX));
    assert!(serde_json::from_str::<Num>(r#""abc""#).is_err());
    assert!(serde_json::from_str::<Num>("true").is_err());
}
