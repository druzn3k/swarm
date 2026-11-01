//! Port of `engine/test/game.test.ts` and `backfill.test.ts`, plus the
//! cache-timing behaviours `differential.test.ts` checks against the
//! original game.

use swarm_data::GameData;
use swarm_num::Num;

use crate::estimate::Estimate;
use crate::testutil::{g, mkgame, n, u};
use crate::{CommandError, Engine};

const T2020: i64 = 1_577_836_800_000;

#[test]
fn respecs_mutagen() {
    let mut e = mkgame(&[
        ("mutagen", "100000"),
        ("ascension", "1"),
        ("nexus", "1e999"),
        ("energy", "1e999"),
    ]);
    let (mutagen, mutant, mutant2) = (u("mutagen"), u("mutanthatchery"), u("mutantbat"));
    assert_eq!(e.count(mutant).to_f64(), 0.0);
    e.buy_upgrade(g("mutatehatchery"), Num::ONE).unwrap();
    e.buy_upgrade(g("mutatebat"), Num::ONE).unwrap();
    assert_eq!(e.count(mutant).to_f64(), 1.0);
    assert_eq!(e.count(mutant2).to_f64(), 1.0);
    e.buy_unit(mutant, n("39998")).unwrap();
    e.buy_unit(mutant2, n("40000")).unwrap();
    assert_eq!(e.count(mutant).to_f64(), 39999.0);
    assert_eq!(e.count(mutant2).to_f64(), 40001.0);
    assert_eq!(e.count(mutagen).to_f64(), 4376.0);
    assert_eq!(e.respec_spent().to_f64(), 95624.0);
    assert!(e.unit_visible(mutant));
    assert!(e.unit_visible(mutant2));
    e.respec().unwrap();
    assert_eq!(e.count(mutant).to_f64(), 0.0);
    assert_eq!(e.count(mutant2).to_f64(), 0.0);
    assert!(!e.unit_visible(mutant));
    assert!(!e.unit_visible(mutant2));
    assert_eq!(e.count(mutagen).to_f64(), 100000.0);
}

#[test]
fn sane_ascension_costs() {
    let mut e = mkgame(&[("nexus", "1e100"), ("energy", "1e100")]);
    let (ascends, warps, mutants) = (u("ascension"), g("swarmwarp"), u("mutantnexus"));
    let cost = |e: &Engine| e.ascend_cost(None).to_f64();
    assert_eq!(e.ascend_energy_spent().to_f64(), 0.0);
    assert_eq!(cost(&e), 5000000.0);
    e.set_unit_count(ascends, n("1"));
    assert_eq!(cost(&e), 5600000.0);
    e.set_unit_count(ascends, n("2"));
    assert_eq!(cost(&e), 6272000.0);
    e.set_unit_count(ascends, n("0"));
    for (w, spent, c) in [
        ("25", 50000.0, 2500000.0),
        ("50", 100000.0, 1250000.0),
        ("75", 150000.0, 625000.0),
    ] {
        e.set_upgrade_count(warps, n(w));
        assert_eq!(e.ascend_energy_spent().to_f64(), spent);
        assert_eq!(cost(&e), c);
    }
    e.set_unit_count(ascends, n("1"));
    assert_eq!(e.ascend_energy_spent().to_f64(), 150000.0);
    assert_eq!(cost(&e), 700000.0);
    // mutant lepidoptera increase the cost
    e.set_unit_count(mutants, n("1000"));
    assert_eq!(cost(&e), 989950.0);
    // a free respec doesn't reset spent energy
    let fr = u("freeRespec");
    e.set_unit_count(fr, e.data().unit(fr).init);
    assert_eq!(e.count(fr).to_f64(), 4.0);
    e.respec_free().unwrap();
    assert_eq!(e.count(mutants).to_f64(), 0.0);
    assert_eq!(e.count(fr).to_f64(), 3.0);
    assert_eq!(cost(&e), 700000.0);
    // respec resets spent energy
    e.set_unit_count(mutants, n("1000"));
    e.set_upgrade_count(warps, n("400"));
    assert_eq!(e.respec_cost().to_f64(), 163.0);
    e.respec().unwrap();
    assert_eq!(e.count(mutants).to_f64(), 0.0);
    assert_eq!(e.ascend_energy_spent().to_f64(), 163.0);
    assert_eq!(cost(&e), 5587361.0);
}

#[test]
fn ascends() {
    let mut e = mkgame(&[("drone", "100"), ("premutagen", "100")]);
    for (name, c) in [
        ("ascension", 0.0),
        ("drone", 100.0),
        ("premutagen", 100.0),
        ("mutagen", 0.0),
        ("nexus", 0.0),
        ("energy", 0.0),
    ] {
        assert_eq!(e.count(u(name)).to_f64(), c, "{name}");
    }
    assert_eq!(e.state().dates.restarted, Some(0));
    e.force_now_ms(1);
    assert_eq!(e.ascend(false), Err(CommandError::AscendCost));
    assert_eq!(e.count(u("drone")).to_f64(), 100.0);
    e.set_unit_count(u("nexus"), n("9e999"));
    e.set_unit_count(u("energy"), n("9e999"));
    e.ascend(false).unwrap();
    for (name, c) in [
        ("ascension", 1.0),
        ("drone", 0.0),
        ("premutagen", 0.0),
        ("mutagen", 100.0),
        ("nexus", 0.0),
        ("energy", 0.0),
    ] {
        assert_eq!(e.count(u(name)).to_f64(), c, "{name}");
    }
    assert_eq!(e.state().dates.restarted, Some(1));
    assert!(e.first_spawn().contains_key(&u("ascension")));
}

#[test]
fn backfill_grants_free_respecs_to_fresh_games() {
    let e = Engine::new_game(GameData::embedded(), T2020);
    assert_eq!(e.count(u("freeRespec")).to_f64(), 4.0);
}

#[test]
fn backfill_restores_a_lost_ascension_count() {
    let mut e = Engine::new_game(GameData::embedded(), T2020);
    e.state.statistics.by_unit.insert(
        "ascension".into(),
        crate::state::UnitStatistics {
            clicks: 3,
            num: n("3"),
            twinnum: n("3"),
            elapsed_first: None,
            ..Default::default()
        },
    );
    e.run_backfill();
    assert_eq!(e.count(u("ascension")).to_f64(), 3.0);
}

#[test]
fn backfill_initializes_free_respecs_only_when_missing() {
    let mut s = crate::State::with_units(0, [("freeRespec", n("1"))]);
    s.units.insert("meat".into(), n("5"));
    let out = Engine::load(GameData::embedded(), s, 1000, None).unwrap();
    assert_eq!(out.engine.count(u("freeRespec")).to_f64(), 1.0);
    let s = crate::State::with_units(0, [("meat", n("5"))]);
    let out = Engine::load(GameData::embedded(), s, 1000, None).unwrap();
    assert_eq!(out.engine.count(u("freeRespec")).to_f64(), 4.0);
    assert_eq!(out.offline.map(|o| o.away_ms()), Some(1000));
}

#[test]
fn backfill_replays_premutagen_for_pre_mutagen_saves() {
    let mut s = crate::State::with_units(0, [("meat", n("0"))]);
    s.upgrades.insert("hatchery".into(), n("45"));
    let out = Engine::load(GameData::embedded(), s, 0, None).unwrap();
    let pre = out.engine.count(u("premutagen"));
    assert!(pre.is_positive());
    // same rolls as buying them
    let mut e = mkgame(&[("meat", "1e100")]);
    e.buy_upgrade(g("hatchery"), n("45")).unwrap();
    assert_eq!(e.count(u("premutagen")), pre);
}

#[test]
fn loading_clamps_a_clock_far_behind_the_save() {
    let s = crate::State::with_units(1_000_000, [("drone", n("1"))]);
    let out = Engine::load(GameData::embedded(), s, 0, None).unwrap();
    assert_eq!(out.warnings.len(), 1);
    assert_eq!(out.engine.now_ms(), 1_000_000);
}

// differential.test.ts: "isUpgradable" is refreshed only every 3 s of clock
// time, so buy-all can be stale
#[test]
fn upgradable_is_stale_for_three_seconds() {
    let mut e = mkgame(&[("territory", "5"), ("queen", "1"), ("swarmling", "100")]);
    let (exp, t) = (g("expansion"), u("territory"));
    assert!(!e.upgrade_is_upgradable(exp, None, false));
    assert!(!e.available_autobuy_upgrades(None).contains(&exp));
    let v = e.velocity(t).to_f64();
    assert!(v > 0.0);
    // territory reaches 10 (the cost) after this many ms
    let due = ((10.0 - 5.0) / v * 1000.0).ceil() as i64 + 1;
    assert!(due < 2900, "{due}");
    e.set_now_ms(due).unwrap();
    assert!(e.count(t).to_f64() >= 10.0);
    assert!(e.upgrade_is_buyable(exp));
    assert!(!e.upgrade_is_upgradable(exp, None, false), "stale");
    assert!(
        !e.available_autobuy_upgrades(None).contains(&exp),
        "buy-all is stale too"
    );
    e.set_now_ms(3000).unwrap();
    assert!(e.upgrade_is_upgradable(exp, None, false), "refreshed");
    assert!(e.available_autobuy_upgrades(None).contains(&exp));
}

// visibility is sticky until respec/ascend/import
#[test]
fn visibility_is_sticky() {
    let mut e = mkgame(&[("drone", "10")]);
    let queen = u("queen");
    assert!(e.unit_visible(queen));
    e.set_unit_count(u("drone"), n("0"));
    assert!(e.unit_visible(queen));
    e.import_state(e.state().clone()).unwrap();
    assert!(!e.unit_visible(queen));
}

// ascendCostDurationSecs throws a TypeError in the TS once energy covers the
// cost; Rust says Reached
#[test]
fn ascend_estimate_when_reached() {
    let mut e = mkgame(&[("nexus", "5"), ("energy", "1e7")]);
    assert_eq!(e.ascend_cost_duration(e.ascend_cost(None)), None); // above the cap
    e.set_upgrade_count(g("swarmwarp"), n("1000"));
    let cost = e.ascend_cost(None);
    assert!(cost < e.cap(u("energy")).unwrap());
    assert_eq!(e.ascend_cost_duration(cost), Some(Estimate::Reached));
}

// stats are cached until the next state change, so achievement points
// earned without a reify are missed until then
#[test]
fn stats_miss_unreified_achievements() {
    let mut e = mkgame(&[("larva", "1")]);
    let (bonus, larva) = (g("achievementbonus"), u("larva"));
    e.set_upgrade_count(bonus, n("1"));
    let prod = e.data().stats().prod;
    let before = e.stat(larva, prod, Num::ONE);
    e.earn_achievement(e.data().achievement_id("drone1").unwrap(), Some(5));
    assert_eq!(e.achievement_points(), 10);
    assert_eq!(
        e.stat(larva, prod, Num::ONE),
        before,
        "stale until the next update"
    );
    e.on_update();
    assert!(e.stat(larva, prod, Num::ONE) > before);
}

#[test]
fn reify_keeps_counts_and_writes_every_unit() {
    let mut e = mkgame(&[("drone", "2"), ("meat", "1")]);
    e.set_now_ms(10_000).unwrap();
    e.reify();
    assert_eq!(e.state().units["meat"], n("21"));
    assert_eq!(e.state().dates.reified, 10_000);
    assert_eq!(e.state().units.len(), e.data().units().len());
    assert_eq!(e.count(u("meat")), n("21"));
}
