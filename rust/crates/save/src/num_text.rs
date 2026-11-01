//! Lossless decimal text for [`Num`], in decimal.js `toString` style.
//!
//! `Num`'s own `Display` rounds to 15 significant digits, so a save written
//! with it would not read back bit-identical. [`exact`] prints the
//! mantissa's shortest round-trip digits (up to 17) instead, laid out the way
//! decimal.js's `Decimal#toString` lays them out: plain notation for
//! `1e-7 <= |x| < 1e21`, otherwise `d.ddde+N` / `d.ddde-N`. decimal.js (the TS
//! engine) and `Num::from_str` both parse it, and `Num::from_str` gives back
//! the same `Num` bit for bit.

use swarm_num::Num;

/// `x` as lossless decimal.js-style text. See the [module docs](self).
pub fn exact(x: &Num) -> String {
    if x.is_zero() {
        return "0".to_owned();
    }
    let m = x.mantissa();
    let e = x.exponent();
    // Rust's `{:e}` is the shortest representation that round-trips.
    let sci = format!("{:e}", m.abs());
    let (digits_part, exp_part) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = digits_part.chars().filter(|c| *c != '.').collect();
    // `m` is normalised to [1, 10), so `exp_part` is 0; keep it general anyway.
    let e = e + exp_part.parse::<i64>().unwrap_or(0);
    let mut out = String::new();
    if m < 0.0 {
        out.push('-');
    }
    if e >= 21 || e <= -7 {
        out.push_str(&digits[..1]);
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.unsigned_abs().to_string());
    } else if e >= 0 {
        let int_len = e as usize + 1;
        if digits.len() <= int_len {
            out.push_str(&digits);
            out.extend(std::iter::repeat_n('0', int_len - digits.len()));
        } else {
            out.push_str(&digits[..int_len]);
            out.push('.');
            out.push_str(&digits[int_len..]);
        }
    } else {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-e - 1) as usize));
        out.push_str(&digits);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(s: &str) -> Num {
        s.parse().unwrap()
    }

    #[test]
    fn decimal_js_layout() {
        for s in [
            "0",
            "1",
            "17",
            "253232.571",
            "0.5",
            "0.000001",
            "1e-7",
            "1.5e-7",
            "-2.5",
            "100000000000000000000",
            "1e+21",
            "8.3938592362194651394e+87",
            "2.2774003438897636511e+422",
        ] {
            let x = n(s);
            let t = exact(&x);
            assert_eq!(n(&t), x, "{s} -> {t}");
        }
        assert_eq!(exact(&n("253232.571")), "253232.571");
        assert_eq!(exact(&n("1e+21")), "1e+21");
        assert_eq!(exact(&n("1.5e300")), "1.5e+300");
        assert_eq!(exact(&n("1e-7")), "1e-7");
        assert_eq!(exact(&n("0.000001")), "0.000001");
        assert_eq!(exact(&n("123")), "123");
        assert_eq!(exact(&n("-1200")), "-1200");
        assert_eq!(exact(&n("100000000000000000000")), "100000000000000000000");
        assert_eq!(
            exact(&n("8.3938592362194651394e+87")),
            "8.393859236219464e+87"
        );
    }

    #[test]
    fn lossless_for_arbitrary_mantissas() {
        let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
        for i in 0..20_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let m = 1.0 + (s >> 11) as f64 / (1u64 << 53) as f64 * 9.0;
            let e = (s % 2001) as i64 - 1000;
            let x = Num::new(if i % 2 == 0 { m } else { -m }, e);
            let back = n(&exact(&x));
            assert_eq!(back.mantissa().to_bits(), x.mantissa().to_bits());
            assert_eq!(back.exponent(), x.exponent());
        }
    }
}
