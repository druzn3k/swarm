//! Production: producer paths and the count polynomial (`unit.ts:30-177`).
//!
//! `count(t) = Σ_d c_d · t^d / d!`, where `c_0` is the unit's raw count and
//! `c_d` sums `floor(raw count of the path's first ancestor) · prodEach` over
//! the unit's paths of degree `d`.

use swarm_data::{PathId, UnitId};
use swarm_num::Num;

use crate::engine::Engine;

/// The global unit limit, `1e100000` (`unit.ts:13`, the Coffee app's
/// `UNIT_LIMIT`). Counts and path products are clamped to it.
pub const UNIT_LIMIT: Num = Num::from_parts(1.0, 100_000);

/// `d!` as a JS number (mathjs 3.8.1 `factorial`, exact for the degrees the
/// data has).
pub fn factorial(n: usize) -> f64 {
    (2..=n).fold(1.0, |acc, i| acc * i as f64)
}

/// Evaluates `Σ c_d · secs^d / d!` in the TS order (`unit.ts:168-176`).
pub fn eval_poly(coeffs: &[Num], secs: Num) -> Num {
    let mut ret = Num::ZERO;
    for (degree, c) in coeffs.iter().enumerate() {
        ret += *c * secs.pow(degree as f64) / Num::from_f64(factorial(degree));
    }
    ret
}

impl Engine {
    /// The product of `(prod + base stat) · prod stat` along a path, clamped to
    /// [`UNIT_LIMIT`] at each step (`unit.ts:59-86`). Cached per path prefix
    /// in the update generation, built from the longest cached prefix: the
    /// same operations in the same order as computing it alone.
    pub fn prod_each(&self, path: PathId) -> Num {
        if let Some(v) = self.cache.borrow().prod_each[path.index()] {
            return v;
        }
        let p = self.data.producer_path(path);
        let (mut k, mut ret) = {
            let cache = self.cache.borrow();
            let mut k = p.prefixes.len();
            let mut ret = Num::ONE;
            while k > 0 {
                if let Some(v) = cache.prod_each[p.prefixes[k - 1].index()] {
                    ret = v;
                    break;
                }
                k -= 1;
            }
            (k, ret)
        };
        while k < p.links.len() {
            let link = &p.links[k];
            let base = self.stat(link.parent, self.data.stats().base, Num::ZERO);
            ret *= link.prod + base;
            ret *= self.stat(link.parent, self.data.stats().prod, Num::ONE);
            ret = ret.min(UNIT_LIMIT);
            self.cache.borrow_mut().prod_each[p.prefixes[k].index()] = Some(ret);
            k += 1;
        }
        ret
    }

    /// `floor(raw count of the first ancestor) · prodEach` (`unit.ts:87-90`;
    /// floor: no fractional units, #184).
    pub fn path_coefficient(&self, path: PathId) -> Num {
        let first = self.data.producer_path(path).first();
        self.raw_count(first).floor() * self.prod_each(path)
    }

    /// Like [`Engine::path_coefficient`] with the ancestor's current count.
    pub fn path_coefficient_now(&self, path: PathId) -> Num {
        let first = self.data.producer_path(path).first();
        self.count(first).floor() * self.prod_each(path)
    }

    /// The polynomial's coefficients, index = degree, up to the highest
    /// degree with a non-zero coefficient (`unit.ts:141-162`). Cached in the
    /// update generation.
    pub fn coefficients(&self, unit: UnitId) -> Vec<Num> {
        if let Some(v) = &self.cache.borrow().coefficients[unit.index()] {
            return v.clone();
        }
        let v = self.compute_coefficients(unit, false);
        self.cache.borrow_mut().coefficients[unit.index()] = Some(v.clone());
        v
    }

    /// The coefficients with current counts in place of raw counts (TS
    /// `getCoefficientsNow`), for estimates.
    pub fn coefficients_now(&self, unit: UnitId) -> Vec<Num> {
        self.compute_coefficients(unit, true)
    }

    fn compute_coefficients(&self, unit: UnitId, now: bool) -> Vec<Num> {
        let mut ret: Vec<Option<Num>> = vec![Some(if now {
            self.count(unit)
        } else {
            self.raw_count(unit)
        })];
        for &path in &self.data.unit(unit).producer_paths {
            let degree = self.data.producer_path(path).degree();
            let c = if now {
                self.path_coefficient_now(path)
            } else {
                self.path_coefficient(path)
            };
            if !c.is_zero() {
                if ret.len() <= degree {
                    ret.resize(degree + 1, None);
                }
                ret[degree] = Some(ret[degree].unwrap_or(Num::ZERO) + c);
            }
        }
        ret.into_iter().map(|c| c.unwrap_or(Num::ZERO)).collect()
    }

    /// The highest degree with a producing ancestor (TS `getMaxDegree`).
    pub fn max_degree(&self, unit: UnitId) -> usize {
        self.coefficients(unit).len() - 1
    }

    /// The uncapped polynomial at `secs` after the last reify (TS
    /// `ProducerPaths.count`).
    pub fn poly_count(&self, unit: UnitId, secs: Num) -> Num {
        eval_poly(&self.coefficients(unit), secs)
    }

    /// The sum of the degree-`degree` path coefficients, from current counts
    /// if `now` (TS `getDegreeCoefficient`).
    pub fn degree_coefficient(&self, unit: UnitId, degree: usize, now: bool) -> Num {
        let mut ret = Num::ZERO;
        for &path in &self.data.unit(unit).producer_paths {
            if self.data.producer_path(path).degree() == degree {
                ret += if now {
                    self.path_coefficient_now(path)
                } else {
                    self.path_coefficient(path)
                };
            }
        }
        ret
    }

    /// Units per second being produced now: the degree-1 coefficient from
    /// current counts, clamped to [`UNIT_LIMIT`] (`unit.ts:689-694`). Cached
    /// per tick.
    pub fn velocity(&self, unit: UnitId) -> Num {
        if let Some(v) = self.cache.borrow().velocity[unit.index()] {
            return v;
        }
        let v = UNIT_LIMIT.min(self.degree_coefficient(unit, 1, true));
        self.cache.borrow_mut().velocity[unit.index()] = Some(v);
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{mkgame, n};

    #[test]
    fn factorials() {
        assert_eq!(factorial(0), 1.0);
        assert_eq!(factorial(5), 120.0);
        assert_eq!(factorial(20), 2_432_902_008_176_640_000.0);
    }

    // prodeach.test.ts: whatever order paths are asked in, each gets the
    // value it has when computed alone
    #[test]
    fn prod_each_prefix_cache_is_order_independent() {
        let e = mkgame(&[
            ("hive", "1e30"),
            ("nest", "1e20"),
            ("queen", "1e10"),
            ("drone", "1e5"),
            ("larva", "1e40"),
            ("meat", "1e50"),
        ]);
        let data = e.data();
        let paths: Vec<_> = data.producer_paths().iter().map(|p| p.id).collect();
        assert!(paths.len() > 100);
        let mut alone = Vec::new();
        for &p in &paths {
            e.cache
                .borrow_mut()
                .prod_each
                .iter_mut()
                .for_each(|c| *c = None);
            alone.push(e.prod_each(p));
        }
        let mut by_degree = paths.clone();
        by_degree.sort_by_key(|&p| data.producer_path(p).degree());
        let mut by_degree_desc = by_degree.clone();
        by_degree_desc.reverse();
        for order in [by_degree, by_degree_desc, paths.clone()] {
            e.cache
                .borrow_mut()
                .prod_each
                .iter_mut()
                .for_each(|c| *c = None);
            for &p in &order {
                assert_eq!(e.prod_each(p), alone[p.index()]);
            }
        }
    }

    #[test]
    fn evaluates_polynomials() {
        let c = [n("1"), n("3"), n("5"), n("7")];
        // 1 + 3*2 + 5*4/2 + 7*8/6
        let got = eval_poly(&c, n("2")).to_f64();
        assert!((got - (1.0 + 6.0 + 10.0 + 56.0 / 6.0)).abs() < 1e-12);
    }
}
