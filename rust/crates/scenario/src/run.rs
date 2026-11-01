//! The scenario interpreter (`engine/oracle/scenario.ts` `runScenario`) over
//! [`swarm_engine::Engine`], with the TS serialisation (`ser`): Decimal →
//! decimal.js string, JS number → number or `{"$number": "Infinity"}`,
//! Date → ISO string. See `rust/harness/README.md` for the rules.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use swarm_data::{json_num, EffectId, GameData, UnitId, UpgradeId};
use swarm_engine::command::Cheat;
use swarm_engine::estimate::ASCEND_ESTIMATE_TYPE_ERROR;
use swarm_engine::upgrade::UPGRADE_ESTIMATE_TYPE_ERROR;
use swarm_engine::{
    Amount, Command, CommandEvent, EffectOutput, Engine, Estimate, Event, State, UnitRef,
    UpgradeEstimate, UpgradeRef, UpgradeSet,
};
use swarm_num::Num;
use swarm_save::date::{parse_iso, to_iso};
use swarm_save::legacy;

use crate::state_json::state_json;

/// `oldEngineVersion` of every result (the TS writes it for both engines).
pub const OLD_ENGINE_VERSION: &str = "swarmsim-coffee 1.1.17";

/// What a step snapshots after its action.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnapshotKind {
    /// Nothing.
    #[default]
    None,
    /// Every unit's count and velocity.
    Counts,
    /// Units, upgrades, achievements, ascendInfo and the raw state.
    Full,
}

/// One scenario step.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Step {
    /// The action, kept verbatim (it is copied into the result).
    pub action: Value,
    /// The snapshot taken after the action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SnapshotKind>,
}

/// A scenario file (`rust/harness/corpus/*.json`).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Scenario {
    /// Name.
    pub name: String,
    /// Description.
    pub description: String,
    /// `{"now": ISO, "save"?: string}`, kept verbatim.
    pub start: Value,
    /// Steps replayed before recording.
    #[serde(rename = "prefixSteps", default, skip_serializing_if = "Vec::is_empty")]
    pub prefix_steps: Vec<Step>,
    /// The recorded steps.
    pub steps: Vec<Step>,
}

impl Scenario {
    /// Parses a scenario file.
    pub fn from_json(text: &str) -> Result<Scenario, serde_json::Error> {
        serde_json::from_str(text)
    }

    /// The scenario a golden result (`engine/test/golden/*.json`) was
    /// recorded from: golden steps carry the snapshot data, not its kind,
    /// so the kind is recovered from its shape (`golden.test.ts`).
    pub fn from_golden(golden: &Value) -> Scenario {
        let steps = |v: Option<&Value>| -> Vec<Step> {
            v.and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|s| Step {
                            action: s["action"].clone(),
                            snapshot: s.get("snapshot").map(|snap| {
                                if snap.get("upgrades").is_some() {
                                    SnapshotKind::Full
                                } else if snap.get("units").is_some() {
                                    SnapshotKind::Counts
                                } else {
                                    // a recorded kind (prefixSteps are copied verbatim)
                                    serde_json::from_value(snap.clone())
                                        .unwrap_or(SnapshotKind::None)
                                }
                            }),
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        Scenario {
            name: golden["name"].as_str().unwrap_or_default().to_owned(),
            description: golden["description"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            start: golden["start"].clone(),
            prefix_steps: steps(golden.get("prefixSteps")),
            steps: steps(golden.get("steps")),
        }
    }
}

// ----- ser helpers -----

/// A Decimal, as `Decimal#toString()`.
pub fn dec(n: Num) -> Value {
    Value::String(n.to_decimal_js_string())
}

/// A Decimal where the engine uses [`Num::MAX`] for the TS `Infinity`.
pub fn dec_inf(n: Num) -> Value {
    if n == Num::MAX {
        Value::String("Infinity".into())
    } else if n == Num::MIN {
        Value::String("-Infinity".into())
    } else {
        dec(n)
    }
}

/// A Decimal computed from an `f64` (estimates): NaN and infinities as
/// decimal.js prints them.
pub fn dec_f64(x: f64) -> Value {
    if x.is_nan() {
        Value::String("NaN".into())
    } else if x.is_infinite() {
        Value::String(if x > 0.0 { "Infinity" } else { "-Infinity" }.into())
    } else {
        dec(Num::from_f64(x))
    }
}

/// A JS number: finite as a JSON number, otherwise `{"$number": ...}`.
pub fn js_num(x: f64) -> Value {
    if x.is_finite() {
        if x.fract() == 0.0 && x.abs() < 9e15 {
            Value::from(x as i64)
        } else {
            Value::from(x)
        }
    } else {
        json!({"$number": crate::jsjson::js_number(x)})
    }
}

fn error(msg: impl Into<String>) -> Value {
    json!({"error": msg.into()})
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_owned(), v);
    }
    Value::Object(m)
}

// ----- the runner -----

/// Why a scenario could not start (the TS run throws).
#[derive(Clone, Debug, PartialEq)]
pub struct StartError(pub String);

impl std::fmt::Display for StartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StartError {}

/// A game being driven by scenario actions.
#[derive(Debug)]
pub struct Runner {
    /// The engine.
    pub engine: Engine,
}

/// The TS error message for a save that fails to import.
pub fn import_error_message(e: &legacy::LegacyError) -> String {
    match e {
        // JSON.parse("null").date
        legacy::LegacyError::Shape(s) if s == "not a JSON object" => {
            "Cannot read properties of null (reading 'date')".to_owned()
        }
        other => other.to_string(),
    }
}

fn parse_time(v: &Value) -> Result<i64, String> {
    v.as_str()
        .and_then(parse_iso)
        .ok_or_else(|| format!("oracle: bad date {v}"))
}

/// `new Decimal(x)` of a scenario `Num` (a JSON number or a string).
fn num_arg(v: &Value) -> Result<Num, String> {
    match v {
        Value::Number(n) => Ok(json_num(n.as_f64().unwrap_or(f64::NAN))),
        Value::String(s) => s
            .parse::<Num>()
            .map_err(|_| format!("[DecimalError] Invalid argument: {s}")),
        other => Err(format!("[DecimalError] Invalid argument: {other}")),
    }
}

fn str_arg<'a>(a: &'a Value, key: &str) -> Result<&'a str, String> {
    a.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("oracle: missing {key}"))
}

fn f64_arg(a: &Value, key: &str) -> Result<f64, String> {
    a.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("oracle: missing {key}"))
}

/// A legacy (v1) save string of a state, as TS `session._saves` writes it:
/// `btoa("1.1.17") | btoa("Cheater :(\n\n") + lz(JSON.stringify(state))`,
/// with the state laid out by [`state_json`] (which keeps `date.loaded` if
/// set, like the TS export of a never-saved game).
pub fn encode_save(state: &State) -> String {
    format!(
        "MS4xLjE3|{}{}",
        legacy::PREFIX,
        swarm_save::lz::compress_to_base64(&state_json(state).to_string())
    )
}

impl Runner {
    /// TS `createGame({now, save})`: a new game, or the save imported, then
    /// backfill.
    pub fn start(start: &Value) -> Result<Runner, StartError> {
        let data = GameData::embedded();
        let now = parse_time(&start["now"]).map_err(StartError)?;
        let mut engine = Engine::new_game(data, now);
        if let Some(save) = start.get("save").and_then(Value::as_str) {
            let d = legacy::decode(save).map_err(|e| StartError(import_error_message(&e)))?;
            engine
                .import_state(d.state)
                .map_err(|e| StartError(e.to_string()))?;
            engine.run_backfill();
        }
        engine.drain_events();
        Ok(Runner { engine })
    }

    fn data(&self) -> &'static GameData {
        self.engine.data()
    }

    fn unit(&self, name: &str) -> Result<UnitId, String> {
        self.data()
            .unit_id(name)
            .ok_or_else(|| format!("oracle: no such unit {name}"))
    }

    fn upgrade(&self, name: &str) -> Result<UpgradeId, String> {
        self.data()
            .upgrade_id(name)
            .ok_or_else(|| format!("oracle: no such upgrade {name}"))
    }

    fn apply(&mut self, cmd: Command) -> Result<(), String> {
        self.engine
            .apply(cmd)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Runs one action: its `result` (`None` for undefined), or the error
    /// message.
    pub fn apply_action(&mut self, a: &Value) -> Result<Option<Value>, String> {
        let what = a.get("do").and_then(Value::as_str).unwrap_or_default();
        match what {
            "tick" => {
                let at = parse_time(&a["at"])?;
                self.engine.set_now_ms(at).map_err(|e| e.to_string())?;
                Ok(None)
            }
            "buyUnit" => {
                let unit = self.unit(str_arg(a, "unit")?)?;
                let num = num_arg(&a["num"])?;
                self.apply(Command::BuyUnit {
                    unit: UnitRef::Id(unit),
                    amount: Amount::Num(num),
                    ui: None,
                })?;
                Ok(None)
            }
            "buyMaxUnit" => {
                let unit = self.unit(str_arg(a, "unit")?)?;
                let percent = f64_arg(a, "percent")?;
                self.apply(Command::BuyMaxUnit {
                    unit: UnitRef::Id(unit),
                    percent,
                    ui: None,
                })?;
                Ok(None)
            }
            "buyUpgrade" => {
                let upgrade = self.upgrade(str_arg(a, "upgrade")?)?;
                let num = num_arg(&a["num"])?;
                self.apply(Command::BuyUpgrade {
                    upgrade: UpgradeRef::Id(upgrade),
                    amount: Amount::Num(num),
                    ui: None,
                })?;
                Ok(None)
            }
            "buyMaxUpgrade" => {
                let upgrade = self.upgrade(str_arg(a, "upgrade")?)?;
                let percent = f64_arg(a, "percent")?;
                self.apply(Command::BuyMaxUpgrade {
                    upgrade: UpgradeRef::Id(upgrade),
                    percent,
                    ui: None,
                })?;
                Ok(None)
            }
            "buyAllUpgrades" => {
                let percent = a.get("percent").and_then(Value::as_f64);
                let ups = self
                    .engine
                    .available_autobuy_upgrades(percent.map(json_num));
                if !ups.is_empty() {
                    self.apply(Command::BuyAllUpgrades {
                        percent: percent.unwrap_or(1.0),
                        which: UpgradeSet::Explicit(
                            ups.iter().map(|&g| UpgradeRef::Id(g)).collect(),
                        ),
                    })?;
                }
                let names: Vec<Value> = ups
                    .iter()
                    .map(|&g| Value::String(self.data().upgrade(g).name.clone()))
                    .collect();
                Ok(Some(json!({ "upgrades": names })))
            }
            "ascend" => self.apply(Command::Ascend).map(|_| None),
            "respec" => self.apply(Command::Respec).map(|_| None),
            "respecFree" => self.apply(Command::RespecFree).map(|_| None),
            "undo" => self.apply(Command::Undo).map(|_| None),
            "setUnitCount" => {
                let unit = self.unit(str_arg(a, "unit")?)?;
                let val = num_arg(&a["val"])?;
                self.apply(Command::Cheat(Cheat::SetUnitCount {
                    unit: UnitRef::Id(unit),
                    val,
                }))?;
                Ok(None)
            }
            "setUpgradeCount" => {
                let upgrade = self.upgrade(str_arg(a, "upgrade")?)?;
                let val = num_arg(&a["val"])?;
                self.apply(Command::Cheat(Cheat::SetUpgradeCount {
                    upgrade: UpgradeRef::Id(upgrade),
                    val,
                }))?;
                Ok(None)
            }
            "importSave" => {
                let save = str_arg(a, "save")?;
                let d = legacy::decode(save).map_err(|e| import_error_message(&e))?;
                self.engine
                    .import_state(d.state)
                    .map_err(|e| e.to_string())?;
                self.engine.run_backfill();
                Ok(None)
            }
            "exportSave" => Ok(Some(Value::String(encode_save(
                self.engine.exported_state(),
            )))),
            "save" => {
                self.engine.save();
                Ok(Some(Value::String(encode_save(
                    self.engine.exported_state(),
                ))))
            }
            "estimateUnit" => {
                let unit = self.unit(str_arg(a, "unit")?)?;
                let target = num_arg(&a["target"])?;
                Ok(Some(
                    match self.engine.estimate_secs_until_earned(unit, target) {
                        Estimate::Reached => js_num(0.0),
                        Estimate::Secs(s) => dec_f64(s),
                        Estimate::Never => Value::String("Infinity".into()),
                    },
                ))
            }
            "estimateUpgrade" => {
                let upgrade = self.upgrade(str_arg(a, "upgrade")?)?;
                Ok(Some(self.estimate_upgrade(upgrade)?))
            }
            "ascendInfo" => Ok(Some(self.ascend_info())),
            "effects" => {
                let effects: Vec<EffectId> =
                    if let Some(u) = a.get("upgrade").and_then(Value::as_str) {
                        let g = self.upgrade(u)?;
                        self.data().upgrade(g).effects.clone()
                    } else {
                        let u = self.unit(str_arg(a, "unit")?)?;
                        self.data().unit(u).effects.clone()
                    };
                Ok(Some(Value::Array(
                    effects.iter().map(|&e| self.effect_json(e)).collect(),
                )))
            }
            "parseNumber" => {
                let input = str_arg(a, "input")?;
                let unit = match a.get("unit").and_then(Value::as_str) {
                    Some(u) => Some(self.unit(u)?),
                    None => None,
                };
                let handle = unit.map(|u| self.engine.unit_handle(u));
                let r = swarm_engine::parse_number::parse_number(
                    input,
                    handle.as_ref().map(|h| h as _),
                );
                Ok(r.map(dec))
            }
            "countInSecs" => {
                let unit = self.unit(str_arg(a, "unit")?)?;
                let secs = num_arg(&a["secs"])?;
                Ok(Some(dec(self.engine.count_in_secs_from_now(unit, secs))))
            }
            other => Err(format!("oracle: unknown action {other}")),
        }
    }

    fn estimate_upgrade(&self, upgrade: UpgradeId) -> Result<Value, String> {
        match self.engine.estimate_secs_until_buyable(upgrade) {
            UpgradeEstimate::MaxAffordable => Ok(json!({"val": "Infinity", "unit": null})),
            UpgradeEstimate::Unavailable => Err(UPGRADE_ESTIMATE_TYPE_ERROR.to_owned()),
            UpgradeEstimate::Wait {
                secs,
                unit,
                cache_safe,
            } => Ok(obj(vec![
                (
                    "val",
                    match secs {
                        Estimate::Reached => dec(Num::ZERO),
                        Estimate::Secs(s) => dec_f64(s),
                        Estimate::Never => Value::String("Infinity".into()),
                    },
                ),
                (
                    "unit",
                    unit.map_or(Value::Null, |u| {
                        Value::String(self.data().unit(u).name.clone())
                    }),
                ),
                // coffee `&=` makes it the number 1
                ("cacheSafe", js_num(f64::from(u8::from(cache_safe)))),
            ])),
        }
    }

    fn ascend_info(&self) -> Value {
        let e = &self.engine;
        let cost = e.ascend_cost(None);
        let respec_cost = e.respec_cost();
        let mut m = Map::new();
        m.insert("ascendEnergySpent".into(), dec(e.ascend_energy_spent()));
        m.insert("ascendCost".into(), dec(cost));
        m.insert("ascendCostPercent".into(), dec(e.ascend_cost_percent(cost)));
        match e.ascend_cost_duration(cost) {
            None => {}
            Some(Estimate::Reached) => {
                m.insert(
                    "ascendCostDurationSecs".into(),
                    error(ASCEND_ESTIMATE_TYPE_ERROR),
                );
            }
            Some(est) => {
                m.insert("ascendCostDurationSecs".into(), js_num(est.secs()));
            }
        }
        m.insert("respecCost".into(), dec(respec_cost));
        m.insert(
            "respecCostPercent".into(),
            dec(e.ascend_cost_percent(respec_cost)),
        );
        m.insert(
            "isRespecCostMet".into(),
            Value::Bool(e.is_respec_cost_met()),
        );
        m.insert("respecSpent".into(), dec(e.respec_spent()));
        Value::Object(m)
    }

    fn effect_json(&self, effect: EffectId) -> Value {
        let data = self.data();
        let e = data.effect(effect);
        let en = &self.engine;
        let mut m = Map::new();
        m.insert("type".into(), Value::String(e.kind.name().to_owned()));
        m.insert(
            "unit".into(),
            e.unit
                .map_or(Value::Null, |u| Value::String(data.unit(u).name.clone())),
        );
        m.insert(
            "upgrade".into(),
            e.upgrade
                .map_or(Value::Null, |g| Value::String(data.upgrade(g).name.clone())),
        );
        m.insert(
            "stat".into(),
            e.stat
                .map_or(Value::Null, |s| Value::String(data.stat_name(s).to_owned())),
        );
        m.insert("power".into(), dec(en.effect_power(effect)));
        let output = |o: EffectOutput| -> Option<Value> {
            match o {
                EffectOutput::None => None,
                EffectOutput::Num(n) => Some(dec(n)),
                EffectOutput::Rand(r) => Some(obj(vec![
                    ("spawned", Value::Bool(r.spawned)),
                    ("baseqty", dec(r.baseqty)),
                    ("qty", dec(r.qty)),
                ])),
            }
        };
        if let Some(v) = output(en.effect_output(effect, None)) {
            m.insert("output".into(), v);
        }
        if let Some(v) = output(en.effect_output_next(effect)) {
            m.insert("outputNext".into(), v);
        }
        if let Some(b) = en.effect_bank(effect) {
            m.insert("bank".into(), dec(b));
        }
        if let Some(c) = en.effect_cap(effect) {
            m.insert("cap".into(), dec(c));
        }
        Value::Object(m)
    }

    // ----- snapshots -----

    /// `snapshotCounts`.
    pub fn snapshot_counts(&self) -> Value {
        let mut units = Map::new();
        for u in self.data().units() {
            units.insert(
                u.name.clone(),
                obj(vec![
                    ("count", dec(self.engine.count(u.id))),
                    ("velocity", dec(self.engine.velocity(u.id))),
                ]),
            );
        }
        json!({ "units": units })
    }

    fn snapshot_unit(&self, u: UnitId) -> Value {
        let e = &self.engine;
        let data = self.data();
        let visible = e.unit_visible(u);
        let mut m = Map::new();
        m.insert("count".into(), dec(e.count(u)));
        m.insert("velocity".into(), dec(e.velocity(u)));
        m.insert("isVisible".into(), Value::Bool(visible));
        if visible {
            let costs: Vec<Value> = e
                .each_cost(u)
                .iter()
                .map(|c| {
                    obj(vec![
                        ("unit", Value::String(data.unit(c.unit).name.clone())),
                        ("val", dec(c.val)),
                    ])
                })
                .collect();
            m.insert("eachCost".into(), Value::Array(costs));
            m.insert(
                "maxCostMet".into(),
                dec_inf(e.unit_max_cost_met(u, Num::ONE)),
            );
            m.insert(
                "maxCostMet25".into(),
                dec_inf(e.unit_max_cost_met(u, json_num(0.25))),
            );
            m.insert("isCostMet".into(), Value::Bool(e.unit_is_cost_met(u)));
            m.insert(
                "isBuyButtonVisible".into(),
                Value::Bool(e.is_buy_button_visible(u)),
            );
            m.insert("isBuyable".into(), Value::Bool(e.unit_is_buyable(u, false)));
            m.insert("twinMult".into(), dec(e.twin_mult(u)));
            m.insert("capValue".into(), e.cap(u).map_or(Value::Null, dec));
            let prod = |list: Vec<(UnitId, Num)>| -> Value {
                let mut p = Map::new();
                for (pu, v) in list {
                    p.insert(data.unit(pu).name.clone(), dec(v));
                }
                Value::Object(p)
            };
            m.insert("eachProduction".into(), prod(e.each_production(u)));
            m.insert("totalProduction".into(), prod(e.total_production(u)));
            let mut stats = Map::new();
            for (s, v) in e.stats(u) {
                stats.insert(data.stat_name(s).to_owned(), dec(v));
            }
            m.insert("stats".into(), Value::Object(stats));
            m.insert("suffix".into(), Value::String(e.suffix(u)));
        }
        Value::Object(m)
    }

    fn snapshot_upgrade(&self, g: UpgradeId) -> Value {
        let e = &self.engine;
        let data = self.data();
        let visible = e.upgrade_visible(g);
        let mut m = Map::new();
        m.insert("count".into(), dec(e.upgrade_count(g)));
        m.insert("isVisible".into(), Value::Bool(visible));
        let costs: Vec<Value> = e
            .total_cost(g)
            .iter()
            .map(|c| {
                obj(vec![
                    ("unit", Value::String(data.unit(c.unit).name.clone())),
                    ("val", dec(c.val)),
                    ("factor", dec(c.factor)),
                ])
            })
            .collect();
        m.insert("totalCost".into(), Value::Array(costs));
        m.insert(
            "isUpgradable".into(),
            Value::Bool(e.upgrade_is_upgradable(g, None, false)),
        );
        if visible {
            m.insert(
                "maxCostMet".into(),
                dec_inf(e.upgrade_max_cost_met(g, Num::ONE)),
            );
            m.insert("isCostMet".into(), Value::Bool(e.upgrade_is_cost_met(g)));
            m.insert("isBuyable".into(), Value::Bool(e.upgrade_is_buyable(g)));
            m.insert(
                "isAutobuyable".into(),
                Value::Bool(e.upgrade_is_autobuyable(g)),
            );
            m.insert(
                "isNewlyUpgradable".into(),
                Value::Bool(e.upgrade_is_newly_upgradable(g, 1.0)),
            );
            m.insert(
                "costMetPercent".into(),
                e.upgrade_cost_met_percent(g)
                    .map_or_else(|| Value::String("NaN".into()), dec),
            );
            m.insert(
                "estimateSecsUntilBuyable".into(),
                self.estimate_upgrade(g).unwrap_or_else(error),
            );
        }
        Value::Object(m)
    }

    /// `snapshotFull`.
    pub fn snapshot_full(&self) -> Value {
        let data = self.data();
        let mut units = Map::new();
        for u in data.units() {
            units.insert(u.name.clone(), self.snapshot_unit(u.id));
        }
        let mut upgrades = Map::new();
        for g in data.upgrades() {
            upgrades.insert(g.name.clone(), self.snapshot_upgrade(g.id));
        }
        let mut earned = Map::new();
        for a in data.achievements() {
            if let Some(at) = self.engine.achievement_earned_at(a.id) {
                earned.insert(a.name.clone(), js_num(at as f64));
            }
        }
        obj(vec![
            ("units", Value::Object(units)),
            ("upgrades", Value::Object(upgrades)),
            (
                "achievements",
                obj(vec![
                    ("earned", Value::Object(earned)),
                    (
                        "points",
                        js_num(f64::from(self.engine.achievement_points())),
                    ),
                ]),
            ),
            ("ascendInfo", self.ascend_info()),
            ("state", state_json(self.engine.state())),
        ])
    }

    /// A snapshot of `kind`.
    pub fn snapshot(&self, kind: SnapshotKind) -> Option<Value> {
        match kind {
            SnapshotKind::None => None,
            SnapshotKind::Counts => Some(self.snapshot_counts()),
            SnapshotKind::Full => Some(self.snapshot_full()),
        }
    }

    /// `runStep`: the action, its result or error, the command events, and
    /// the snapshot.
    pub fn run_step(&mut self, step: &Step) -> Value {
        self.engine.drain_events();
        let res = self.apply_action(&step.action);
        let commands: Vec<Value> = self
            .engine
            .drain_events()
            .iter()
            .filter_map(|e| match e {
                Event::Command(c) => Some(self.command_json(c)),
                _ => None,
            })
            .collect();
        let mut m = Map::new();
        m.insert("action".into(), step.action.clone());
        m.insert("now".into(), Value::String(to_iso(self.engine.now_ms())));
        match res {
            Ok(Some(v)) => {
                m.insert("result".into(), v);
            }
            Ok(None) => {}
            Err(msg) => {
                m.insert("error".into(), Value::String(msg));
            }
        }
        if !commands.is_empty() {
            m.insert("commands".into(), Value::Array(commands));
        }
        if let Some(snap) = self.snapshot(step.snapshot.unwrap_or_default()) {
            m.insert("snapshot".into(), snap);
        }
        Value::Object(m)
    }

    /// A `command` event as the TS logs it (README "Commands").
    pub fn command_json(&self, c: &CommandEvent) -> Value {
        let now = Value::String(to_iso(c.now_ms));
        let elapsed = js_num(c.elapsed_ms as f64);
        let name = Value::String(c.name.to_owned());
        let s = |x: &Option<String>| x.clone().map_or(Value::Null, Value::String);
        let n = |x: Option<Num>| x.map_or(Value::Null, dec);
        let pct = c.percent.map_or(Value::Null, js_num);
        let mut v: Vec<(&str, Value)> = match c.name {
            "buyUnit" => vec![
                ("unitname", s(&c.unitname)),
                ("now", now),
                ("elapsed", elapsed),
                ("attempt", n(c.attempt)),
                ("num", n(c.num)),
                ("twinnum", n(c.twinnum)),
            ],
            "buyMaxUnit" => vec![
                ("unitname", s(&c.unitname)),
                ("now", now),
                ("elapsed", elapsed),
                ("num", n(c.num)),
                ("twinnum", n(c.twinnum)),
                ("percent", pct),
            ],
            "buyUpgrade" => vec![
                ("upgradename", s(&c.upgradename)),
                ("now", now),
                ("elapsed", elapsed),
                ("num", n(c.num)),
            ],
            "buyMaxUpgrade" => vec![
                ("upgradename", s(&c.upgradename)),
                ("now", now),
                ("elapsed", elapsed),
                ("num", n(c.num)),
                ("percent", pct),
            ],
            "buyAllUpgrades" => vec![("now", now), ("elapsed", elapsed), ("percent", pct)],
            "ascension" => vec![
                ("now", now),
                ("unitname", s(&c.unitname)),
                ("num", js_num(1.0)),
                ("twinnum", js_num(1.0)),
                ("elapsed", elapsed),
            ],
            _ => vec![("now", now), ("elapsed", elapsed)],
        };
        if let Some(ui) = &c.ui {
            v.push(("ui", Value::String(ui.clone())));
        }
        v.push(("name", name));
        obj(v)
    }
}

/// Runs a scenario: the TS `runScenario` result. Fails only if the start
/// fails (the TS run throws).
pub fn try_run_scenario(s: &Scenario) -> Result<Value, StartError> {
    let mut r = Runner::start(&s.start)?;
    let mut initial = r.snapshot_full();
    if !s.prefix_steps.is_empty() {
        for step in &s.prefix_steps {
            r.run_step(step);
        }
        initial = r.snapshot_full();
    }
    let steps: Vec<Value> = s.steps.iter().map(|step| r.run_step(step)).collect();
    let mut m = Map::new();
    m.insert("name".into(), Value::String(s.name.clone()));
    m.insert("description".into(), Value::String(s.description.clone()));
    m.insert(
        "oldEngineVersion".into(),
        Value::String(OLD_ENGINE_VERSION.into()),
    );
    m.insert("start".into(), s.start.clone());
    if !s.prefix_steps.is_empty() {
        m.insert(
            "prefixSteps".into(),
            serde_json::to_value(&s.prefix_steps).unwrap_or(Value::Null),
        );
    }
    m.insert("initial".into(), initial);
    m.insert("steps".into(), Value::Array(steps));
    Ok(Value::Object(m))
}

/// [`try_run_scenario`], panicking if the start fails.
pub fn run_scenario(s: &Scenario) -> Value {
    match try_run_scenario(s) {
        Ok(v) => v,
        Err(e) => panic!("scenario {} failed to start: {e}", s.name),
    }
}

/// `goldenJson(runScenario(s))`.
pub fn scenario_to_json(result: &Value) -> String {
    crate::jsjson::golden_json(result)
}
