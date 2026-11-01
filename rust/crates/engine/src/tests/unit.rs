//! Port of `engine/test/unit.test.ts`.

use swarm_data::GameData;
use swarm_num::Num;

use crate::estimate::Estimate;
use crate::testutil::{ct, g, mkgame, n, u};
use crate::Engine;

fn ct_at(e: &mut Engine, name: &str, dt: f64) -> f64 {
    e.set_now_ms((dt * 1000.0) as i64).unwrap();
    ct(e, name)
}

fn prod0(name: &str) -> f64 {
    GameData::embedded().unit(u(name)).prod[0].val.to_f64()
}

fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs() * 1e-12, "{a} != {b}");
}

#[test]
fn production_graph_minimal() {
    let d = GameData::embedded();
    let meat = u("meat");
    for ancestor in ["hive", "nest", "queen", "drone"] {
        assert!(d.paths_of(meat).any(|p| p.first() == u(ancestor)));
    }
    assert!(!d.paths_of(meat).any(|p| p.first() == u("territory")));
}

#[test]
fn single_resource_over_time() {
    let mut e = mkgame(&[("meat", "1")]);
    for t in [0.0, 1.0, 9.5] {
        assert_eq!(ct_at(&mut e, "meat", t), 1.0);
    }
    let mut e = mkgame(&[("drone", "1")]);
    assert_eq!(ct_at(&mut e, "meat", 0.0), 0.0);
    assert_eq!(ct_at(&mut e, "meat", 1.0), 1.0);
    assert_eq!(ct_at(&mut e, "meat", 9.5), 9.5);
}

#[test]
fn single_resource_velocity() {
    let e = mkgame(&[("drone", "1")]);
    assert_eq!(e.velocity(u("meat")).to_f64(), 1.0);
    assert_eq!(e.velocity(u("drone")).to_f64(), 0.0);
}

#[test]
fn meat_and_drones() {
    let mut e = mkgame(&[("meat", "3"), ("drone", "2")]);
    assert_eq!(ct_at(&mut e, "meat", 0.0), 3.0);
    assert_eq!(ct_at(&mut e, "meat", 1.0), 5.0);
    assert_eq!(ct_at(&mut e, "meat", 9.5), 22.0);
}

#[test]
fn queen_is_quadratic() {
    let mut e = mkgame(&[("queen", "1")]);
    let c = prod0("queen");
    assert_eq!(ct_at(&mut e, "meat", 0.0), 0.0);
    close(ct_at(&mut e, "meat", 1.0), 0.5 * c);
    close(ct_at(&mut e, "meat", 4.0), 8.0 * c);
    close(ct_at(&mut e, "meat", 10.0), 50.0 * c);
    e.force_now_ms(0);
    assert_eq!(ct_at(&mut e, "drone", 0.0), 0.0);
    close(ct_at(&mut e, "drone", 1.0), c);
    close(ct_at(&mut e, "drone", 9.5), 9.5 * c);
}

#[test]
fn nest_is_cubic() {
    let mut e = mkgame(&[("nest", "1")]);
    let c = prod0("queen") * prod0("nest");
    assert_eq!(ct_at(&mut e, "meat", 0.0), 0.0);
    close(ct_at(&mut e, "meat", 1.0), c / 6.0);
    close(ct_at(&mut e, "meat", 4.0), 64.0 / 6.0 * c);
    close(ct_at(&mut e, "meat", 10.0), 1000.0 / 6.0 * c);
}

#[test]
fn mixed_polynomial() {
    let mut e = mkgame(&[("nest", "2"), ("queen", "3"), ("drone", "4"), ("meat", "5")]);
    let qc = prod0("queen");
    let nc = qc * prod0("nest");
    assert_eq!(ct_at(&mut e, "meat", 0.0), 5.0);
    close(
        ct_at(&mut e, "meat", 1.0),
        1.0 / 6.0 * 2.0 * nc + 0.5 * 3.0 * qc + 4.0 + 5.0,
    );
    close(
        ct_at(&mut e, "meat", 4.0),
        64.0 / 6.0 * 2.0 * nc + 8.0 * 3.0 * qc + 16.0 + 5.0,
    );
    close(
        ct_at(&mut e, "meat", 10.0),
        1000.0 / 6.0 * 2.0 * nc + 50.0 * 3.0 * qc + 40.0 + 5.0,
    );
}

#[test]
fn calculates_costs() {
    let e = mkgame(&[("larva", "100"), ("meat", "25")]);
    assert_eq!(e.unit_max_cost_met(u("drone"), Num::ONE).to_f64(), 2.0);
    assert!(e.unit_is_cost_met(u("drone")));
    let e = mkgame(&[("larva", "100"), ("meat", "9.99")]);
    assert_eq!(e.unit_max_cost_met(u("drone"), Num::ONE).to_f64(), 0.0);
    assert!(!e.unit_is_cost_met(u("drone")));
}

#[test]
fn hides_advanced_units() {
    let mut e = mkgame(&[("larva", "100"), ("meat", "1")]);
    let (drone, queen) = (u("drone"), u("queen"));
    assert!(e.unit_visible(drone));
    assert!(!e.unit_visible(queen));
    e.add_unit_count(drone, n("9"));
    assert!(e.unit_visible(drone));
    assert!(!e.unit_visible(queen));
    e.add_unit_count(drone, n("1"));
    assert!(e.unit_visible(queen));
    e.subtract_unit_count(drone, n("1"));
    assert!(e.unit_visible(drone));
    assert!(e.unit_visible(queen)); // we saw it once before
}

#[test]
fn calcs_unit_stats() {
    let mut e = mkgame(&[("drone", "99999999999999")]);
    let prod = e.data().stats().prod;
    assert_eq!(e.stat(u("drone"), prod, Num::ONE).to_f64(), 1.0);
    assert_eq!(e.stat(u("queen"), prod, Num::ONE).to_f64(), 1.0);
    e.buy_upgrade(g("droneprod"), Num::ONE).unwrap();
    assert!(e.stat(u("drone"), prod, Num::ONE).to_f64() > 1.0);
    assert_eq!(e.stat(u("queen"), prod, Num::ONE).to_f64(), 1.0);
}

#[test]
fn unknown_stats_are_none() {
    let e = mkgame(&[]);
    assert_eq!(
        e.stat_by_name(u("drone"), "jflksdfjdslkfhdljkhfdksjh"),
        None
    );
}

fn twin_test(unit: &str, twin: &str, counts: &[(&str, &str)]) {
    let mut e = mkgame(counts);
    let (unit, up) = (u(unit), g(twin));
    assert_eq!(e.twin_mult(unit).to_f64(), 1.0);
    let count = e.count(unit).to_f64();
    e.buy_unit(unit, Num::ONE).unwrap();
    assert_eq!(e.count(unit).to_f64(), count + 1.0);

    e.buy_upgrade(up, Num::ONE).unwrap();
    assert_eq!(e.twin_mult(unit).to_f64(), 2.0);
    let count = e.count(unit).to_f64();
    e.buy_unit(unit, Num::ONE).unwrap();
    assert_eq!(e.count(unit).to_f64(), count + 2.0);
    e.buy_unit(unit, n("5")).unwrap();
    assert_eq!(e.count(unit).to_f64(), count + 12.0);

    e.buy_upgrade(up, Num::ONE).unwrap();
    assert_eq!(e.twin_mult(unit).to_f64(), 4.0);
    let count = e.count(unit).to_f64();
    e.buy_unit(unit, Num::ONE).unwrap();
    assert_eq!(e.count(unit).to_f64(), count + 4.0);
    e.buy_unit(unit, n("5")).unwrap();
    assert_eq!(e.count(unit).to_f64(), count + 24.0);
}

#[test]
fn buys_twin_units_meat() {
    twin_test(
        "drone",
        "dronetwin",
        &[
            ("larva", "9999999"),
            ("meat", "9999999"),
            ("drone", "99999999999999"),
            ("queen", "9999999999999"),
        ],
    );
}

#[test]
fn buys_twin_units_military() {
    twin_test(
        "swarmling",
        "swarmlingtwin",
        &[
            ("larva", "9999999"),
            ("meat", "9999999"),
            ("swarmling", "0"),
            ("queen", "5"),
        ],
    );
}

#[test]
fn multiplies_production() {
    let mut e = mkgame(&[
        ("larva", "9999999"),
        ("meat", "9999999"),
        ("drone", "1000000"),
    ]);
    let (drone, meat) = (u("drone"), u("meat"));
    let prod = e.data().stats().prod;
    assert_eq!(e.stat(drone, prod, Num::ONE).to_f64(), 1.0);
    e.set_now_ms(1000).unwrap();
    let prod0 = e.total_production(drone);
    e.force_now_ms(0);
    e.add_upgrade_count(g("droneprod"), Num::ONE);
    let mult = e.stat(drone, prod, Num::ONE);
    assert!(mult.to_f64() > 1.0);
    e.set_now_ms(1000).unwrap();
    let prod1 = e.total_production(drone);
    let m0 = prod0.iter().find(|p| p.0 == meat).unwrap().1;
    let m1 = prod1.iter().find(|p| p.0 == meat).unwrap().1;
    assert_eq!((m0 * mult).to_f64(), m1.to_f64());
}

#[test]
fn parses_unit_requirements() {
    let mut e = mkgame(&[("meat", "1e39"), ("nexus", "4")]);
    let (cocoon, larva, up) = (u("cocoon"), u("larva"), g("cocooning"));
    let req = &e.data().unit(cocoon).requires;
    assert!(!req.is_empty());
    assert_eq!(req[0].resource, swarm_data::Resource::Upgrade(up));
    assert_eq!(e.upgrade_count(up).to_f64(), 0.0);
    assert!(!e.unit_visible(cocoon));
    assert!(e.upgrade_visible(up));
    assert!(!e.is_buy_button_visible(larva));
    assert_eq!(e.upgrade_max_cost_met(up, Num::ONE).to_f64(), 1.0);
    assert_eq!(e.data().upgrade(up).maxlevel, Some(Num::ONE));
    e.buy_upgrade(up, Num::ONE).unwrap();
    assert_eq!(e.upgrade_count(up).to_f64(), 1.0);
    assert!(e.unit_visible(cocoon));
    assert!(e.is_buy_button_visible(larva));
    assert!(!e.upgrade_visible(up));
}

#[test]
fn parses_or_requirements() {
    for (counts, vis) in [
        (&[("mutagen", "1")][..], true),
        (&[("premutagen", "1")][..], true),
        (&[("ascension", "1")][..], true),
        (&[][..], false),
    ] {
        let e = mkgame(counts);
        assert_eq!(e.unit_visible(u("mutagen")), vis, "{counts:?}");
        assert_eq!(e.unit_visible(u("premutagen")), vis, "{counts:?}");
    }
}

#[test]
fn caps_energy() {
    let mut e = mkgame(&[("energy", "1e39"), ("nexus", "5")]);
    let energy = u("energy");
    assert_eq!(e.cap(energy).unwrap().to_f64(), 50000.0);
    assert_eq!(e.count(energy).to_f64(), 50000.0);
    assert_eq!(e.cap_percent(energy).unwrap().to_f64(), 1.0);
    assert_eq!(e.cap_eta(energy), Some(Estimate::Reached)); // TS: 0
    e.set_unit_count(energy, n("50"));
    assert_eq!(e.cap(energy).unwrap().to_f64(), 50000.0);
    assert_eq!(e.count(energy).to_f64(), 50.0);
    assert_eq!(e.cap_percent(energy).unwrap().to_f64(), 0.001);
    assert_eq!(e.cap_eta(energy), Some(Estimate::Secs(99900.0)));
}

#[test]
fn doesnt_cap_meat() {
    let e = mkgame(&[("meat", "1e39")]);
    let meat = u("meat");
    assert_eq!(e.cap(meat), None);
    assert_eq!(e.count(meat).to_f64(), 1e39);
    assert_eq!(e.cap_percent(meat), None);
    assert_eq!(e.cap_eta(meat), None);
}

#[test]
fn empowering_increases_military_costs() {
    let mut e = mkgame(&[("meat", "1e40"), ("larva", "1e40"), ("queen", "5")]);
    let (ling, meat, empower) = (u("swarmling"), u("meat"), g("swarmlingempower"));
    let meatcount = e.count(meat);
    assert_eq!(e.count(ling).to_f64(), 0.0);
    let lingmax = e.unit_max_cost_met(ling, Num::ONE);
    let cost1 = e.each_cost(ling);
    e.buy_unit(ling, n("10")).unwrap();
    assert_eq!(e.count(ling).to_f64(), 10.0);
    assert!(e.count(meat).to_f64() >= meatcount.to_f64() - 750000000.0);
    assert_eq!(e.suffix(ling), "");

    e.buy_upgrade(empower, Num::ONE).unwrap();
    e.set_unit_count(meat, meatcount);
    assert_eq!(e.suffix(ling), "II");
    assert_eq!(e.count(ling).to_f64(), 0.0); // empowering destroys all units
    let cost2 = e.each_cost(ling);
    let find = |c: &[swarm_data::UnitAmount], unit| c.iter().find(|a| a.unit == unit).unwrap().val;
    assert!(find(&cost1, meat) < find(&cost2, meat));
    assert_eq!(find(&cost1, u("larva")), find(&cost2, u("larva")));
    assert!(e.unit_max_cost_met(ling, Num::ONE) < lingmax);
    e.buy_unit(ling, n("10")).unwrap();
    assert_eq!(e.count(ling).to_f64(), 10.0);
    assert!(e.count(meat).to_f64() < meatcount.to_f64() - 750000000.0);
}

#[test]
fn stats_from_unit_effects() {
    let mut e = mkgame(&[("energy", "0"), ("nexus", "1"), ("nightbug", "0")]);
    let energy = u("energy");
    assert_eq!(e.cap(energy).unwrap().to_f64(), 10000.0);
    e.set_unit_count(u("nexus"), n("2"));
    assert_eq!(e.cap(energy).unwrap().to_f64(), 20000.0);
    e.set_unit_count(u("nightbug"), n("250"));
    assert_eq!(e.cap(energy).unwrap().to_f64(), 40000.0);
}

#[test]
fn spent_on_units_and_upgrades() {
    let mut e = mkgame(&[("meat", "0"), ("drone", "3")]);
    let meat = u("meat");
    assert_eq!(e.spent(meat, &[]).to_f64(), 30.0);
    e.set_upgrade_count(g("hatchery"), n("1"));
    assert_eq!(e.spent(meat, &[]).to_f64(), 330.0);
    e.set_upgrade_count(g("hatchery"), n("3"));
    assert_eq!(e.spent(meat, &[]).to_f64(), 33330.0);
}

#[test]
fn caps_units_globally() {
    let e = mkgame(&[("meat", "1e9999999")]);
    assert_eq!(e.count(u("meat")), crate::production::UNIT_LIMIT);
    // decimal.js prints "1e+100000"; Num prints "1e100000"
}

#[test]
fn finds_max_production_polynomial() {
    let e = mkgame(&[("hive", "1")]);
    for (name, d) in [
        ("hive", 0),
        ("hivequeen", 0),
        ("energy", 0),
        ("greaterqueen", 1),
        ("nest", 2),
        ("queen", 3),
        ("drone", 4),
        ("meat", 5),
    ] {
        assert_eq!(e.max_degree(u(name)), d, "{name}");
    }
}

fn est(e: &Engine, name: &str, target: f64) -> f64 {
    match e.estimate_secs_until_earned(u(name), Num::from(target)) {
        Estimate::Secs(s) => s,
        other => panic!("{other:?}"),
    }
}

#[test]
fn estimates_production() {
    let e = mkgame(&[("hive", "1")]);
    let coeffs = |name| -> Vec<String> {
        e.coefficients(u(name))
            .iter()
            .map(|c| c.to_string())
            .collect()
    };
    assert_eq!(coeffs("greaterqueen"), ["0", "5"]);
    assert_eq!(est(&e, "greaterqueen", 100.0), 20.0);
    assert_eq!(
        e.count_in_secs_from_reified(u("greaterqueen"), n("20"))
            .to_f64(),
        100.0
    );
    assert_eq!(coeffs("nest"), ["0", "0", "20"]);
    assert_eq!(est(&e, "nest", 4000.0), 20.0);
    assert_eq!(
        e.count_in_secs_from_reified(u("nest"), n("20")).to_f64(),
        4000.0
    );
    for (name, c, target) in [
        ("queen", vec!["0", "0", "0", "60"], 80000.0),
        ("drone", vec!["0", "0", "0", "0", "120"], 800000.0),
        ("meat", vec!["0", "0", "0", "0", "0", "120"], 3200000.0),
    ] {
        assert_eq!(coeffs(name), c);
        assert_eq!(
            e.count_in_secs_from_reified(u(name), n("20")).to_f64(),
            target
        );
        let s = est(&e, name, target);
        assert!((19.8..=30.0).contains(&s), "{name}: {s}");
    }
}

fn smooth(name: &str, target: f64, degree: usize) {
    let mut e = mkgame(&[("hive", "1")]);
    assert_eq!(e.max_degree(u(name)), degree);
    for (step, expected) in [
        (0, 20.0),
        (5000, 15.0),
        (5000, 10.0),
        (5000, 5.0),
        (3000, 2.0),
    ] {
        if step > 0 {
            let t = e.now_ms() + step;
            e.set_now_ms(t).unwrap();
        }
        let s = est(&e, name, target);
        assert!((s - expected).abs() <= 0.2, "{name}: {s} vs {expected}");
        assert_eq!(
            e.count_in_secs_from_reified(u(name), n("20")).to_f64(),
            target
        );
    }
}

#[test]
fn smooth_quadratic_predictions() {
    smooth("nest", 4000.0, 2);
}

#[test]
fn smooth_cubic_predictions() {
    smooth("queen", 80000.0, 3);
}

#[test]
fn ignores_fractional_unit_production() {
    let mut e = mkgame(&[("queen", "0.99")]);
    let (queen, drone) = (u("queen"), u("drone"));
    let tp = |e: &Engine| {
        e.total_production(queen)
            .iter()
            .find(|p| p.0 == drone)
            .unwrap()
            .1
            .to_f64()
    };
    assert_eq!(e.velocity(drone).to_f64(), 0.0);
    assert_eq!(tp(&e), 0.0);
    e.set_unit_count(queen, n("1.99"));
    assert_eq!(e.velocity(drone).to_f64(), 2.0);
    assert_eq!(tp(&e), 2.0);
    e.set_unit_count(queen, n("2"));
    assert_eq!(e.velocity(drone).to_f64(), 4.0);
    assert_eq!(tp(&e), 4.0);
}

#[test]
fn reached_and_never_estimates() {
    let e = mkgame(&[("meat", "100")]);
    assert_eq!(
        e.estimate_secs_until_earned(u("meat"), n("50")),
        Estimate::Reached
    );
    assert_eq!(
        e.estimate_secs_until_earned(u("meat"), n("500")),
        Estimate::Never
    );
}

#[test]
fn recovers_nan_saves() {
    // NaN counts are zeroed when a legacy save is read
    assert_eq!(crate::state::legacy_count(f64::NAN), Num::ZERO);
    let e = mkgame(&[("meat", "9999999"), ("drone", "99999")]);
    assert_eq!(e.count(u("larva")).to_f64(), 0.0);
}

#[test]
fn quadratic_estimate_without_cancellation() {
    // b^2 >> 4ac: the TS form `(-b + sqrt(b^2 - 4ac)) / 2a` cancels to 0 at
    // 15 digits (decimal.js's 20 still resolve it); seen on an overmind
    // upgrade 1.19e12 s away in the fixture-session-whitespace corpus run
    // (4ac / b^2 = 1e-17)
    let e = mkgame(&[("hive", "1"), ("greaterqueen", "1e24")]);
    assert_eq!(e.max_degree(u("nest")), 2);
    let s = est(&e, "nest", 4e30);
    assert!((s / 1e6 - 1.0).abs() < 1e-9, "{s}");
}

#[test]
fn quadratic_estimate_cancels_like_decimal_js() {
    // 4ac / b^2 below 1e-19: decimal.js's `-b + sqrt(b^2 - 4ac)` is 0, so
    // the TS estimate is 0 (min of the linear and quadratic roots); the
    // fixture-session-whitespace corpus run has one (NaN upgrade estimate)
    let e = mkgame(&[("hive", "1"), ("greaterqueen", "1e30")]);
    assert_eq!(
        e.estimate_secs_until_earned(u("nest"), n("4e24")),
        Estimate::Secs(0.0)
    );
}

#[test]
fn a_target_within_rounding_of_the_count_is_reached() {
    // golden ascend-respec step 21: decimal.js sees `target - count` as 0
    // where Num keeps an ulp of noise
    let e = mkgame(&[("meat", "1e100")]);
    let count = e.count(u("meat"));
    let target = Num::new(1.0 + 2.0 * f64::EPSILON, 100);
    assert!(target > count);
    assert_eq!(
        e.estimate_secs_until_earned(u("meat"), target),
        Estimate::Reached
    );
    assert_eq!(
        e.estimate_secs_until_earned(u("meat"), count * Num::from_f64(1.001)),
        Estimate::Never
    );
}
