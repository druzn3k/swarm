//! Producer paths, precomputed at load (`engine/src/unittypes.ts`
//! `_buildProducerPath`, `engine/src/unit.ts` `ProducerPath(s)`).
//!
//! A unit's count is a polynomial in the time since the last reify:
//! `count(t) = Σ_d c_d · t^d / d!`, where `c_d` sums, over the unit's paths
//! of degree `d`, `floor(count(first ancestor)) · prodEach(path)`. The paths
//! depend only on the data, so they are computed once here.

use std::collections::HashMap;

use swarm_num::Num;

use crate::error::{invalid, DataError};
use crate::ids::{PathId, UnitId};
use crate::types::UnitType;

/// One link of a producer path: each `parent` produces `prod` `child`ren per
/// second (before stats).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PathLink {
    /// The producer.
    pub parent: UnitId,
    /// What it produces: the next link's parent, or the path's unit.
    pub child: UnitId,
    /// `parent`'s `prod.val` for `child`.
    pub prod: Num,
    /// Index of that entry in `parent`'s [`UnitType::prod`]. If a unit had
    /// two entries for one child, the TS engine's `prodByName` keeps the last
    /// one, and so does this.
    pub prod_index: usize,
}

/// A chain of producers ending at [`unit`](Self::unit): e.g. for meat,
/// `nest > queen > drone > meat` is the path `[nest→queen, queen→drone,
/// drone→meat]`, of degree 3.
#[derive(Clone, Debug, PartialEq)]
pub struct ProducerPath {
    /// This path's id.
    pub id: PathId,
    /// The unit produced at the end.
    pub unit: UnitId,
    /// The links, starting at the first ancestor. Never empty.
    pub links: Vec<PathLink>,
    /// `prefixes[k]` is the path made of the first `k + 1` links, a path of
    /// `links[k].child`; the last entry is this path. The TS engine caches
    /// `prodEach` per prefix (`unit.ts` `prefixNames`), so the product along
    /// a path can be built from its longest cached prefix.
    pub prefixes: Vec<PathId>,
}

impl ProducerPath {
    /// The polynomial degree: the number of links.
    pub fn degree(&self) -> usize {
        self.links.len()
    }

    /// The first ancestor, whose floored count is the path's coefficient.
    pub fn first(&self) -> UnitId {
        self.links[0].parent
    }

    /// The producers from the first ancestor to the unit's direct parent.
    pub fn parents(&self) -> impl Iterator<Item = UnitId> + '_ {
        self.links.iter().map(|l| l.parent)
    }
}

/// Builds every unit's paths, in unit order and, per unit, the TS order:
/// for each producer in `produced_by`, the path `[producer]`, then
/// depth-first the paths through each of the producer's own producers.
/// Fills in `producer_paths` and `max_degree`.
pub(crate) fn build(units: &mut [UnitType]) -> Result<Vec<ProducerPath>, DataError> {
    let mut chains: Vec<(UnitId, Vec<UnitId>)> = Vec::new();
    for unit in units.iter() {
        for &producer in &unit.produced_by {
            walk(units, unit.id, producer, &[], &mut chains)?;
        }
    }

    // chain (parents + unit) -> id, to find each path's prefixes
    let mut by_chain: HashMap<Vec<UnitId>, PathId> = HashMap::new();
    for (i, (unit, parents)) in chains.iter().enumerate() {
        let mut chain = parents.clone();
        chain.push(*unit);
        by_chain.entry(chain).or_insert(PathId::from_index(i));
    }

    let mut paths = Vec::with_capacity(chains.len());
    for (i, (unit, parents)) in chains.into_iter().enumerate() {
        let id = PathId::from_index(i);
        let mut links = Vec::with_capacity(parents.len());
        let mut prefixes = Vec::with_capacity(parents.len());
        for (k, &parent) in parents.iter().enumerate() {
            let child = parents.get(k + 1).copied().unwrap_or(unit);
            let p = &units[parent.index()];
            let Some(prod_index) = p.prod.iter().rposition(|a| a.unit == child) else {
                return invalid(format!(
                    "producer path: {} doesn't produce {}",
                    p.name,
                    units[child.index()].name
                ));
            };
            links.push(PathLink {
                parent,
                child,
                prod: p.prod[prod_index].val,
                prod_index,
            });
            let mut chain = parents[..=k].to_vec();
            chain.push(child);
            prefixes.push(by_chain[&chain]);
        }
        let u = &mut units[unit.index()];
        u.producer_paths.push(id);
        u.max_degree = u.max_degree.max(links.len());
        paths.push(ProducerPath {
            id,
            unit,
            links,
            prefixes,
        });
    }
    Ok(paths)
}

fn walk(
    units: &[UnitType],
    unit: UnitId,
    producer: UnitId,
    tail: &[UnitId],
    out: &mut Vec<(UnitId, Vec<UnitId>)>,
) -> Result<(), DataError> {
    if tail.len() >= units.len() {
        return invalid(format!(
            "producer paths of {}: production cycle through {}",
            units[unit.index()].name,
            units[producer.index()].name
        ));
    }
    let mut path = Vec::with_capacity(tail.len() + 1);
    path.push(producer);
    path.extend_from_slice(tail);
    out.push((unit, path.clone()));
    for &next in &units[producer.index()].produced_by {
        walk(units, unit, next, &path, out)?;
    }
    Ok(())
}
