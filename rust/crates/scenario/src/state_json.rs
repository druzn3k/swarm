//! The raw session state as the TS snapshot records it
//! (`JSON.parse(session.exportJson())`): Decimals through `toJSON` (decimal.js
//! strings), dates as ISO strings, `addUnitTimed-<unit>` timers among the
//! dates. Key order follows a fresh TS session (`session.ts` `reset`);
//! imported TS saves keep their own order there, which the comparator
//! ignores.

use serde_json::{Map, Value};
use swarm_engine::State;
use swarm_save::date::to_iso;

use crate::run::{dec, js_num};

/// The state as TS `JSON.parse(session.exportJson())`.
pub fn state_json(s: &State) -> Value {
    let mut root = Map::new();
    let nums = |m: &std::collections::BTreeMap<String, swarm_num::Num>| -> Value {
        Value::Object(m.iter().map(|(k, v)| (k.clone(), dec(*v))).collect())
    };
    root.insert("unittypes".into(), nums(&s.units));
    let mut date = Map::new();
    let d = &s.dates;
    let mut put = |k: &str, ms: Option<i64>| {
        if let Some(ms) = ms {
            date.insert(k.to_owned(), Value::String(to_iso(ms)));
        }
    };
    put("started", Some(d.started));
    put("restarted", d.restarted);
    put("saved", d.saved);
    put("loaded", d.loaded);
    put("reified", Some(d.reified));
    put("closed", d.closed);
    for (k, ms) in &d.other {
        put(k, Some(*ms));
    }
    for (u, ms) in &s.timers {
        put(
            &format!("{}{u}", swarm_save::legacy::TIMER_PREFIX),
            Some(*ms),
        );
    }
    root.insert("date".into(), Value::Object(date));
    root.insert("options".into(), Value::Object(s.options.clone()));
    root.insert("upgrades".into(), nums(&s.upgrades));
    let st = &s.statistics;
    let mut by_unit = Map::new();
    for (k, u) in &st.by_unit {
        let mut m = Map::new();
        m.insert("clicks".into(), js_num(u.clicks as f64));
        m.insert("num".into(), dec(u.num));
        m.insert("twinnum".into(), dec(u.twinnum));
        if let Some(e) = u.elapsed_first {
            m.insert("elapsedFirst".into(), js_num(e as f64));
        }
        m.extend(u.extra.clone());
        by_unit.insert(k.clone(), Value::Object(m));
    }
    let mut by_upgrade = Map::new();
    for (k, u) in &st.by_upgrade {
        let mut m = Map::new();
        m.insert("clicks".into(), js_num(u.clicks as f64));
        m.insert("num".into(), dec(u.num));
        if let Some(e) = u.elapsed_first {
            m.insert("elapsedFirst".into(), js_num(e as f64));
        }
        m.extend(u.extra.clone());
        by_upgrade.insert(k.clone(), Value::Object(m));
    }
    let mut stats = Map::new();
    stats.insert("byUnit".into(), Value::Object(by_unit));
    stats.insert("byUpgrade".into(), Value::Object(by_upgrade));
    stats.insert("clicks".into(), js_num(st.clicks as f64));
    root.insert("statistics".into(), Value::Object(stats));
    root.insert(
        "achievements".into(),
        Value::Object(
            s.achievements
                .iter()
                .map(|(k, v)| (k.clone(), js_num(*v as f64)))
                .collect(),
        ),
    );
    root.insert(
        "watched".into(),
        Value::Object(
            s.watched
                .iter()
                .map(|(k, v)| (k.clone(), js_num(f64::from(*v))))
                .collect(),
        ),
    );
    root.insert("skippedMillis".into(), js_num(s.skipped_ms as f64));
    if let Some(v) = &s.version {
        let mut m = Map::new();
        if let Some(x) = &v.started {
            m.insert("started".into(), Value::String(x.clone()));
        }
        if let Some(x) = &v.saved {
            m.insert("saved".into(), Value::String(x.clone()));
        }
        root.insert("version".into(), Value::Object(m));
    }
    if let Some(k) = s.kongregate {
        root.insert("kongregate".into(), Value::Bool(k));
    }
    for (k, v) in &s.unknown {
        root.entry(k.clone()).or_insert_with(|| v.clone());
    }
    Value::Object(root)
}
