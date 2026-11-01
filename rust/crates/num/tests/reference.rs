//! Checks against fixtures generated from decimal.js 7.1.1 and a copy of
//! `formatNumber` from `app/src/format.ts` (see `data/gen.js`).

use swarm_num::format::{format_number, Flavor, FormatOptions, Notation};
use swarm_num::Num;

fn rows(tsv: &str) -> impl Iterator<Item = Vec<&str>> {
    tsv.lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.split('\t').collect())
}

#[test]
fn format_number_matches_typescript() {
    let mut n = 0;
    for r in rows(include_str!("data/format.tsv")) {
        let value: Num = r[0].parse().unwrap();
        let notation = match r[1] {
            "standard-decimal" => Notation::StandardDecimal,
            "scientific-e" => Notation::ScientificE,
            "hybrid" => Notation::Hybrid,
            "engineering" => Notation::Engineering,
            other => panic!("{other}"),
        };
        let flavor = if r[2] == "full" {
            Flavor::Full
        } else {
            Flavor::Short
        };
        let mut opts = FormatOptions {
            notation,
            flavor,
            ..FormatOptions::default()
        };
        if !r[3].is_empty() {
            opts.sigfigs = Some(r[3].parse().unwrap());
        }
        if !r[4].is_empty() {
            opts.max_small = r[4].parse().unwrap();
        }
        assert_eq!(format_number(&value, &opts), r[5], "{r:?}");
        n += 1;
    }
    assert!(n > 250);
}

#[test]
fn precision_methods_match_decimal_js() {
    let mut n = 0;
    for r in rows(include_str!("data/prec.tsv")) {
        let value: Num = r[1].parse().unwrap();
        let k: usize = r[2].parse().unwrap();
        let got = match r[0] {
            "prec" => value.to_precision(k),
            "exp" => value.to_exponential(k),
            "fixed" => {
                // decimal.js prints >= 1e21 in full; we follow JS Number#toFixed
                if value.abs() >= Num::from(1e21) {
                    continue;
                }
                value.to_fixed(k)
            }
            other => panic!("{other}"),
        };
        assert_eq!(got, r[3], "{r:?}");
        n += 1;
    }
    assert!(n > 200);
}
