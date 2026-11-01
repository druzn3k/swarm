// The JSON that crosses the wasm boundary, hand-written from
// rust/crates/engine/src/{view,command,estimate,welcomeback,engine}.rs and
// rust/crates/wasm/src/core.rs. Field names are exactly what serde writes.
//
// Conventions (see rust/crates/engine/src/view.rs module docs):
// - Units, upgrades, achievements, effects, stats and tabs are referred to by
//   their u16 index into the StaticView lists.
// - Big numbers are Num strings (NumString): "0", "123", "0.5", "1.5e300".
//   Use ./num.ts to compare them.
// - Absent fields mean None / empty / false: optional booleans and lists
//   here are omitted by the engine when false or empty.
// - Times are epoch milliseconds; durations are seconds unless named *_ms.

/** A `swarm_num::Num` in its canonical string form (`"1.5e300"`). */
export type NumString = string

/** A u16 index into a StaticView list. */
export type Index = number

/** `[index, amount]` pairs (`Amounts` in view.rs). */
export type Amounts = Array<[Index, NumString]>

// ------------------------------------------------------------------ request

/** Which top-level parts of the View to compute. Missing fields are `true`. */
export interface Sections {
  units: boolean
  upgrades: boolean
  tabs: boolean
  achievements: boolean
  ascension: boolean
  statistics: boolean
}

/** What to put in a View. Every field is optional; `{}` is the default. */
export interface ViewRequest {
  /** Units (indices) whose `detail`, and whose upgrades' `detail`, to compute. */
  focus?: Index[]
  /** Details for every unit and upgrade (expensive). */
  detail_all?: boolean
  /** Restrict `units` (and their upgrades) to these; `null`: all. */
  only_units?: Index[] | null
  sections?: Partial<Sections>
  /** Extra percents (0..=1) for `max_cost_met_at`. */
  percents?: number[]
  /** Extra amounts for upgrades' `sum_costs`. */
  sum_amounts?: NumString[]
  /**
   * swarm-wasm only: list the upgrades of just these units (and the focused
   * ones), while `units` stays complete. Upgrades are most of a view's cost;
   * `only_units` would scope the units too. `buy_all`/`buy_cheapest` still
   * cover every upgrade.
   */
  upgrades_of?: Index[]
}

// ------------------------------------------------------------------ view

/**
 * Seconds until something, `{"reached":true}` / `{"secs":12.5}` /
 * `{"never":true}`. `secs` is `null` where the engine computed NaN (the TS
 * engine's NaN estimates).
 */
export type Estimate = { reached: true } | { secs: number | null } | { never: true }

export interface OfflineReport {
  closed_ms: number
  resumed_ms: number
}

export interface OfflineGain {
  unit: Index
  val: NumString
}

export interface WelcomeBack {
  away_ms: number
  closed_ms: number
  gains: OfflineGain[]
}

export interface View {
  seq: number
  now_ms: number
  started_ms: number
  restarted_ms?: number
  reified_ms: number
  skipped_ms: number
  total_skipped_ms: number
  elapsed_ms: number
  periodic_ms: number
  units?: UnitView[]
  upgrades?: UpgradeView[]
  buy_all?: Index[]
  buy_cheapest?: Index[]
  tabs?: TabView[]
  all_tab?: Index[]
  achievements?: AchievementsView
  ascension?: AscensionView
  statistics?: StatisticsView
  undo?: UndoView
  tutorial_step: number
  /** `[unit, now_ms of its first spawn]`. */
  first_spawn?: Array<[Index, number]>
  offline?: OfflineReport
  welcome_back?: WelcomeBack
  /** Drained: each event is reported by one view only. */
  events?: ViewEvent[]
}

export interface UnitView {
  id: Index
  count: NumString
  velocity: NumString
  visible?: boolean
  suffix: string
  buyable?: boolean
  buy_button_visible?: boolean
  cost_met?: boolean
  /** `Num.MAX` string for units without costs. */
  max_cost_met: NumString
  max_cost_met_quarter: NumString
  /** One per `ViewRequest.percents`. */
  max_cost_met_at?: NumString[]
  twin_mult: NumString
  each_cost?: Amounts
  cap?: NumString
  cap_percent?: NumString
  newly_upgradable?: boolean
  detail?: UnitDetail
}

export interface UnitDetail {
  /** `[stat index, value]`. */
  stats?: Amounts
  each_production?: Amounts
  total_production?: Amounts
  spent: NumString
  max_cost_met_of_velocity?: NumString
  eta?: Estimate
  cap_eta?: Estimate
  effects?: EffectView[]
}

export interface UpgradeView {
  id: Index
  count: NumString
  visible?: boolean
  buyable?: boolean
  upgradable?: boolean
  newly_upgradable?: boolean
  /** -1 hidden, 0 off, n: notify at 1/n. */
  watched: number
  cost_met?: boolean
  max_cost_met: NumString
  max_cost_met_quarter: NumString
  max_cost_met_at?: NumString[]
  cost_met_percent?: NumString
  total_cost?: Amounts
  /** One per `ViewRequest.sum_amounts`. */
  sum_costs?: Amounts[]
  detail?: UpgradeDetail
}

export interface UpgradeDetail {
  eta: UpgradeEta
  effects?: EffectView[]
}

export type UpgradeEta =
  | 'max_affordable'
  | 'unavailable'
  | { wait: { secs: Estimate; unit?: Index } }

export interface RandView {
  spawned?: boolean
  baseqty: NumString
  qty: NumString
}

export interface EffectView {
  id: Index
  output?: NumString
  rand?: RandView
  rand_next?: RandView
  bank?: NumString
  cap?: NumString
  stats?: Amounts
  timer_remaining_ms?: number
}

export interface TabView {
  id: Index
  visible?: boolean
  newly_upgradable?: boolean
  /** Visible units, in display order. */
  units?: Index[]
}

export interface AchievementsView {
  points: number
  percent: number
  earned: number
  list?: AchievementView[]
}

export interface AchievementView {
  earned_at?: number
  unmasked?: boolean
  progress_order: number
  progress_val?: NumString
  progress_max?: NumString
}

export interface AscensionView {
  ascensions: NumString
  energy_spent: NumString
  cost: NumString
  base_cost: NumString
  cost_percent: NumString
  cap_diff: NumString
  eta?: Estimate
  can_ascend?: boolean
  premutagen: NumString
  respec_cost: NumString
  respec_spent: NumString
  can_respec?: boolean
  free_respecs: NumString
  can_respec_free?: boolean
}

export interface StatisticsView {
  clicks: number
  units?: ItemStatistics[]
  upgrades?: ItemStatistics[]
}

export interface ItemStatistics {
  id: Index
  clicks: number
  num: NumString
  twinnum: NumString
  elapsed_first?: number
}

export interface UndoView {
  undoable?: boolean
  secs_since: number
  secs_left: number
  is_redo?: boolean
}

export type ViewEvent =
  | {
      command: {
        name: string
        unit?: Index
        upgrade?: Index
        num?: NumString
        twinnum?: NumString
      }
    }
  | { buy_first: { unit?: Index; upgrade?: Index } }
  | { achieved: Index }
  | { command_failed: string }
  | 'save_requested'

// ------------------------------------------------------------------ static

export interface StaticView {
  units?: StaticUnit[]
  upgrades?: StaticUpgrade[]
  achievements?: StaticAchievement[]
  effects?: StaticEffect[]
  stats?: string[]
  tabs?: StaticTab[]
  all_tab?: Index[]
  achievement_points_possible: number
  undo_limit_secs: number
  welcome_back_min_ms: number
  respec_cost_rate: number
  cheapest_percent: number
}

export interface StaticUnit {
  name: string
  slug?: string
  label?: string
  plural?: string
  verb?: string
  verbone?: string
  verbing?: string
  description?: string
  lol?: string
  tab?: Index
  column?: number
  tier?: number
  unbuyable: boolean
  is_buy_hidden: boolean
  disabled: boolean
  ascend_preserve: boolean
  showparent?: Index
  cost?: Amounts
  prod?: Amounts
  upgrades?: Index[]
  effects?: Index[]
  /** `[unit, val, text]`. */
  warnfirst?: [Index, NumString | null, string | null]
}

export interface StaticUpgrade {
  name: string
  label?: string
  description?: string
  lol?: string
  ability: boolean
  unit: Index
  maxlevel?: NumString
  /** `[unit, val, factor]`. */
  cost?: Array<[Index, NumString, NumString]>
  effects?: Index[]
}

export interface StaticAchievement {
  name: string
  label?: string
  description?: string
  longdesc?: string
  points: number
}

export interface StaticEffect {
  kind: string
  parent_unit?: Index
  parent_upgrade?: Index
  unit?: Index
  unit2?: Index
  upgrade?: Index
  stat?: Index
  val?: NumString
  val2?: NumString
  val3?: NumString
}

export interface StaticTab {
  name: string
  lead: Index
  units?: Index[]
}

// ------------------------------------------------------------------ commands

/** A number (`{num}`) or player input for parse_number (`{input: "50%"}`). */
export type Amount = { num: NumString } | { input: string }

/** Which upgrades `buy_all_upgrades` buys. */
export type UpgradeSet = 'autobuyable' | { explicit: string[] }

/** A player command; units and upgrades by name. */
export type Command =
  | { do: 'buy_unit'; unit: string; amount: Amount; ui?: string | null }
  | { do: 'buy_max_unit'; unit: string; percent: number; ui?: string | null }
  | { do: 'buy_upgrade'; upgrade: string; amount: Amount; ui?: string | null }
  | { do: 'buy_max_upgrade'; upgrade: string; percent: number; ui?: string | null }
  | { do: 'buy_all_upgrades'; percent: number; which: UpgradeSet }
  | { do: 'ascend' }
  | { do: 'respec' }
  | { do: 'respec_free' }
  | { do: 'undo' }
  | { do: 'watch'; upgrade: string; level: number }
  | { do: 'set_option'; key: string; value: unknown }
  | { do: 'ui_event'; name: string; params?: unknown }
  | { do: 'dismiss_welcome_back' }
  | { do: 'reset' }

/** A TS-engine `'command'` event, as the command emitted it. */
export interface CommandEvent {
  /** `buyUnit`, `buyMaxUnit`, `buyUpgrade`, `buyMaxUpgrade`, `buyAllUpgrades`, `ascension` or `respec`. */
  name: string
  unit?: Index
  upgrade?: Index
  unitname: string | null
  upgradename: string | null
  now_ms: number
  elapsed_ms: number
  attempt: NumString | null
  num: NumString | null
  twinnum: NumString | null
  percent: number | null
  ui: string | null
}

/** What a successful command did. */
export interface CommandOutcome {
  commands: CommandEvent[]
  bought?: { num: NumString; twinnum: NumString }
  levels?: NumString
  /** Upgrades `buy_all_upgrades` tried, in order. */
  upgrades?: Index[]
}

// ------------------------------------------------------------------ ui state

/** `GameHandle.uiState()`: what the engine keeps for the UI without reading it. */
export interface UiState {
  /** The options bag (`set_option`). */
  options: Record<string, unknown>
  /** Unknown top-level keys of the save (e.g. an older app's `achievementsShown`). */
  unknown: Record<string, unknown>
}

/** `GameHandle.unitStats(name)`: a unit's stats and production, visible or not. */
export interface UnitStats {
  stats: Amounts
  each_production: Amounts
  total_production: Amounts
}

// ------------------------------------------------------------------ saves

export type SaveFormat = 'v1' | 'v2'

/** What `load` reports besides the game. */
export interface LoadReport {
  format: SaveFormat | 'new'
  warnings: string[]
  offline: OfflineReport | null
}
