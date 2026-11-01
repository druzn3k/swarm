//! Debugging aid: runs a scenario up to (not including) step N and prints
//! units' counts, costs and maxCostMet with full mantissas.
//!
//! `cargo run --example trace -- <scenario.json> <step> <unit>...`
use swarm_num::Num;
use swarm_scenario::run::{Runner, Scenario};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let s = Scenario::from_json(&std::fs::read_to_string(&args[0]).unwrap()).unwrap();
    let n: usize = args[1].parse().unwrap();
    let mut r = Runner::start(&s.start).unwrap();
    for step in &s.steps[..n] {
        r.run_step(step);
    }
    let e = &r.engine;
    let d = e.data();
    let full = |x: Num| format!("{:.17}e{}", x.mantissa(), x.exponent());
    println!(
        "now {} reified {} diff_s {}",
        e.now_ms(),
        e.reified_ms(),
        e.diff_seconds()
    );
    for name in &args[2..] {
        if let Some(u) = d.unit_id(name) {
            println!(
                "unit {name}: raw {} count {} vel {} maxCostMet {}",
                full(e.raw_count(u)),
                full(e.count(u)),
                full(e.velocity(u)),
                full(e.unit_max_cost_met(u, Num::ONE))
            );
            for c in e.each_cost(u) {
                println!("   cost {} {}", d.unit(c.unit).name, full(c.val));
            }
            println!(
                "   estimate(count*10) {:?}",
                e.estimate_secs_until_earned(u, e.count(u) * Num::TEN)
            );
            println!(
                "   coeffs {:?}",
                e.coefficients(u)
                    .iter()
                    .map(|c| full(*c))
                    .collect::<Vec<_>>()
            );
        } else if let Some(g) = d.upgrade_id(name) {
            println!(
                "upgrade {name}: count {} maxCostMet {}",
                full(e.upgrade_count(g)),
                full(e.upgrade_max_cost_met(g, Num::ONE))
            );
            println!("   estimate {:?}", e.estimate_secs_until_buyable(g));
            for c in e.sum_cost(g, e.upgrade_max_cost_met(g, Num::ONE) + Num::ONE, None) {
                println!(
                    "   next cost estimate {:?}",
                    e.estimate_secs_until_earned(c.unit, c.val)
                );
            }
            for c in e.total_cost(g) {
                println!(
                    "   cost {} {} f {}",
                    d.unit(c.unit).name,
                    full(c.val),
                    full(c.factor)
                );
            }
        }
    }
}
