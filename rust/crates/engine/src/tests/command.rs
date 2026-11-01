//! Port of `engine/test/command.test.ts` and `statistics.test.ts`.

use swarm_data::GameData;
use swarm_num::Num;

use crate::command::{Amount, Command, UpgradeSet};
use crate::events::Event;
use crate::testutil::{g, n, u};
use crate::{CommandError, Engine};

const T2020: i64 = 1_577_836_800_000;

fn game() -> Engine {
    Engine::new_game(GameData::embedded(), T2020)
}

fn buy_unit(name: &str, num: &str) -> Command {
    Command::BuyUnit {
        unit: name.into(),
        amount: Amount::Num(n(num)),
        ui: None,
    }
}

#[test]
fn can_undo() {
    let mut e = game();
    e.set_unit_count(u("meat"), n("10000"));
    e.set_unit_count(u("larva"), n("10000"));
    let drone = u("drone");
    assert_eq!(e.count(drone).to_f64(), 0.0);
    e.apply(buy_unit("drone", "1")).unwrap();
    assert!(!e.undo_state().unwrap().is_redo);
    assert_eq!(e.count(drone).to_f64(), 1.0);
    e.apply(Command::Undo).unwrap();
    assert!(e.undo_state().unwrap().is_redo);
    assert_eq!(e.count(drone).to_f64(), 0.0);
    e.apply(Command::Undo).unwrap();
    assert!(e.undo_state().unwrap().is_redo);
    assert_eq!(e.count(drone).to_f64(), 1.0);
}

#[test]
fn no_undo_state() {
    let mut e = game();
    assert_eq!(e.apply(Command::Undo), Err(CommandError::NoUndo));
    assert_eq!(CommandError::NoUndo.to_string(), "no undostate available");
}

#[test]
fn undoes_visibility() {
    // #639
    let mut e = game();
    e.set_unit_count(u("mutagen"), n("1e99"));
    let up = g("mutatehatchery");
    let mutant = u("mutanthatchery");
    e.set_upgrade_count(up, Num::ZERO);
    assert_eq!(e.count(mutant).to_f64(), 0.0);
    assert!(!e.unit_visible(mutant));
    e.apply(Command::BuyUpgrade {
        upgrade: "mutatehatchery".into(),
        amount: Amount::Num(Num::ONE),
        ui: None,
    })
    .unwrap();
    assert_eq!(e.count(mutant).to_f64(), 1.0);
    assert_eq!(e.upgrade_count(up).to_f64(), 1.0);
    assert!(e.unit_visible(mutant));
    e.apply(Command::Undo).unwrap();
    assert_eq!(e.count(mutant).to_f64(), 0.0);
    assert_eq!(e.upgrade_count(up).to_f64(), 0.0);
    assert!(!e.unit_visible(mutant));
}

fn seen(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|ev| match ev {
            Event::Command(c) => Some(format!(
                "{}:{}",
                c.name,
                c.upgradename
                    .clone()
                    .or(c.unitname.clone())
                    .unwrap_or_default()
            )),
            _ => None,
        })
        .collect()
}

#[test]
fn buy_all_keeps_earlier_purchases() {
    let mut e = game();
    e.with_save::<(), ()>(|e| {
        e.set_unit_count(u("territory"), n("10"));
        Ok(())
    })
    .unwrap();
    e.drain_events();
    let err = e
        .apply(Command::BuyAllUpgrades {
            percent: 1.0,
            which: UpgradeSet::Explicit(vec!["expansion".into(), "expansion".into()]),
        })
        .unwrap_err();
    assert_eq!(err.to_string(), "We require more resources");
    assert_eq!(e.upgrade_count(g("expansion")).to_f64(), 1.0);
    let events = e.drain_events();
    assert_eq!(seen(&events), ["buyMaxUpgrade:expansion"]);
    assert!(events.contains(&Event::CommandFailed("We require more resources".into())));
    let out = e.apply(buy_unit("drone", "1")).unwrap();
    assert_eq!(seen(&e.drain_events()), ["buyUnit:drone"]);
    assert_eq!(out.commands.len(), 1);
    assert_eq!(out.commands[0].attempt, Some(Num::ONE));
}

#[test]
fn buy_all_autobuyable() {
    let mut e = game();
    e.set_unit_count(u("territory"), n("100"));
    // nothing to buy: no-op, no undo
    let mut e2 = game();
    let out = e2
        .apply(Command::BuyAllUpgrades {
            percent: 1.0,
            which: UpgradeSet::Autobuyable,
        })
        .unwrap();
    assert!(out.upgrades.is_empty());
    assert!(e2.undo_state().is_none());
    let out = e
        .apply(Command::BuyAllUpgrades {
            percent: 1.0,
            which: UpgradeSet::Autobuyable,
        })
        .unwrap();
    assert_eq!(out.upgrades, [g("expansion")]);
    assert_eq!(
        out.commands.iter().map(|c| c.name).collect::<Vec<_>>(),
        ["buyMaxUpgrade", "buyAllUpgrades"]
    );
    assert_eq!(e.upgrade_count(g("expansion")).to_f64(), 3.0);
    assert_eq!(e.state().statistics.clicks, 2);
}

#[test]
fn parses_input_amounts() {
    let mut e = game();
    e.set_unit_count(u("meat"), n("10000"));
    e.set_unit_count(u("larva"), n("10000"));
    let out = e
        .apply(Command::BuyUnit {
            unit: "drone".into(),
            amount: Amount::Input("1.5k".into()),
            ui: None,
        })
        .unwrap();
    assert_eq!(out.bought.unwrap().num.to_f64(), 1000.0); // clamped to what meat allows
    assert!(matches!(
        e.apply(Command::BuyUnit {
            unit: "drone".into(),
            amount: Amount::Input("lots".into()),
            ui: None,
        }),
        Err(CommandError::BadNumber(_))
    ));
    assert!(matches!(
        e.apply(buy_unit("nosuch", "1")),
        Err(CommandError::UnknownUnit(_))
    ));
}

#[test]
fn commands_deserialize() {
    let c: Command = serde_json::from_str(
        r#"{"do":"buy_unit","unit":"drone","amount":{"input":"50%"},"ui":"button"}"#,
    )
    .unwrap();
    assert_eq!(
        c,
        Command::BuyUnit {
            unit: "drone".into(),
            amount: Amount::Input("50%".into()),
            ui: Some("button".into())
        }
    );
    let c: Command = serde_json::from_str(r#"{"do":"ascend"}"#).unwrap();
    assert_eq!(c, Command::Ascend);
}

#[test]
fn records_statistics_and_buy_first_once() {
    let mut e = game();
    e.drain_events();
    e.apply(buy_unit("drone", "1")).unwrap();
    e.apply(buy_unit("drone", "2")).unwrap();
    let stats = &e.state().statistics;
    assert_eq!(stats.clicks, 2);
    let d = &stats.by_unit["drone"];
    assert_eq!(d.clicks, 2);
    assert_eq!(d.num.to_string(), "3");
    assert_eq!(d.twinnum.to_string(), "3");
    assert_eq!(d.elapsed_first, Some(0));
    let first: Vec<_> = e
        .drain_events()
        .into_iter()
        .filter(|ev| matches!(ev, Event::BuyFirst { .. }))
        .collect();
    assert_eq!(
        first,
        [Event::BuyFirst {
            unit: Some(u("drone")),
            upgrade: None
        }]
    );
    // reset re-inits statistics
    e.apply(Command::Reset).unwrap();
    assert_eq!(e.state().statistics, crate::state::Statistics::default());
}

#[test]
fn ascend_command_records_the_ascension() {
    let mut e = game();
    e.set_unit_count(u("nexus"), n("9e999"));
    e.set_unit_count(u("energy"), n("9e999"));
    let out = e.apply(Command::Ascend).unwrap();
    assert_eq!(out.commands[0].name, "ascension");
    assert_eq!(e.state().statistics.by_unit["ascension"].num, Num::ONE);
    assert_eq!(e.count(u("ascension")), Num::ONE);
}

#[test]
fn options_and_watch() {
    let mut e = game();
    e.apply(Command::SetOption {
        key: "theme".into(),
        value: serde_json::json!("dark"),
    })
    .unwrap();
    assert_eq!(e.state().options["theme"], "dark");
    e.apply(Command::Watch {
        upgrade: "expansion".into(),
        level: -1,
    })
    .unwrap();
    assert_eq!(e.watched_at(g("expansion")), -1);
}
