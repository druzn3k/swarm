//! JSON text exactly as `JSON.stringify(value, null, 1) + "\n"` writes it
//! (the TS `goldenJson`): one-space indentation, `": "` after keys, `[]`/`{}`
//! for empty containers, and numbers in ECMAScript `Number#toString` form
//! (`1e+21`, `1e-7`, `0.1`). Key order is the `serde_json::Map` order, which
//! is insertion order (this crate enables `preserve_order`).

use serde_json::Value;

/// ECMAScript `Number#toString(x)` for a finite `x` (`-0` prints `0`).
/// Non-finite values print `Infinity`, `-Infinity`, `NaN` like JS.
pub fn js_number(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    if x == 0.0 {
        return "0".into();
    }
    let mut out = String::new();
    if x < 0.0 {
        out.push('-');
    }
    // Rust's `{:e}` gives the shortest round-trip digits, like JS
    let sci = format!("{:e}", x.abs());
    let (mant, exp) = sci.split_once('e').expect("exponential format");
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    // value = 0.d1..dk * 10^n
    let n = exp.parse::<i64>().expect("exponent") + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if n - 1 < 0 { '-' } else { '+' });
        out.push_str(&(n - 1).unsigned_abs().to_string());
    }
    out
}

/// `JSON.stringify(v, null, 1) + "\n"`.
pub fn golden_json(v: &Value) -> String {
    let mut out = String::new();
    write(v, 0, &mut out);
    out.push('\n');
    out
}

fn indent(out: &mut String, depth: usize) {
    out.push('\n');
    out.extend(std::iter::repeat_n(' ', depth));
}

fn write(v: &Value, depth: usize, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else {
                out.push_str(&js_number(n.as_f64().unwrap_or(f64::NAN)));
            }
        }
        // serde_json escapes like JSON.stringify: \" \\ \b \f \n \r \t and
        // other control characters as lowercase \u00XX
        Value::String(s) => out.push_str(&Value::String(s.clone()).to_string()),
        Value::Array(a) => {
            if a.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write(x, depth + 1, out);
            }
            indent(out, depth);
            out.push(']');
        }
        Value::Object(m) => {
            if m.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                out.push_str(&Value::String(k.clone()).to_string());
                out.push_str(": ");
                write(x, depth + 1, out);
            }
            indent(out, depth);
            out.push('}');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_like_js() {
        assert_eq!(js_number(0.1), "0.1");
        assert_eq!(js_number(1e21), "1e+21");
        assert_eq!(js_number(1e20), "100000000000000000000");
        assert_eq!(js_number(1e-7), "1e-7");
        assert_eq!(js_number(1.5e-7), "1.5e-7");
        assert_eq!(js_number(0.000001), "0.000001");
        assert_eq!(js_number(123456789.0), "123456789");
        assert_eq!(js_number(-0.0), "0");
        assert_eq!(js_number(-2.5), "-2.5");
        assert_eq!(js_number(1.2345e-10), "1.2345e-10");
        assert_eq!(js_number(62528.123), "62528.123");
        assert_eq!(js_number(f64::INFINITY), "Infinity");
    }

    #[test]
    fn layout_like_json_stringify() {
        let v = json!({"a": [], "b": {}, "c": [1, {"d": "x\u{1}"}], "e": 1e21});
        assert_eq!(
            golden_json(&v),
            "{\n \"a\": [],\n \"b\": {},\n \"c\": [\n  1,\n  {\n   \"d\": \"x\\u0001\"\n  }\n ],\n \"e\": 1e+21\n}\n"
        );
    }
}
