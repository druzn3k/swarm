// A thin read-only facade over the engine's View (one per tick) and
// StaticView (names, texts, costs: once), so components read units and
// upgrades by name instead of index-juggling the JSON. Everything here is
// plain data from @swarmsim/engine-wasm: numbers are Num strings
// (`NumString`), compared and combined with `Dec`; nothing calls into wasm.
//
//   const g = store.g;                    // the latest GameView
//   g.unit("drone").count                 // "1234"
//   g.unit("drone").upgrades("upgrade")   // visible upgrades, display order
//   g.tab("meat").units                   // visible units, display order
//
// Heavy fields (production, stats, effect outputs, estimates) are only in the
// view for units a mounted component focuses on (store.need / useNeeds); they
// read as undefined otherwise.
import { Dec } from "@swarmsim/engine-wasm";
import type {
  AchievementView,
  EffectView,
  Estimate,
  NumString,
  StaticAchievement,
  StaticEffect,
  StaticTab,
  StaticUnit,
  StaticUpgrade,
  StaticView,
  TabView,
  UnitView,
  UpgradeEta,
  UpgradeView,
  UnitStats,
  View,
} from "@swarmsim/engine-wasm";

const ZERO: NumString = "0";

/** Index lookups over the StaticView, built once. */
export class Statics {
  readonly units: StaticUnit[];
  readonly upgrades: StaticUpgrade[];
  readonly achievements: StaticAchievement[];
  readonly effects: StaticEffect[];
  readonly stats: string[];
  readonly tabs: StaticTab[];
  readonly allTab: number[];
  private readonly unitIdx = new Map<string, number>();
  private readonly slugIdx = new Map<string, number>();
  private readonly upgradeIdx = new Map<string, number>();
  private readonly achievementIdx = new Map<string, number>();
  private readonly tabIdx = new Map<string, number>();
  private readonly statIdx = new Map<string, number>();
  /** upgrades listed with each unit (its own and its showparent's), by class, in data order */
  private readonly byUnit: { upgrade: number[]; ability: number[] }[];
  /**
   * Each achievement's required count (`$REQUIRED` in its description), read
   * from the first view with achievements; it never changes.
   */
  readonly achievementRequired: (NumString | undefined)[] = [];

  constructor(readonly sv: StaticView) {
    this.units = sv.units ?? [];
    this.upgrades = sv.upgrades ?? [];
    this.achievements = sv.achievements ?? [];
    this.effects = sv.effects ?? [];
    this.stats = sv.stats ?? [];
    this.tabs = sv.tabs ?? [];
    this.allTab = sv.all_tab ?? [];
    this.units.forEach((u, i) => {
      this.unitIdx.set(u.name, i);
      if (u.slug) this.slugIdx.set(u.slug, i);
    });
    this.upgrades.forEach((u, i) => this.upgradeIdx.set(u.name, i));
    this.achievements.forEach((a, i) => this.achievementIdx.set(a.name, i));
    this.tabs.forEach((t, i) => this.tabIdx.set(t.name, i));
    this.stats.forEach((s, i) => this.statIdx.set(s, i));
    this.byUnit = this.units.map((u) => {
      const ids = u.upgrades ?? [];
      return { upgrade: ids.filter((i) => !this.upgrades[i].ability), ability: ids.filter((i) => this.upgrades[i].ability) };
    });
  }

  unitIndex(name: string): number | undefined {
    return this.unitIdx.get(name);
  }
  /** by name ("greaterqueen") or the old game's url slug ("greater queen") */
  findUnitIndex(key: string): number | undefined {
    return this.unitIdx.get(key) ?? this.slugIdx.get(key);
  }
  upgradeIndex(name: string): number | undefined {
    return this.upgradeIdx.get(name);
  }
  achievementIndex(name: string): number | undefined {
    return this.achievementIdx.get(name);
  }
  tabIndex(name: string): number | undefined {
    return this.tabIdx.get(name);
  }
  statIndex(name: string): number | undefined {
    return this.statIdx.get(name);
  }
  upgradesOf(unit: number, klass: "upgrade" | "ability"): number[] {
    return this.byUnit[unit]?.[klass] ?? [];
  }
  /** The unit an upgrade is listed with. */
  upgradeUnit(upgrade: string): number | undefined {
    const i = this.upgradeIdx.get(upgrade);
    return i === undefined ? undefined : this.upgrades[i].unit;
  }

  /** Remembers what the view says about achievements that never changes. */
  learn(view: View): void {
    view.achievements?.list?.forEach((a, i) => {
      if (a.progress_max !== undefined) this.achievementRequired[i] = a.progress_max;
    });
  }
}

/** A cost or production line: a unit and an amount. */
export interface Amount {
  unit: UnitRef;
  val: NumString;
}

/** An effect: its parameters and, for focused units, its live values. */
export interface EffectRef {
  st: StaticEffect;
  v?: EffectView;
  /** the effect's target unit, if any */
  unit?: UnitRef;
}

export class UnitRef {
  readonly st: StaticUnit;
  readonly v: UnitView | undefined;
  constructor(
    readonly g: GameView,
    readonly id: number
  ) {
    this.st = g.s.units[id];
    this.v = g.unitView(id);
  }
  get name(): string {
    return this.st.name;
  }
  get label(): string {
    return this.st.label ?? this.st.name;
  }
  get plural(): string {
    return this.st.plural ?? this.label;
  }
  get verb(): string {
    return this.st.verb ?? "buy";
  }
  /** the unit's tab name (undefined for units in no tab) */
  get tabName(): string | undefined {
    return this.st.tab === undefined ? undefined : this.g.s.tabs[this.st.tab]?.name;
  }
  get tab(): TabRef | undefined {
    const name = this.tabName;
    return name === undefined ? undefined : this.g.tab(name);
  }
  get count(): NumString {
    return this.v?.count ?? ZERO;
  }
  get velocity(): NumString {
    return this.v?.velocity ?? ZERO;
  }
  get visible(): boolean {
    return !!this.v?.visible;
  }
  get suffix(): string {
    return this.v?.suffix ?? "";
  }
  /** visible and affordable now */
  get buyable(): boolean {
    return !!this.v?.buyable;
  }
  get buyButtonVisible(): boolean {
    return !!this.v?.buy_button_visible;
  }
  get costMet(): boolean {
    return !!this.v?.cost_met;
  }
  /** affordable purchases (Num.MAX without costs); times twinMult for units received */
  get maxCostMet(): NumString {
    return this.v?.max_cost_met ?? ZERO;
  }
  get maxCostMetQuarter(): NumString {
    return this.v?.max_cost_met_quarter ?? ZERO;
  }
  get twinMult(): NumString {
    return this.v?.twin_mult ?? "1";
  }
  get eachCost(): Amount[] {
    return (this.v?.each_cost ?? []).map(([u, val]) => ({ unit: this.g.unit(u), val }));
  }
  get hasCost(): boolean {
    return (this.st.cost?.length ?? 0) > 0;
  }
  get hasProd(): boolean {
    return (this.st.prod?.length ?? 0) > 0;
  }
  get cap(): NumString | undefined {
    return this.v?.cap;
  }
  get capPercent(): NumString | undefined {
    return this.v?.cap_percent;
  }
  get newlyUpgradable(): boolean {
    return !!this.v?.newly_upgradable;
  }
  get showparent(): UnitRef | undefined {
    return this.st.showparent === undefined ? undefined : this.g.unit(this.st.showparent);
  }
  /** detail: only for focused units */
  get detailed(): boolean {
    return !!this.v?.detail;
  }
  /** stats and production: the view's detail (focused units), or what was read for a hidden unit (Need.hidden) */
  private get numbers(): Partial<UnitStats> | undefined {
    return this.v?.detail ?? this.g.hidden.get(this.id);
  }
  /** production of one, per second, by unit name (focused units) */
  get eachProduction(): Record<string, NumString> {
    return this.byName(this.numbers?.each_production);
  }
  /** production of all of them, per second, by unit name (focused units) */
  get totalProduction(): Record<string, NumString> {
    return this.byName(this.numbers?.total_production);
  }
  get maxCostMetOfVelocity(): NumString | undefined {
    return this.v?.detail?.max_cost_met_of_velocity;
  }
  get capEta(): Estimate | undefined {
    return this.v?.detail?.cap_eta;
  }
  /** a stat's value, if set (focused units) */
  stat(name: string): NumString | undefined {
    const i = this.g.s.statIndex(name);
    if (i === undefined) return undefined;
    return this.numbers?.stats?.find(([s]) => s === i)?.[1];
  }
  hasStat(name: string): boolean {
    return this.stat(name) !== undefined;
  }
  /** its own effects, in static order (live values for focused units) */
  get effects(): EffectRef[] {
    const views = this.v?.detail?.effects ?? [];
    return (this.st.effects ?? []).map((id) => this.g.effect(id, views));
  }
  /** visible upgrades or abilities listed with it, in data order */
  upgrades(klass: "upgrade" | "ability" = "upgrade"): UpgradeRef[] {
    return this.g.s
      .upgradesOf(this.id, klass)
      .map((i) => this.g.upgrade(i))
      .filter((u) => u.visible);
  }
  private byName(list: [number, NumString][] | undefined): Record<string, NumString> {
    const out: Record<string, NumString> = {};
    for (const [u, val] of list ?? []) out[this.g.s.units[u].name] = val;
    return out;
  }
}

export class UpgradeRef {
  readonly st: StaticUpgrade;
  readonly v: UpgradeView | undefined;
  constructor(
    readonly g: GameView,
    readonly id: number
  ) {
    this.st = g.s.upgrades[id];
    this.v = g.upgradeView(id);
  }
  get name(): string {
    return this.st.name;
  }
  get label(): string {
    return this.st.label ?? this.st.name;
  }
  get ability(): boolean {
    return this.st.ability;
  }
  get maxlevel(): NumString | undefined {
    return this.st.maxlevel;
  }
  get unit(): UnitRef {
    return this.g.unit(this.st.unit);
  }
  get count(): NumString {
    return this.v?.count ?? ZERO;
  }
  get visible(): boolean {
    return !!this.v?.visible;
  }
  get costMet(): boolean {
    return !!this.v?.cost_met;
  }
  get maxCostMet(): NumString {
    return this.v?.max_cost_met ?? ZERO;
  }
  get maxCostMetQuarter(): NumString {
    return this.v?.max_cost_met_quarter ?? ZERO;
  }
  /** progress to the next level, 0..1 (0 where the old engine gave NaN) */
  get costMetPercent(): NumString {
    return this.v?.cost_met_percent ?? ZERO;
  }
  get totalCost(): Amount[] {
    return (this.v?.total_cost ?? []).map(([u, val]) => ({ unit: this.g.unit(u), val }));
  }
  /** -1 hidden, 0 off, n: notify at 1/n of the cost */
  get watched(): number {
    return this.v?.watched ?? 1;
  }
  get manuallyHidden(): boolean {
    return this.watched < 0;
  }
  get newlyUpgradable(): boolean {
    return !!this.v?.newly_upgradable;
  }
  /** when the next level is affordable (focused units' upgrades) */
  get eta(): UpgradeEta | undefined {
    return this.v?.detail?.eta;
  }
  /** its effects in static order (live values for focused units' upgrades) */
  get effects(): EffectRef[] {
    const views = this.v?.detail?.effects ?? [];
    return (this.st.effects ?? []).map((id) => this.g.effect(id, views));
  }
  /** Can the player pay for the next level? (cost met and below the max level) */
  canBuyOne(): boolean {
    const max = this.st.maxlevel;
    if (max != null && Dec.from(this.count).gte(max)) return false;
    return this.costMet;
  }
}

export class TabRef {
  readonly v: TabView | undefined;
  constructor(
    readonly g: GameView,
    readonly name: string,
    readonly st: StaticTab | undefined
  ) {
    const i = st ? g.s.tabIndex(name) : undefined;
    this.v = i === undefined ? undefined : g.v.tabs?.find((t) => t.id === i);
  }
  /** the lead unit; the hidden "all" tab's is the first unit in a tab */
  get lead(): UnitRef {
    return this.g.unit(this.st ? this.st.lead : this.g.s.tabs[0].lead);
  }
  get visible(): boolean {
    return this.st ? !!this.v?.visible : this.lead.visible;
  }
  get newlyUpgradable(): boolean {
    if (this.st) return !!this.v?.newly_upgradable;
    return this.units.some((u) => u.newlyUpgradable);
  }
  /**
   * Visible units in the old game's display order (`sortUnits`): the most
   * advanced at the top. "All units" keeps the spreadsheet order.
   */
  get units(): UnitRef[] {
    const ids = this.st ? (this.v?.units ?? []) : (this.g.v.all_tab ?? []);
    return ids.map((i) => this.g.unit(i));
  }
  /** Is the unit listed on this tab (visible or not)? */
  has(unit: string): boolean {
    const i = this.g.s.unitIndex(unit);
    if (i === undefined) return false;
    return this.st ? (this.st.units ?? []).includes(i) : this.g.s.allTab.includes(i);
  }
  get title(): string {
    return this.st ? this.lead.plural : "All units";
  }
}

export class AchievementRef {
  readonly st: StaticAchievement;
  readonly v: AchievementView | undefined;
  constructor(
    readonly g: GameView,
    readonly id: number
  ) {
    this.st = g.s.achievements[id];
    this.v = g.v.achievements?.list?.[id];
  }
  get name(): string {
    return this.st.name;
  }
  get label(): string {
    return this.st.label ?? this.st.name;
  }
  get points(): number {
    return this.st.points;
  }
  get earned(): boolean {
    return this.v?.earned_at !== undefined;
  }
  /** ms after the game started that it was earned */
  get earnedAt(): number | undefined {
    return this.v?.earned_at;
  }
  get unmasked(): boolean {
    return !!this.v?.unmasked;
  }
  get progressOrder(): number {
    return this.v?.progress_order ?? -1;
  }
  get progressVal(): NumString | undefined {
    return this.v?.progress_val;
  }
  get progressMax(): NumString | undefined {
    return this.v?.progress_max;
  }
  /** the description, with `$REQUIRED` filled in by `format` */
  description(format: (n: NumString) => string): string {
    const desc = this.st.description ?? "";
    const req = this.v?.progress_max ?? this.g.s.achievementRequired[this.id];
    return req === undefined ? desc : desc.replace("$REQUIRED", format(req));
  }
}

/** One tick's view of the game. */
export class GameView {
  private readonly unitViews: (UnitView | undefined)[] = [];
  private readonly upgradeViews: (UpgradeView | undefined)[] = [];
  private readonly unitRefs: UnitRef[] = [];
  private readonly upgradeRefs: UpgradeRef[] = [];
  private readonly tabRefs = new Map<string, TabRef>();

  constructor(
    readonly s: Statics,
    readonly v: View,
    /** stats and production of hidden units, by index (Need.hidden) */
    readonly hidden: ReadonlyMap<number, UnitStats> = new Map()
  ) {
    for (const u of v.units ?? []) this.unitViews[u.id] = u;
    for (const u of v.upgrades ?? []) this.upgradeViews[u.id] = u;
  }

  unitView(id: number): UnitView | undefined {
    return this.unitViews[id];
  }
  upgradeView(id: number): UpgradeView | undefined {
    return this.upgradeViews[id];
  }

  /** A unit by name or index. Throws on unknown names (a typo in the app). */
  unit(key: string | number): UnitRef {
    const id = typeof key === "number" ? key : this.s.unitIndex(key);
    if (id === undefined || !this.s.units[id]) throw new Error(`no such unit: ${key}`);
    return (this.unitRefs[id] ??= new UnitRef(this, id));
  }
  /** A unit by name or old url slug, or undefined. */
  findUnit(key: string): UnitRef | undefined {
    const id = this.s.findUnitIndex(key);
    return id === undefined ? undefined : this.unit(id);
  }
  upgrade(key: string | number): UpgradeRef {
    const id = typeof key === "number" ? key : this.s.upgradeIndex(key);
    if (id === undefined || !this.s.upgrades[id]) throw new Error(`no such upgrade: ${key}`);
    return (this.upgradeRefs[id] ??= new UpgradeRef(this, id));
  }
  achievement(key: string | number): AchievementRef {
    const id = typeof key === "number" ? key : this.s.achievementIndex(key);
    if (id === undefined || !this.s.achievements[id]) throw new Error(`no such achievement: ${key}`);
    return new AchievementRef(this, id);
  }
  /** A tab by name, including the hidden "all" tab; undefined for unknown names. */
  tab(name: string): TabRef | undefined {
    let t = this.tabRefs.get(name);
    if (!t) {
      const i = this.s.tabIndex(name);
      if (i === undefined && name !== "all") return undefined;
      t = new TabRef(this, name, i === undefined ? undefined : this.s.tabs[i]);
      this.tabRefs.set(name, t);
    }
    return t;
  }
  /** every unit, in data order */
  units(): UnitRef[] {
    return this.s.units.map((_, i) => this.unit(i));
  }
  upgrades(): UpgradeRef[] {
    return this.s.upgrades.map((_, i) => this.upgrade(i));
  }
  achievements(): AchievementRef[] {
    return this.s.achievements.map((_, i) => this.achievement(i));
  }
  effect(id: number, views: EffectView[] = []): EffectRef {
    const st = this.s.effects[id];
    return { st, v: views.find((e) => e.id === id), unit: st?.unit === undefined ? undefined : this.unit(st.unit) };
  }
  /** game time, epoch ms */
  get nowMs(): number {
    return this.v.now_ms;
  }
  get startedMs(): number {
    return this.v.started_ms;
  }
}

/** Seconds of an Estimate; undefined when reached, never or unknown. */
export function estimateSecs(e: Estimate | undefined): number | undefined {
  if (!e || !("secs" in e) || e.secs == null) return undefined;
  return e.secs;
}
