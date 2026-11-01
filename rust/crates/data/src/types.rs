//! The resolved records of [`GameData`](crate::GameData): names replaced by
//! typed ids, game values as [`Num`], defaults applied.

use swarm_num::Num;

use crate::ids::{EffectId, PathId, StatId, TabId, UnitId, UpgradeId};
pub use crate::schema::{AchievementText, UnitText, UpgradeText};

/// A reference to a unit or an upgrade, the two things requirements count.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Resource {
    /// A unit's count.
    Unit(UnitId),
    /// An upgrade's level.
    Upgrade(UpgradeId),
}

/// An amount of a unit: a cost, a production, an upgrade requirement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UnitAmount {
    /// The unit.
    pub unit: UnitId,
    /// How many.
    pub val: Num,
}

/// How a unit requirement combines with the others (`unit.ts` `_isVisible`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequireOp {
    /// Must hold (unless an earlier OR requirement already held).
    And,
    /// Holding it is enough.
    Or,
}

/// A unit visibility requirement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UnitRequire {
    /// What is counted.
    pub resource: Resource,
    /// The count needed.
    pub val: Num,
    /// `Or` for the tables' `"OR"`; every other value, including none, is
    /// `And`.
    pub op: RequireOp,
}

/// A unit's first-purchase warning.
#[derive(Clone, Debug, PartialEq)]
pub struct WarnFirst {
    /// The unit the warning is about.
    pub unit: UnitId,
    /// The threshold; `None` where the tables have 0 (the TS engine sees
    /// nothing).
    pub val: Option<Num>,
    /// The warning.
    pub text: Option<String>,
}

/// A unit type.
#[derive(Clone, Debug)]
pub struct UnitType {
    /// This unit's id.
    pub id: UnitId,
    /// Unique name.
    pub name: String,
    /// URL slug: the label, as in the TS engine (`unittypes.ts`).
    pub slug: Option<String>,
    /// Display text.
    pub text: UnitText,
    /// The tab name from the tables.
    pub tab_name: Option<String>,
    /// The tab of that name, if one exists: what the TS `Unit.tab` holds.
    /// Disabled units can name a tab without being listed in it.
    pub tab: Option<TabId>,
    /// UI column.
    pub column: Option<u32>,
    /// UI tier.
    pub tier: Option<u32>,
    /// Count at a new game and after ascending.
    pub init: Num,
    /// Kept when ascending.
    pub ascend_preserve: bool,
    /// Hidden and not in any tab.
    pub disabled: bool,
    /// Can't be bought.
    pub unbuyable: bool,
    /// Buy buttons hidden.
    pub is_buy_hidden: bool,
    /// The unit whose upgrades this one also lists.
    pub showparent: Option<UnitId>,
    /// First-purchase warning.
    pub warnfirst: Option<WarnFirst>,
    /// Cost of one, in table order.
    pub cost: Vec<UnitAmount>,
    /// Production of one per second, in table order. Each `val` is positive.
    pub prod: Vec<UnitAmount>,
    /// Visibility requirements, in order (the order matters for OR).
    pub requires: Vec<UnitRequire>,
    /// This unit's own effects, in table order.
    pub effects: Vec<EffectId>,
    /// Units that produce this one: each unit with a `prod` entry for it,
    /// once per entry, in unit order (TS `producedBy`).
    pub produced_by: Vec<UnitId>,
    /// Every path along which this unit is produced, in the TS engine's
    /// order (`unittypes.ts` `_buildProducerPath`); see
    /// [`ProducerPath`](crate::ProducerPath).
    pub producer_paths: Vec<PathId>,
    /// The highest producer path degree (0 with no producers).
    pub max_degree: usize,
    /// Upgrades listed with this unit: those whose unit is this one or its
    /// `showparent`, in upgrade order (`unit.ts` `Unit.upgrades`).
    pub upgrades: Vec<UpgradeId>,
    /// Unit effects that target this unit (TS `affectedBy`), in unit order
    /// then effect order.
    pub affected_by: Vec<EffectId>,
    /// The effects `Unit.stats()` folds, in its order: each effect of each
    /// of [`upgrades`](Self::upgrades), then [`affected_by`](Self::affected_by).
    /// Only effects whose kind has [`EffectKind::has_calc_stats`]. **The order
    /// matters for rounding.**
    pub stat_effects: Vec<EffectId>,
    /// The stat `cost.<name>`, which scales this unit's costs.
    pub cost_stat: StatId,
}

/// `"upgrade"` or `"ability"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpgradeClass {
    /// A permanent upgrade.
    Upgrade,
    /// A repeatable ability (larva rush, swarmwarp, ...).
    Ability,
}

/// One cost of an upgrade: `val * factor^level` (before stats).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UpgradeCost {
    /// The unit paid.
    pub unit: UnitId,
    /// Cost of level 1. Positive.
    pub val: Num,
    /// Growth per level. Positive. 1 where the tables have none and
    /// `maxlevel` is 1 (`upgradetypes.ts`).
    pub factor: Num,
}

/// An upgrade or ability.
#[derive(Clone, Debug)]
pub struct UpgradeType {
    /// This upgrade's id.
    pub id: UpgradeId,
    /// Unique name.
    pub name: String,
    /// Display text.
    pub text: UpgradeText,
    /// Upgrade or ability.
    pub class: UpgradeClass,
    /// The unit it belongs to.
    pub unit: UnitId,
    /// Maximum level, if any.
    pub maxlevel: Option<Num>,
    /// Costs, in table order.
    pub cost: Vec<UpgradeCost>,
    /// Visibility requirements (all must hold).
    pub requires: Vec<UnitAmount>,
    /// Effects, in table order.
    pub effects: Vec<EffectId>,
    /// The stat `power.<name>` (`effect.ts` `power()`).
    pub power_stat: StatId,
    /// The stat `upgradecostmult.<name>` (`upgrade.ts` `totalCost`).
    pub upgradecostmult_stat: StatId,
    /// The stat `random.minlevel.<name>` (`effecttypes.ts` addUnitRand).
    pub random_minlevel_stat: StatId,
}

/// The effect types, `effecttypes.ts`'s registry.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EffectKind {
    /// `addUnit`
    AddUnit,
    /// `addUnitByVelocity`
    AddUnitByVelocity,
    /// `addUnitTimed`
    AddUnitTimed,
    /// `addUnitRand`
    AddUnitRand,
    /// `compoundUnit`
    CompoundUnit,
    /// `addUpgrade`
    AddUpgrade,
    /// `skipTime`
    SkipTime,
    /// `multStat`
    MultStat,
    /// `expStat`
    ExpStat,
    /// `asympStat`
    AsympStat,
    /// `logStat`
    LogStat,
    /// `addStat`
    AddStat,
    /// `initStat`
    InitStat,
    /// `multStatPerAchievementPoint`
    MultStatPerAchievementPoint,
    /// `suffix`: sets the unit's roman-numeral suffix and adds its level to
    /// the `empower` stat (it has no `stat` of its own).
    Suffix,
}

/// How a stat effect combines into a stat (`effecttypes.ts`
/// `validateSchema`). A unit's stats must not mix the two for one stat.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatOp {
    /// Multiplies (multStat, expStat, asympStat, logStat, initStat,
    /// multStatPerAchievementPoint).
    Mult,
    /// Adds (addStat).
    Add,
}

impl EffectKind {
    /// Every kind, in `effecttypes.ts` registration order.
    pub const ALL: [EffectKind; 15] = [
        EffectKind::AddUnit,
        EffectKind::AddUnitByVelocity,
        EffectKind::AddUnitTimed,
        EffectKind::AddUnitRand,
        EffectKind::CompoundUnit,
        EffectKind::AddUpgrade,
        EffectKind::SkipTime,
        EffectKind::MultStat,
        EffectKind::ExpStat,
        EffectKind::AsympStat,
        EffectKind::LogStat,
        EffectKind::AddStat,
        EffectKind::InitStat,
        EffectKind::MultStatPerAchievementPoint,
        EffectKind::Suffix,
    ];

    /// The name the tables use.
    pub const fn name(self) -> &'static str {
        match self {
            EffectKind::AddUnit => "addUnit",
            EffectKind::AddUnitByVelocity => "addUnitByVelocity",
            EffectKind::AddUnitTimed => "addUnitTimed",
            EffectKind::AddUnitRand => "addUnitRand",
            EffectKind::CompoundUnit => "compoundUnit",
            EffectKind::AddUpgrade => "addUpgrade",
            EffectKind::SkipTime => "skipTime",
            EffectKind::MultStat => "multStat",
            EffectKind::ExpStat => "expStat",
            EffectKind::AsympStat => "asympStat",
            EffectKind::LogStat => "logStat",
            EffectKind::AddStat => "addStat",
            EffectKind::InitStat => "initStat",
            EffectKind::MultStatPerAchievementPoint => "multStatPerAchievementPoint",
            EffectKind::Suffix => "suffix",
        }
    }

    /// The kind with this table name.
    pub fn from_name(name: &str) -> Option<EffectKind> {
        EffectKind::ALL.into_iter().find(|k| k.name() == name)
    }

    /// The stat operation, for the kinds that write a stat.
    pub const fn stat_op(self) -> Option<StatOp> {
        match self {
            EffectKind::MultStat
            | EffectKind::ExpStat
            | EffectKind::AsympStat
            | EffectKind::LogStat
            | EffectKind::InitStat
            | EffectKind::MultStatPerAchievementPoint => Some(StatOp::Mult),
            EffectKind::AddStat => Some(StatOp::Add),
            _ => None,
        }
    }

    /// Whether the TS type defines `calcStats`, i.e. takes part in
    /// `Unit.stats()`: the stat kinds, plus `suffix`, which sets the unit's
    /// suffix as a side effect.
    pub const fn has_calc_stats(self) -> bool {
        self.stat_op().is_some() || matches!(self, EffectKind::Suffix)
    }
}

/// What an effect belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EffectParent {
    /// A unit's effect; its level is the unit's count.
    Unit(UnitId),
    /// An upgrade's effect; its level is the upgrade's level.
    Upgrade(UpgradeId),
}

/// An effect of a unit or an upgrade (`effect.ts` `Effect`).
///
/// `val`, `val2` and `val3` are `None` where the tables have none, which
/// differs from 0: for `compoundUnit` a missing `val2` means "uncapped", and
/// `logStat` uses `val3 ?? 1`.
#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    /// This effect's id.
    pub id: EffectId,
    /// The unit or upgrade it belongs to.
    pub parent: EffectParent,
    /// Position among the parent's effects.
    pub index: usize,
    /// The type.
    pub kind: EffectKind,
    /// Target unit (always set for unit effects).
    pub unit: Option<UnitId>,
    /// Second unit.
    pub unit2: Option<UnitId>,
    /// Target upgrade (`addUpgrade`).
    pub upgrade: Option<UpgradeId>,
    /// The stat written; set for every kind with a [`StatOp`].
    pub stat: Option<StatId>,
    /// First parameter.
    pub val: Option<Num>,
    /// Second parameter.
    pub val2: Option<Num>,
    /// Third parameter (unit effects only).
    pub val3: Option<Num>,
}

/// An achievement requirement.
#[derive(Clone, Debug, PartialEq)]
pub enum AchievementRequire {
    /// A count of a unit or upgrade. Unit achievements compare the unit's
    /// `twinnum` statistic, not its count (`achievement.ts`).
    Count {
        /// What is counted.
        resource: Resource,
        /// The count needed.
        val: Num,
    },
    /// An engine or UI event whose params include `params`.
    Event {
        /// Event name (`achieveclick`, `konami`, `import`, ...).
        event: String,
        /// Parameters that must be present and equal; `None` for none.
        params: Option<serde_json::Map<String, serde_json::Value>>,
    },
}

/// An achievement.
#[derive(Clone, Debug)]
pub struct AchievementType {
    /// This achievement's id.
    pub id: crate::AchievementId,
    /// Unique name.
    pub name: String,
    /// Display text.
    pub text: AchievementText,
    /// Points.
    pub points: u32,
    /// What earns it.
    pub requires: Vec<AchievementRequire>,
    /// What unmasks it (count of a unit or upgrade).
    pub visible: Vec<(Resource, Num)>,
}

/// A crystal pack. Unused by the engine.
#[derive(Clone, Debug)]
pub struct Mtx {
    /// This pack's id.
    pub id: crate::MtxId,
    /// Unique name.
    pub name: String,
    /// Name shown.
    pub label: Option<String>,
    /// Description.
    pub description: Option<String>,
    /// Price in Kongregate kreds.
    pub price_kreds: Option<f64>,
    /// Price in US cents via PayPal.
    pub price_usd_paypal: Option<f64>,
    /// Uses.
    pub uses: Option<f64>,
    /// The unit the pack gives.
    pub pack_unit: UnitId,
    /// How many.
    pub pack_val: Option<Num>,
    /// Bulk bonus multiplier.
    pub bulkbonus: Option<f64>,
}
