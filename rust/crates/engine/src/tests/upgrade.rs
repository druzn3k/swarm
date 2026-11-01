//! Port of `engine/test/upgrade.test.ts` and `factorlog.test.ts`.

use swarm_data::GameData;
use swarm_num::Num;

use crate::effects::EffectOutput;
use crate::estimate::Estimate;
use crate::testutil::{g, mkgame, n, u};
use crate::upgrade::UpgradeEstimate;
use crate::{CommandError, Engine};

fn effect(name: &str, i: usize) -> swarm_data::EffectId {
    GameData::embedded().upgrade(g(name)).effects[i]
}

fn out(e: &Engine, name: &str, i: usize) -> f64 {
    e.effect_output(effect(name, i), None)
        .num()
        .unwrap()
        .to_f64()
}

#[test]
fn parses_upgrades() {
    assert!(GameData::embedded().upgrades().len() > 4);
}

#[test]
fn buys_upgrades() {
    let mut e = mkgame(&[("territory", "999999999")]);
    let up = g("expansion");
    assert!(e.data().unit(u("invisiblehatchery")).upgrades.contains(&up));
    assert_eq!(e.upgrade_count(up).to_f64(), 0.0);
    e.buy_upgrade(up, Num::ONE).unwrap();
    assert_eq!(e.upgrade_count(up).to_f64(), 1.0);
}

#[test]
fn blocks_expensive_upgrades() {
    let mut e = mkgame(&[("territory", "1")]);
    let up = g("expansion");
    assert_eq!(
        e.buy_upgrade(up, Num::ONE),
        Err(CommandError::InsufficientResources)
    );
    assert_eq!(e.upgrade_count(up).to_f64(), 0.0);
}

#[test]
fn buys_and_calcs_max_upgrades() {
    let mut e = mkgame(&[("territory", "9")]);
    let (up, t) = (g("expansion"), u("territory"));
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 0.0);
    for (have, max) in [("10", 1.0), ("50", 2.0), ("1000", 5.0)] {
        e.set_unit_count(t, n(have));
        assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), max, "{have}");
    }
    e.buy_max_upgrade(up, Num::ONE).unwrap();
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 0.0);
    assert_eq!(e.upgrade_count(up).to_f64(), 5.0);
}

#[test]
fn clones_larvae() {
    let mut e = mkgame(&[
        ("energy", "9999999999999999999"),
        ("larva", "1000"),
        ("invisiblehatchery", "1"),
        ("nexus", "999"),
    ]);
    let (up, larva) = (g("clonelarvae"), u("larva"));
    let eff = effect("clonelarvae", 0);
    assert_eq!(e.effect_bank(eff).unwrap().to_f64(), 1000.0);
    assert_eq!(out(&e, "clonelarvae", 0), 1000.0);
    e.buy_upgrade(up, n("3")).unwrap();
    assert_eq!(e.upgrade_count(up).to_f64(), 3.0);
    assert_eq!(e.count(larva).to_f64(), 8000.0);
    assert_eq!(e.effect_bank(eff).unwrap().to_f64(), 8000.0);
    assert_eq!(out(&e, "clonelarvae", 0), 8000.0);
}

#[test]
fn buy_more_than_max() {
    let mut e = mkgame(&[("territory", "10")]);
    let up = g("expansion");
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 1.0);
    e.buy_upgrade(up, n("10")).unwrap();
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 0.0);
    assert_eq!(e.upgrade_count(up).to_f64(), 1.0);
}

#[test]
fn clones_cocoons() {
    let mut e = mkgame(&[
        ("energy", "1e39"),
        ("cocoon", "100"),
        ("larva", "10"),
        ("invisiblehatchery", "1"),
        ("nexus", "999"),
    ]);
    let eff = effect("clonelarvae", 0);
    assert_eq!(e.effect_bank(eff).unwrap().to_f64(), 110.0);
    assert_eq!(e.effect_cap(eff).unwrap().to_f64(), 100000.0);
    assert_eq!(out(&e, "clonelarvae", 0), 110.0);
    e.buy_upgrade(g("clonelarvae"), Num::ONE).unwrap();
    assert_eq!(e.count(u("cocoon")).to_f64(), 100.0);
    assert_eq!(e.count(u("larva")).to_f64(), 120.0);
}

#[test]
fn caps_clones() {
    let mut e = mkgame(&[
        ("energy", "1e39"),
        ("cocoon", "60000"),
        ("larva", "70000"),
        ("invisiblehatchery", "1"),
        ("nexus", "999"),
    ]);
    let eff = effect("clonelarvae", 0);
    assert_eq!(e.effect_bank(eff).unwrap().to_f64(), 130000.0);
    assert_eq!(e.effect_cap(eff).unwrap().to_f64(), 100000.0);
    assert_eq!(out(&e, "clonelarvae", 0), 100000.0);
    e.buy_upgrade(g("clonelarvae"), Num::ONE).unwrap();
    assert_eq!(e.count(u("cocoon")).to_f64(), 60000.0);
    assert_eq!(e.count(u("larva")).to_f64(), 170000.0);
    assert_eq!(e.effect_bank(eff).unwrap().to_f64(), 230000.0);
    assert_eq!(e.effect_cap(eff).unwrap().to_f64(), 100000.0);
    assert_eq!(out(&e, "clonelarvae", 0), 100000.0);
}

#[test]
fn sums_costs() {
    let e = mkgame(&[("territory", "9")]);
    let up = g("expansion");
    let c = e.sum_cost(up, Num::ONE, None);
    assert_eq!((c[0].unit, c[0].val.to_f64()), (u("territory"), 10.0));
    let c = e.sum_cost(up, n("3"), None);
    assert!((c[0].val.to_f64() - 94.525).abs() < 1e-12);
}

#[test]
fn notices_newly_available_upgrades() {
    let mut e = mkgame(&[("territory", "9")]);
    let (up, t) = (g("expansion"), u("territory"));
    let newly = |e: &mut Engine| e.upgrade_is_newly_upgradable(up, 1.0);
    assert!(!newly(&mut e));
    e.watch(up, 0);
    assert!(!newly(&mut e));
    e.watch(up, 1);
    assert!(!newly(&mut e));
    e.add_unit_count(t, Num::ONE);
    assert!(newly(&mut e));
    e.watch(up, 0);
    assert!(!newly(&mut e));
    e.watch(up, 1);
    assert!(newly(&mut e));
    e.buy_upgrade(up, Num::ONE).unwrap();
    assert!(!newly(&mut e));
    e.add_unit_count(t, n("50"));
    assert!(newly(&mut e));
    e.watch(up, 0);
    assert!(!newly(&mut e));
    e.add_unit_count(t, n("150"));
    assert!(!newly(&mut e));
}

fn rush(name: &str, unit: &str, counts: &[(&str, &str)], out0: f64, out1: f64) {
    let mut e = mkgame(counts);
    assert_eq!(out(&e, name, 0), out0);
    assert_eq!(out(&e, name, 1), out1);
    e.buy_upgrade(g(name), Num::ONE).unwrap();
    assert_eq!(e.upgrade_count(g(name)).to_f64(), 1.0);
    assert_eq!(e.count(u(unit)).to_f64(), out0 + out1);
    assert_eq!(out(&e, name, 0), out0);
    assert_eq!(out(&e, name, 1), out1);
}

#[test]
fn rushes_meat() {
    rush(
        "meatrush",
        "meat",
        &[
            ("energy", "9999999999999999999"),
            ("nexus", "999"),
            ("invisiblehatchery", "1"),
            ("drone", "1"),
            ("stinger", "1"),
        ],
        7200.0,
        100000000000.0,
    );
}

#[test]
fn rushes_territory() {
    rush(
        "territoryrush",
        "territory",
        &[
            ("energy", "9999999999999999999"),
            ("nexus", "999"),
            ("invisiblehatchery", "1"),
            ("drone", "1"),
            ("swarmling", "1"),
        ],
        504.0,
        1000000000.0,
    );
}

#[test]
fn rushes_larvae() {
    rush(
        "larvarush",
        "larva",
        &[
            ("energy", "9999999999999999999"),
            ("nexus", "999"),
            ("invisiblehatchery", "1"),
            ("drone", "1"),
            ("swarmling", "1"),
        ],
        2400.0,
        100000.0,
    );
}

fn spawns(name: &str, counts: &[(&str, &str)], levels: &str) {
    let mut e = mkgame(counts);
    let (up, pre) = (g(name), u("premutagen"));
    e.buy_upgrade(up, n(levels)).unwrap();
    assert_eq!(e.count(pre).to_f64(), 0.0);
    let eff = effect(name, 1);
    assert_eq!(
        e.data().effect(eff).kind,
        swarm_data::EffectKind::AddUnitRand
    );
    let next = |e: &Engine| match e.effect_output_next(eff) {
        EffectOutput::Rand(r) => r.qty.to_f64(),
        other => panic!("{other:?}"),
    };
    let spawned = next(&e);
    for _ in 0..3 {
        assert_eq!(next(&e), spawned);
    }
    e.buy_upgrade(up, Num::ONE).unwrap();
    // first spawn is guaranteed
    assert_eq!(e.count(pre).to_f64(), spawned);
    assert!((7000.0..=10000.0).contains(&spawned), "{spawned}");
    assert!(e.first_spawn().contains_key(&pre));
}

#[test]
fn spawns_premutagen_with_hatcheries() {
    spawns("hatchery", &[("meat", "9e100"), ("premutagen", "0")], "39");
}

#[test]
fn spawns_premutagen_with_expansions() {
    spawns(
        "expansion",
        &[("territory", "9e999"), ("premutagen", "0")],
        "79",
    );
}

#[test]
fn spawns_depend_on_the_restart_date() {
    let mut e = mkgame(&[("invisiblehatchery", "1"), ("meat", "1e100")]);
    assert_eq!(e.state().dates.restarted, Some(0));
    let (pre, meat, hatchery) = (u("premutagen"), u("meat"), g("hatchery"));
    e.buy_upgrade(hatchery, n("80")).unwrap();
    let precount = e.count(pre);
    assert!(!precount.is_zero());

    e.force_now_ms(1);
    e.ascend(true).unwrap();
    assert_eq!(e.state().dates.restarted, Some(1));
    e.set_unit_count(meat, n("1e100"));
    e.buy_upgrade(hatchery, n("80")).unwrap();
    assert_ne!(precount, e.count(pre));

    e.ascend(true).unwrap();
    e.state.dates.restarted = Some(0);
    e.set_unit_count(meat, n("1e100"));
    e.buy_upgrade(hatchery, n("80")).unwrap();
    assert_eq!(precount, e.count(pre));
}

#[test]
fn swarmwarps_without_changing_energy() {
    let mut e = mkgame(&[
        ("energy", "50000"),
        ("nexus", "999"),
        ("invisiblehatchery", "1"),
        ("drone", "1"),
        ("meat", "0"),
    ]);
    let energy = u("energy");
    assert_eq!(e.count(energy).to_f64(), 50000.0);
    e.buy_upgrade(g("swarmwarp"), Num::ONE).unwrap();
    assert_eq!(e.count(energy).to_f64(), 48000.0);
    e.buy_upgrade(g("swarmwarp"), Num::ONE).unwrap();
    assert_eq!(e.count(energy).to_f64(), 46000.0);
    assert_eq!(e.total_skipped_ms(), 1_800_000);
    // the skipped time produced meat
    assert_eq!(e.count(u("meat")).to_f64(), 1800.0);
}

#[test]
fn count_never_exceeds_maxlevel() {
    let mut e = mkgame(&[]);
    let up = g("achievementbonus");
    assert_eq!(e.data().upgrade(up).maxlevel, Some(n("5")));
    assert_eq!(e.upgrade_count(up).to_f64(), 0.0);
    e.set_upgrade_count(up, n("999"));
    assert_eq!(e.upgrade_count(up).to_f64(), 5.0);
}

#[test]
fn wont_buy_more_than_maxlevel() {
    let mut e = mkgame(&[("meat", "1e300"), ("territory", "1e300")]);
    let up = g("achievementbonus");
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 5.0);
    e.set_upgrade_count(up, n("1"));
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 4.0);
    e.set_upgrade_count(up, n("3"));
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 2.0);
}

#[test]
fn autobuyable_depends_on_watched() {
    let mut e = mkgame(&[]);
    assert!(e.upgrade_is_autobuyable(g("droneprod")));
    assert!(e.upgrade_is_autobuyable(g("dronetwin")));
    assert!(e.upgrade_is_autobuyable(g("swarmlingtwin")));
    assert!(!e.upgrade_is_autobuyable(g("mutatemeat")));
    e.watch(g("dronetwin"), 0);
    assert!(!e.upgrade_is_autobuyable(g("dronetwin")));
    e.watch(g("dronetwin"), 1);
    assert!(e.upgrade_is_autobuyable(g("dronetwin")));
    assert!(e.state().watched.is_empty());
}

#[test]
fn asymptotic_stats_multiply() {
    // #264
    let e = mkgame(&[
        ("nexus", "5"),
        ("moth", "1e1000"),
        ("mutantnexus", "1e1000"),
    ]);
    let v = e.velocity(u("energy")).to_f64();
    assert!(v > 1.9 && v < 2.1, "{v}");
}

#[test]
fn empty_statistics() {
    let e = mkgame(&[]);
    assert_eq!(e.upgrade_statistics(g("nexus1")), None);
}

#[test]
fn buy_all_accounts_for_watch_points() {
    let mut e = mkgame(&[]);
    let (up, t) = (g("expansion"), u("territory"));
    let n_avail = |e: &Engine| e.available_autobuy_upgrades(None).len();
    assert_eq!(n_avail(&e), 0);
    e.set_unit_count(t, n("10"));
    assert_eq!(n_avail(&e), 1);
    e.set_unit_count(t, n("9"));
    assert_eq!(n_avail(&e), 0);
    e.watch(up, 2);
    assert_eq!(n_avail(&e), 0);
    e.set_unit_count(t, n("10"));
    assert_eq!(n_avail(&e), 0);
    e.set_unit_count(t, n("20"));
    assert_eq!(n_avail(&e), 1);
    e.set_unit_count(t, n("19"));
    assert_eq!(n_avail(&e), 0);
}

#[test]
fn estimates_upgrades() {
    let e = mkgame(&[("drone", "10")]);
    match e.estimate_secs_until_buyable(g("hatchery")) {
        UpgradeEstimate::Wait {
            secs,
            unit,
            cache_safe,
        } => {
            assert!(cache_safe);
            assert_eq!(unit, Some(u("meat")));
            assert_eq!(secs, Estimate::Secs(30.0));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn upgrade_estimates_age_with_the_clock() {
    let mut e = mkgame(&[("drone", "10")]);
    let secs = |e: &Engine| match e.estimate_secs_until_buyable(g("hatchery")) {
        UpgradeEstimate::Wait { secs, .. } => secs.secs(),
        other => panic!("{other:?}"),
    };
    assert_eq!(secs(&e), 30.0);
    e.set_now_ms(10_000).unwrap();
    assert_eq!(secs(&e), 20.0);
    // due: recomputed once (now 0 left)
    e.set_now_ms(40_000).unwrap();
    assert!(matches!(
        e.estimate_secs_until_buyable(g("hatchery")),
        UpgradeEstimate::MaxAffordable | UpgradeEstimate::Wait { .. }
    ));
}

// factorlog.test.ts: maxCostMet against the uncached formula
#[test]
fn max_cost_met_matches_the_formula() {
    let mut e = mkgame(&[]);
    let data = GameData::embedded();
    for up in data.upgrades() {
        for exp in [0, 1, 3, 7, 12, 20, 40, 80, 150] {
            let have = Num::new(1.7, exp);
            for c in &up.cost {
                e.state.units.insert(data.unit(c.unit).name.clone(), have);
            }
            e.on_update();
            let mut max = up.maxlevel.map(|m| m - e.upgrade_count(up.id));
            for c in e.total_cost(up.id) {
                let m = if c.factor == Num::ONE {
                    e.count(c.unit) / c.val
                } else {
                    let x = Num::ONE - e.count(c.unit) * (Num::ONE - c.factor) / c.val;
                    Num::from_f64(x.log10() / c.factor.log10())
                };
                max = Some(max.map_or(m, |x| x.min(m)));
            }
            let got = e.upgrade_max_cost_met(up.id, Num::ONE);
            match max {
                None => assert_eq!(got, Num::MAX),
                Some(max) => {
                    let max = max.floor();
                    assert!(
                        got == max || got == max - Num::ONE,
                        "{} {exp}: {got} vs {max}",
                        up.name
                    );
                }
            }
        }
    }
}

#[test]
fn guards_huge_purchases() {
    // a huge energy cap makes factor-1 abilities affordable 1e290 times
    let mut e = mkgame(&[
        ("energy", "1e300"),
        ("nexus", "1e300"),
        ("invisiblehatchery", "1"),
    ]);
    let warp = g("swarmwarp");
    assert!(e.upgrade_max_cost_met(warp, Num::ONE).to_f64() > 1e100);
    let before = e.state().clone();
    assert_eq!(
        e.buy_max_upgrade(warp, Num::ONE),
        Err(CommandError::TooManyLevels)
    );
    assert_eq!(e.state(), &before);
    assert_eq!(e.buy_upgrade(warp, n("2")), Ok(n("2")));
}
