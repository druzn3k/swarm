//! JS `Date` text: `Date#toISOString` and the ISO subset of `Date.parse`
//! that saves contain. Pure arithmetic (no clock, no time zone database).

/// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's
/// `days_from_civil`).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The inverse of [`days_from_civil`].
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// JS `new Date(ms).toISOString()`: `2015-02-11T00:28:19.372Z`, with a
/// six-digit signed year outside 0..=9999.
pub fn to_iso(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, mo, d) = civil_from_days(days);
    let (h, mi, s, milli) = (
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000,
    );
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("+{y:06}")
    };
    format!("{year}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{milli:03}Z")
}

/// Parses the ISO 8601 forms JS `Date.parse` accepts: `YYYY`, `YYYY-MM`,
/// `YYYY-MM-DD`, each optionally followed by `THH:mm`, `:ss`, `.sss` (any
/// number of fraction digits; extra digits are truncated like V8) and `Z`
/// or `±HH:mm`; a six-digit signed year is allowed. A date-time without an
/// offset is local time in JS; it is read as UTC here (saves always carry
/// the `Z`). `None` where JS gives an Invalid Date.
pub fn parse_iso(text: &str) -> Option<i64> {
    let b = text.trim().as_bytes();
    let mut p = Parser { b, i: 0 };
    let year = match p.peek()? {
        sign @ (b'+' | b'-') => {
            p.i += 1;
            let y = p.digits(6)?;
            if sign == b'-' {
                if y == 0 {
                    return None; // -000000 is invalid
                }
                -y
            } else {
                y
            }
        }
        _ => p.digits(4)?,
    };
    let (mut month, mut day) = (1, 1);
    if p.eat(b'-') {
        month = p.digits(2)?;
        if p.eat(b'-') {
            day = p.digits(2)?;
        }
    }
    let (mut h, mut mi, mut s, mut ms) = (0, 0, 0, 0);
    let mut offset_min = 0;
    if p.eat(b'T') || p.eat(b't') || p.eat(b' ') {
        h = p.digits(2)?;
        p.expect(b':')?;
        mi = p.digits(2)?;
        if p.eat(b':') {
            s = p.digits(2)?;
            if p.eat(b'.') || p.eat(b',') {
                let start = p.i;
                while p.peek().is_some_and(|c| c.is_ascii_digit()) {
                    p.i += 1;
                }
                let frac = &b[start..p.i];
                if frac.is_empty() {
                    return None;
                }
                for k in 0..3 {
                    ms = ms * 10 + frac.get(k).map_or(0, |c| i64::from(c - b'0'));
                }
            }
        }
        match p.peek() {
            Some(b'Z' | b'z') => p.i += 1,
            Some(sign @ (b'+' | b'-')) => {
                p.i += 1;
                let oh = p.digits(2)?;
                p.eat(b':');
                let om = p.digits(2)?;
                if oh > 23 || om > 59 {
                    return None;
                }
                offset_min = (oh * 60 + om) * if sign == b'-' { -1 } else { 1 };
            }
            _ => {}
        }
    }
    if p.i != b.len() {
        return None;
    }
    let dim = days_in_month(year, month)?;
    if day < 1 || day > dim || h > 24 || mi > 59 || s > 59 {
        return None;
    }
    if h == 24 && (mi, s, ms) != (0, 0, 0) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let t = days * 86_400_000 + ((h * 60 + mi - offset_min) * 60 + s) * 1000 + ms;
    // JS TimeClip
    (t.abs() <= 8_640_000_000_000_000).then_some(t)
}

fn days_in_month(y: i64, m: i64) -> Option<i64> {
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    Some(match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    })
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn eat(&mut self, c: u8) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn expect(&mut self, c: u8) -> Option<()> {
        self.eat(c).then_some(())
    }
    fn digits(&mut self, n: usize) -> Option<i64> {
        let s = self.b.get(self.i..self.i + n)?;
        if !s.iter().all(u8::is_ascii_digit) {
            return None;
        }
        self.i += n;
        Some(s.iter().fold(0, |a, c| a * 10 + i64::from(c - b'0')))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_round_trip() {
        let t = parse_iso("2015-02-11T00:28:19.372Z").unwrap();
        assert_eq!(t, 1_423_614_499_372);
        assert_eq!(to_iso(t), "2015-02-11T00:28:19.372Z");
        assert_eq!(to_iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(to_iso(-1), "1969-12-31T23:59:59.999Z");
        assert_eq!(parse_iso("1969-12-31T23:59:59.999Z"), Some(-1));
        assert_eq!(parse_iso("2020-01-01"), Some(1_577_836_800_000));
        assert_eq!(
            parse_iso("2020-01-01T01:00:00+01:00"),
            Some(1_577_836_800_000)
        );
        assert_eq!(parse_iso("2020-02-30T00:00:00Z"), None);
        assert_eq!(parse_iso("nonsense"), None);
        assert_eq!(to_iso(253_402_300_800_000), "+010000-01-01T00:00:00.000Z");
        assert_eq!(
            parse_iso("+010000-01-01T00:00:00.000Z"),
            Some(253_402_300_800_000)
        );
        let mut s: u64 = 12345;
        for _ in 0..10_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let ms = (s % 600_000_000_000_000) as i64 - 300_000_000_000_000;
            assert_eq!(parse_iso(&to_iso(ms)), Some(ms), "{ms}");
        }
    }
}
