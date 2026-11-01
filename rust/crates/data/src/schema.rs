//! The serde schema of `data/gamedata.json`, field for field.
//!
//! The JSON is written by `tables/src/json/gen-json.ts` (see `rust/PLAN.md`
//! section 2) and holds exactly what the TypeScript engine sees after its
//! spreadsheet round trip:
//!
//! * arrays keep the tables' order, which is significant;
//! * optional values are `null`, never `""`;
//! * numbers are plain JSON numbers (`f64`); [`GameData`](crate::GameData) turns game
//!   values into [`swarm_num::Num`].
//!
//! Every struct denies unknown fields, so a generator change that this crate
//! doesn't know about fails loudly instead of being ignored.
//! `engine/test/gamedata-json.test.ts` checks the JSON against the TS engine.

use serde::Deserialize;

/// The whole file.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameDataJson {
    /// Version of this shape; see [`crate::SCHEMA_VERSION`].
    pub schema: u32,
    /// Units, in spreadsheet order.
    pub unittypes: Vec<UnittypeJson>,
    /// Upgrades and abilities, in spreadsheet order.
    pub upgrades: Vec<UpgradeJson>,
    /// Achievements, in spreadsheet order.
    pub achievements: Vec<AchievementJson>,
    /// Crystal packs. Unused by the engine; kept for completeness.
    pub mtx: Vec<MtxJson>,
}

/// A unit type (`engine/src/unittypes.ts` `UnitType`).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UnittypeJson {
    /// Unique name, used in saves and as the reference key everywhere.
    pub name: String,
    /// URL slug; the TS engine sets it to the label.
    pub slug: Option<String>,
    /// Display text.
    pub text: UnitText,
    /// Name of the tab the unit is listed in.
    pub tab: Option<String>,
    /// UI column.
    pub column: Option<f64>,
    /// UI tier.
    pub tier: Option<f64>,
    /// Count at a new game and after ascending (the round trip can't tell
    /// 0 from absent, and the engine reads `init || 0`).
    pub init: f64,
    /// Kept when ascending.
    pub ascend_preserve: bool,
    /// Never shown, not in any tab.
    pub disabled: bool,
    /// Can't be bought.
    pub unbuyable: bool,
    /// The buy buttons are hidden.
    pub is_buy_hidden: bool,
    /// Unit whose upgrades this unit also lists.
    pub showparent: Option<String>,
    /// Warning shown before buying the first one.
    pub warnfirst: Option<WarnFirstJson>,
    /// Cost of one unit.
    pub cost: Vec<UnitAmountJson>,
    /// What one unit produces per second.
    pub prod: Vec<UnitAmountJson>,
    /// Visibility requirements.
    pub requires: Vec<UnitRequireJson>,
    /// Effects of owning this unit.
    pub effect: Vec<UnitEffectJson>,
}

/// A unit's display text. Each is `null` when the tables leave it empty.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UnitText {
    /// Singular name.
    pub label: Option<String>,
    /// Plural name.
    pub plural: Option<String>,
    /// Buy verb ("hatch").
    pub verb: Option<String>,
    /// Third person ("hatches").
    pub verbone: Option<String>,
    /// Gerund ("hatching").
    pub verbing: Option<String>,
    /// Description.
    pub description: Option<String>,
    /// Flavour text.
    pub lol: Option<String>,
}

/// `{unittype, val}`: an amount of a unit. `val` is `null` where the tables
/// encode 0 as empty (the engine sees it as absent).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitAmountJson {
    /// Unit name.
    pub unittype: String,
    /// Amount.
    pub val: Option<f64>,
}

/// A unit's first-purchase warning.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WarnFirstJson {
    /// Unit the warning is about.
    pub unittype: String,
    /// Threshold; `null` when 0.
    pub val: Option<f64>,
    /// Warning text.
    pub text: Option<String>,
}

/// A unit visibility requirement: exactly one of `unittype`/`upgradetype`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitRequireJson {
    /// Required unit.
    #[serde(default)]
    pub unittype: Option<String>,
    /// Required upgrade.
    #[serde(default)]
    pub upgradetype: Option<String>,
    /// Required count (0 is meaningful).
    pub val: f64,
    /// `"OR"`, or anything else (`null`, or the tables' `"always false, hack
    /// to make OR work"`) for AND. See `unit.ts` `_isVisible`.
    pub op: Option<String>,
}

/// An effect of owning a unit.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitEffectJson {
    /// Effect type name (`multStat`, `addUnit`, ...).
    #[serde(rename = "type")]
    pub kind: String,
    /// Target unit.
    pub unittype: String,
    /// Second unit, for some types.
    pub unittype2: Option<String>,
    /// Stat name, for stat effects.
    pub stat: Option<String>,
    /// First parameter.
    pub val: f64,
    /// Second parameter; `null` (absent) differs from 0.
    pub val2: Option<f64>,
    /// Third parameter; `null` (absent) differs from 0.
    pub val3: Option<f64>,
}

/// An upgrade or ability (`engine/src/upgradetypes.ts` `UpgradeType`).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeJson {
    /// Unique name.
    pub name: String,
    /// Display text.
    pub text: UpgradeText,
    /// `"upgrade"` or `"ability"`.
    pub class: String,
    /// The unit it belongs to.
    pub unittype: String,
    /// Maximum level; `null` for none.
    pub maxlevel: Option<f64>,
    /// Cost of the next level.
    pub cost: Vec<UpgradeCostJson>,
    /// Visibility requirements.
    pub requires: Vec<UpgradeRequireJson>,
    /// Effects per level.
    pub effect: Vec<UpgradeEffectJson>,
}

/// An upgrade's display text.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpgradeText {
    /// Name.
    pub label: Option<String>,
    /// Description.
    pub description: Option<String>,
    /// Flavour text.
    pub lol: Option<String>,
}

/// One cost of an upgrade: `val * factor^level`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeCostJson {
    /// Unit paid.
    pub unittype: String,
    /// Base cost.
    pub val: f64,
    /// Growth factor per level; `null` when absent (the engine then uses 1
    /// if `maxlevel` is 1).
    pub factor: Option<f64>,
}

/// An upgrade visibility requirement.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeRequireJson {
    /// Required unit.
    pub unittype: String,
    /// Required count.
    pub val: f64,
}

/// An effect of an upgrade level.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeEffectJson {
    /// Effect type name.
    #[serde(rename = "type")]
    pub kind: String,
    /// Target unit, if any.
    pub unittype: Option<String>,
    /// Target upgrade, if any (`addUpgrade`).
    pub upgradetype: Option<String>,
    /// Second unit, for some types.
    pub unittype2: Option<String>,
    /// Stat name, for stat effects.
    pub stat: Option<String>,
    /// First parameter; `null` (absent) differs from 0.
    pub val: Option<f64>,
    /// Second parameter; `null` (absent) differs from 0.
    pub val2: Option<f64>,
}

/// An achievement.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AchievementJson {
    /// Unique name.
    pub name: String,
    /// Display text.
    pub text: AchievementText,
    /// Achievement points.
    pub points: f64,
    /// What earns it.
    pub requires: Vec<AchievementRequireJson>,
    /// What makes it visible (unmasked).
    pub visible: Vec<AchievementVisibleJson>,
}

/// An achievement's display text.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AchievementText {
    /// Name.
    pub label: Option<String>,
    /// Description; may contain `$REQUIRED`.
    pub description: Option<String>,
    /// Longer description.
    pub longdesc: Option<String>,
}

/// An achievement requirement, one of three shapes:
/// `{event, params}`, `{unittype, val}` or `{upgradetype, val}`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AchievementRequireJson {
    /// Engine/UI event name.
    #[serde(default)]
    pub event: Option<String>,
    /// Event parameters that must match (parsed from the spreadsheet's JSON
    /// string); `null` for none.
    #[serde(default)]
    pub params: Option<serde_json::Map<String, serde_json::Value>>,
    /// Required unit.
    #[serde(default)]
    pub unittype: Option<String>,
    /// Required upgrade.
    #[serde(default)]
    pub upgradetype: Option<String>,
    /// Required count.
    #[serde(default)]
    pub val: Option<f64>,
}

/// An achievement visibility condition: exactly one of
/// `unittype`/`upgradetype`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AchievementVisibleJson {
    /// Unit.
    #[serde(default)]
    pub unittype: Option<String>,
    /// Upgrade.
    #[serde(default)]
    pub upgradetype: Option<String>,
    /// Required count (0 is meaningful).
    pub val: f64,
}

/// A crystal pack (microtransaction). Unused by the engine.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MtxJson {
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
    /// What the pack gives.
    pub pack: UnitAmountJson,
    /// Bulk bonus multiplier.
    pub bulkbonus: Option<f64>,
}
