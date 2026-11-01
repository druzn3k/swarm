//! Durations for `swarm advance`: `90s`, `3h`, `2d`, `1h30m`, `1.5h`,
//! `500ms`, `1w`. A bare number is seconds.

use std::time::Duration;

/// Parses a duration. Components are a number followed by a unit (`ms`,
/// `s`, `m`, `h`, `d`, `w`, or the long forms `sec`, `min`, `hour`,
/// `day`, `week` and their plurals); they add up. Whitespace between
/// components is allowed. A bare number is seconds.
pub fn parse_duration(input: &str) -> Result<Duration, String> {
    let text = input.trim();
    if text.is_empty() {
        return Err("empty duration".into());
    }
    if let Ok(secs) = text.parse::<f64>() {
        return secs_to_duration(secs, input);
    }
    let mut total = 0.0f64;
    let mut rest = text;
    while !rest.is_empty() {
        rest = rest.trim_start();
        let num_len = rest
            .find(|c: char| !(c.is_ascii_digit() || c == '.'))
            .unwrap_or(rest.len());
        if num_len == 0 {
            return Err(format!(
                "bad duration {input:?}: expected a number at {rest:?}"
            ));
        }
        let num: f64 = rest[..num_len]
            .parse()
            .map_err(|_| format!("bad duration {input:?}: bad number {:?}", &rest[..num_len]))?;
        rest = rest[num_len..].trim_start();
        let unit_len = rest
            .find(|c: char| !c.is_ascii_alphabetic())
            .unwrap_or(rest.len());
        let unit = &rest[..unit_len];
        let scale = match unit.to_ascii_lowercase().as_str() {
            "ms" | "msec" | "msecs" | "millis" => 0.001,
            "s" | "sec" | "secs" | "second" | "seconds" => 1.0,
            "m" | "min" | "mins" | "minute" | "minutes" => 60.0,
            "h" | "hr" | "hrs" | "hour" | "hours" => 3600.0,
            "d" | "day" | "days" => 86_400.0,
            "w" | "wk" | "week" | "weeks" => 604_800.0,
            "" => return Err(format!("bad duration {input:?}: missing unit after {num}")),
            other => return Err(format!("bad duration {input:?}: unknown unit {other:?}")),
        };
        total += num * scale;
        rest = &rest[unit_len..];
    }
    secs_to_duration(total, input)
}

fn secs_to_duration(secs: f64, input: &str) -> Result<Duration, String> {
    Duration::try_from_secs_f64(secs).map_err(|_| format!("bad duration {input:?}"))
}

/// `1d 2h 3m 4s` style, for messages. Sub-second parts are shown as ms when
/// the duration is under a second.
pub fn format_duration(d: Duration) -> String {
    let total = d.as_secs();
    if total == 0 {
        let ms = d.as_millis();
        return if ms == 0 {
            "0s".into()
        } else {
            format!("{ms}ms")
        };
    }
    let (days, rem) = (total / 86_400, total % 86_400);
    let (h, rem) = (rem / 3600, rem % 3600);
    let (m, s) = (rem / 60, rem % 60);
    let mut parts = Vec::new();
    if days > 0 {
        parts.push(format!("{days}d"));
    }
    if h > 0 {
        parts.push(format!("{h}h"));
    }
    if m > 0 {
        parts.push(format!("{m}m"));
    }
    if s > 0 {
        parts.push(format!("{s}s"));
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses() {
        let s = Duration::from_secs;
        assert_eq!(parse_duration("90s"), Ok(s(90)));
        assert_eq!(parse_duration("3h"), Ok(s(3 * 3600)));
        assert_eq!(parse_duration("2d"), Ok(s(2 * 86_400)));
        assert_eq!(parse_duration("1w"), Ok(s(604_800)));
        assert_eq!(parse_duration("1h30m"), Ok(s(5400)));
        assert_eq!(parse_duration("1h 30m 15s"), Ok(s(5415)));
        assert_eq!(parse_duration("1.5h"), Ok(s(5400)));
        assert_eq!(parse_duration("2 hours"), Ok(s(7200)));
        assert_eq!(parse_duration("45"), Ok(s(45)));
        assert_eq!(parse_duration("500ms"), Ok(Duration::from_millis(500)));
        assert_eq!(parse_duration("10M"), Ok(s(600)));
    }

    #[test]
    fn rejects() {
        for bad in ["", "h", "3x", "-1h", "1h-", "1..5h", "3 parsecs"] {
            assert!(parse_duration(bad).is_err(), "{bad:?}");
        }
        assert!(parse_duration("-5").is_err());
        assert!(parse_duration("1e400").is_err());
    }

    #[test]
    fn formats() {
        assert_eq!(format_duration(Duration::from_secs(93_784)), "1d 2h 3m 4s");
        assert_eq!(format_duration(Duration::from_secs(3600)), "1h");
        assert_eq!(format_duration(Duration::from_millis(250)), "250ms");
    }
}
