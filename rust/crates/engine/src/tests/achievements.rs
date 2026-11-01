//! Port of `engine/test/achievements.test.ts`.

use serde_json::json;
use swarm_data::GameData;
use swarm_num::Num;

use crate::command::{Amount, Command};
use crate::events::Event;
use crate::testutil::{mkgame, n, u};
use crate::Engine;

const T2020: i64 = 1_577_836_800_000;

fn a(name: &str) -> swarm_data::AchievementId {
    GameData::embedded().achievement_id(name).unwrap()
}

#[test]
fn earns() {
    let mut e = mkgame(&[]);
    let d1 = a("drone1");
    assert!(!e.achievement_earned(d1));
    assert_eq!(e.achievement_earned_at(d1), None);
    assert_eq!(e.achievement_points_earned(d1), 0);
    e.earn_achievement(d1, Some(55));
    assert!(e.achievement_earned(d1));
    assert_eq!(e.achievement_earned_at(d1), Some(55));
    assert_eq!(e.achievement_points_earned(d1), 10);
    // earning again changes nothing
    e.earn_achievement(d1, Some(99));
    assert_eq!(e.achievement_earned_at(d1), Some(55));
    assert_eq!(
        e.drain_events()
            .into_iter()
            .filter(|ev| matches!(ev, Event::Achieved(_)))
            .count(),
        1
    );
}

#[test]
fn earns_event_achievements_validating_the_payload() {
    let mut e = Engine::new_game(GameData::embedded(), T2020);
    e.drain_events();
    let ui = |e: &mut Engine, name: &str, params: serde_json::Value| {
        e.apply(Command::UiEvent {
            name: name.into(),
            params,
        })
        .unwrap();
    };
    ui(&mut e, "achieveclick", json!({"name": "nope"}));
    assert!(!e.achievement_earned(a("clickme")));
    ui(&mut e, "achieveclick", json!({"name": "clickme"}));
    assert!(e.achievement_earned(a("clickme")));
    ui(&mut e, "konami", serde_json::Value::Null);
    assert!(e.achievement_earned(a("konami")));
    ui(
        &mut e,
        "import",
        json!({"source": "options", "success": false}),
    );
    assert!(!e.achievement_earned(a("import")));
    ui(
        &mut e,
        "import",
        json!({"source": "options", "success": true}),
    );
    assert!(e.achievement_earned(a("import")));
    let achieved: Vec<_> = e
        .drain_events()
        .into_iter()
        .filter_map(|ev| match ev {
            Event::Achieved(id) => Some(e.data().achievement(id).name.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(achieved, ["clickme", "konami", "import"]);
}

#[test]
fn counts_bought_units_not_produced_ones() {
    let mut e = Engine::new_game(GameData::embedded(), T2020);
    e.with_save::<(), ()>(|e| {
        e.set_unit_count(u("meat"), n("1e12"));
        e.set_unit_count(u("larva"), n("1e12"));
        e.set_unit_count(u("queen"), n("1e6"));
        Ok(())
    })
    .unwrap();
    assert!(e.count(u("drone")) <= n("1e6"));
    e.apply(Command::BuyUnit {
        unit: "drone".into(),
        amount: Amount::Num(Num::ONE),
        ui: None,
    })
    .unwrap();
    assert!(e.achievement_earned(a("drone1")));
    assert!(!e.achievement_earned(a("drone2")));
    assert_eq!(
        e.unit_statistics(u("drone")).unwrap().twinnum.to_string(),
        "1"
    );
    assert_eq!(e.achievement_earned_at(a("drone1")), Some(0));
}

#[test]
fn masking_and_progress() {
    let mut e = Engine::new_game(GameData::embedded(), T2020);
    let d1 = a("drone1");
    let order = e.achievement_progress_order(d1);
    assert!(order == -2.0 || (0.0..1.0).contains(&order), "{order}");
    assert_eq!(e.achievement_progress_max(d1), Some(Num::ONE));
    assert_eq!(e.achievement_progress_val(d1), Some(Num::ZERO));
    e.earn_achievement(d1, None);
    assert_eq!(e.achievement_progress_order(d1), 2.0);
    assert!(e.achievement_percent() > 0.0);
    // no visibility requirements: masked forever
    for ach in e.data().achievements() {
        if ach.visible.is_empty() {
            assert!(!e.achievement_unmasked(ach.id));
        }
    }
}
