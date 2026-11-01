# Rust engine port plan

Goal: one Rust engine behind three frontends: a native ratatui TUI, a headless
CLI, and a WebAssembly build used by the existing React app (`app/`), both as
a plain web page and inside Tauri on Linux. The TypeScript engine
(`engine/src`, about 4.2k lines, decimal.js 7.1.1) stays as the reference until
the Rust engine has been validated against it.

These decisions are fixed and this document builds on them: a Cargo workspace at
`rust/` with crates under `rust/crates/*`; `swarm-num` (`Num { mantissa: f64,
exponent: i64 }`, in progress) for big numbers; game data emitted as JSON by
`tables` and embedded at compile time; old saves supported through a converter,
with a new Rust-defined save format; a monotonic clock for live deltas and the
wall clock for saves and offline catch-up, which the engine handles; a wasm
boundary of commands in and one flat snapshot out per tick; and a dual-engine
diff harness.

## 0. Key facts that shape the port

1. **No per-tick simulation exists.** A unit's count is a closed-form
   polynomial in the time since the last *reify*:
   `count(t) = Σ_d c_d · t^d / d!`. Here `c_d` sums `floor(count(first ancestor)) ·
   Π(prod · stat)` over all producer paths of length `d`
   (`engine/src/unit.ts:59-99`, `145-176`). `tick()` only moves `now`
   (`game.ts:249-266`). State changes only when a command calls `withSave`, which
   reifies: it writes the current counts back and resets `reified`
   (`game.ts:374-405`). **Offline catch-up is therefore exact and O(1):** load
   the save, set `now`, and evaluate. Don't add an integrator. Reify only where
   the TS engine reifies, or results drift: intermediate units' caps are not fed
   back into the polynomial between reifies.
2. **The degree is large.** The real data has producer paths up to **degree 20**
   and up to 20 paths per unit (measured with the current tables: 58 units, 88
   upgrades, 121 achievements, 6 mtx).
3. **Some caches change game logic, not just speed.**
   - Visibility is sticky: once true it stays true until respec, ascend, import
     or reset (`unit.ts:553-561`, `upgrade.ts:109-124`), and `Upgrade.isBuyable`
     depends on it.
   - `isUpgradable` and upgrade estimates are refreshed only every 3 s of clock
     time (`game.ts:54-58`, `85-88`; `upgrade.ts:283-291`), so
     `availableAutobuyUpgrades()`, which drives "buy all upgrades"
     (`game.ts:328-333`), can be up to 3 s stale.
   - Stats are cached until the next update (`game.ts:60-74`), so
     `multStatPerAchievementPoint` (`effecttypes.ts:327-335`) misses
     achievements earned through `withUnreifiedSave` until the next purchase.
   - `engine/test/differential.test.ts` already tests these behaviours against
     the original game.
4. **A scenario harness already exists.** `engine/oracle/scenario.ts` has a JSON
   action language: tick, buyUnit, buyMaxUpgrade, buyAllUpgrades, ascend,
   respec, undo, importSave, estimate*, parseNumber, and others. It drives any
   engine that implements `ScenarioEngine`, and it serialises snapshots the
   same way for every engine. `engine/test/golden/*.json` holds 12 goldens
   recorded from the original CoffeeScript game, and `test/tsengine.ts` adapts
   the TS engine. The Rust harness reuses all of this (section 6).
5. **`swarm-num` has no NaN and no Infinity.** It saturates to `Num::MAX`, and
   `floor`/`ceil` snap values within 4 ulp to the integer (see
   `rust/crates/num/src/lib.rs` docs). The TS engine uses `Infinity` as a value:
   `maxCostMet` with no costs, estimates, `_costMetPercent`. It also returns NaN
   "in odd cases" (`upgrade.ts:35`). The Rust engine must use `Option`/enums
   where TS relies on `Infinity`, and the harness must map them back.

## 1. Engine inventory (TS → Rust)

| TS module | Rust home | Contents / notes |
|---|---|---|
| `data.ts`, `types.ts`, `spreadsheetutil.ts`, `unittypes.ts`, `upgradetypes.ts`, `achievementtypes.ts` | `swarm-data::{schema, resolve, paths, stats, tabs}` | Row grouping and `resolveList` go away: the JSON is already grouped (section 2). Name references are resolved to `UnitId(u16)`, `UpgradeId(u16)`, `AchievementId(u16)`. **Producer paths are pure data**, so they are computed once at load (`unittypes.ts:59-67, 112-116`), as are tabs (`tab.ts:67-97`). Load-time asserts are kept: prod/cost > 0 (`unittypes.ts:100-110`), upgrade `factor` defaults to 1 when `maxlevel == 1` (`upgradetypes.ts:54-56`), and `slug = label` (`unittypes.ts:99`). Stat names (`prod`, `cost.meat`, `power.swarmwarp`, `random.minlevel.hatchery`, `upgradecostmult.<name>`, …) are interned to `StatId`. `validateSchema` (mult and add conflicts, `effecttypes.ts:105-114`) moves to load time. |
| `game.ts` `Cache` | `swarm-engine::cache` | The four TS cache lifetimes become explicit generations: `update` (any state mutation), `tick`, `periodic` (3000 ms of the injected clock) and `respec` (the sticky-visibility sets). They are **not** persisted, and are rebuilt on load and undo. `firstSpawn` (tutorial flags, cleared on reload) lives here as well. |
| `game.ts` `Game` | `swarm-engine::{time, engine, progression}` | `time`: `now_ms`, `reified_ms`, `skipped_ms`, `game_speed`, `diff_seconds()` (`205-229`), `reify()`, and `with_save(f)`, which reifies twice for swarmwarp (`396-405`). `progression`: ascend cost (`428-441`), ascend (`465-500`: `_init` rebuild, non-`ascendPreserve` units reset, non-mutagen-tab upgrades zeroed, a free respec every 3 ascensions, `date.restarted = now`), respec/respecFree/`_respec` (`502-564`). |
| `unit.ts` `ProducerPath(s)` | `swarm-engine::production` | `prodEach` is the product of `(prod.val + base) · prod-stat` along the path, clamped to `UNIT_LIMIT=1e100000` at each step (`59-86`). `coefficient` uses `rawCount.floor()` (`87-90`). Coefficients are a `Vec<Num>` indexed by degree (`145-162`). `velocity` is the degree-1 coefficient using *current* counts (`689-694`). Cache `prodEach` per path prefix in the update generation. |
| `unit.ts` `Unit` | `swarm-engine::unit` | `raw_count`, which keeps the `toPrecision(15)` quirk for numeric legacy values (`300-314`); `count = cap(poly(diff_seconds))` (`495-504`); `cap` from stats `capBase·capMult+capFlat` (`333-360`); `stats()` folds the unit's upgrades in list order, then the `affectedBy` unit effects using the parent's count (`720-732`), and **the order matters for rounding**. Also `eachCost` and `eachProduction` (`670-686`), `maxCostMet` (floor of the min ratio × percent, `596-600`), `spent` (`512-527`), `isVisible` with OR/AND requires (`563-581`), and `buy` (`628-651`), which includes the hard-coded energy→mtxEnergy hack at `646-648`. `upgrades` also includes `showparent` upgrades (`241-252`). The addUnitTimed timers live in `state.date["addUnitTimed-<unit>"]` (`744-761`). |
| `unit.ts` estimates | `swarm-engine::estimate` | `estimate_secs_until_earned` (`394-455`): linear, quadratic formula, then bisection (50 iterations, 0.2 s threshold, `457-493`) once the degree is above 2. The TS version returns the JS number `0` when the target is already reached. That quirk makes `ascendCostDurationSecs` and `estimateSecsUntilBuyable` throw TypeErrors (`game.ts:454-464`, `upgrade.ts:244-247`, `264-266`). In Rust, model it as `enum Estimate { Reached, Secs(f64), Never }` and report the TS error string as a parity-mode result. |
| `upgrade.ts` | `swarm-engine::upgrade` | `totalCost = val · factor^(count+upgradecost) · upgradecostmult · upgradecostmult.<name>` (`139-148`). `sumCost` is the geometric series, with the special case `factor == 1` (`149-162`). `maxCostMet` (`167-207`) solves `log(1 - have·pct·(1-f)/val)/log f`, floors it, then applies the **#290 correction**: if `sumCost(max)` exceeds what you have, subtract 1. The log base doesn't matter because the formula only uses ratios. `costMetPercent` (`213-225`). `buy` calls **`onBuy` once per level** (`323-327`), so it is O(num) and the effects compound. `watchedAt` is stored as a bool or number in `state.watched` (`355-377`). |
| `effect.ts`, `effecttypes.ts` | `swarm-engine::effects` | The name-keyed handler registry becomes `enum EffectKind` with `match` arms: addUnit, addUnitByVelocity, addUnitTimed, addUnitRand, compoundUnit, addUpgrade, skipTime, multStat, expStat, asympStat, logStat, addStat, initStat, multStatPerAchievementPoint, suffix. Current usage: multStat 73, logStat 28, compoundUnit 23, addUnit 23, and so on. `power()` = `power · power.<upgrade>` (`effect.ts:82-90`). In compoundUnit, an **empty `val2` (not 0) means uncapped** (`effecttypes.ts:218-221`). addUnitRand (`163-208`) uses a seeded RNG with seed string `` `[${restarted.getTime()}, ${parent.name}, ${level}]` ``, prefixed by `utcDateString(date.started)` (`util.ts:54-63`). A spawn is guaranteed at minlevel and at every level that is a multiple of 8. The suffix effect writes `unit.suffix` as a side effect of computing stats (`337-354`); in Rust, compute it eagerly and store it in the derived data. The `memoLog`/`constantLog` memos are only for performance and can be dropped. |
| `seedrand.ts` | `swarm-engine::seedrand` | A bit-exact port of seedrandom 2.4.2's ARC4 (`mixkey`, a 256-byte key schedule, a discarded 256 bytes, a 52-bit double built from 6 bytes plus overflow handling). About 80 lines, tested against `test/seedrand.test.ts` vectors and `golden/random-spawns.json`. |
| `achievement.ts`, `achievementtypes.ts` | `swarm-engine::achievement` | Requires are either `{event, params}`, `{unit, val}` or `{upgrade, val}`. Unit achievements count the statistics `twinnum`, **not** `count()`, except for the ascension check, which uses the raw count (`149-171`). Event achievements do a shallow pick-and-equal on params (`195-211`). `earn` stores `elapsed = now - started` without a reify (`63-70`). Also `isUnmasked`, `progress*` and points. |
| `statistics.ts` | `swarm-engine::statistics` | `clicks`; `byUnit{clicks,num,twinnum,elapsedFirst}`; `byUpgrade{…}`; emits `buyFirst` (`26-63`). It runs before the achievements listener, and Rust keeps that order by calling the two in sequence. |
| `command.ts`, `events.ts`, `engineevents.ts` | `swarm-engine::command`, `::events` | There is no listener bus. `apply(cmd)` runs, in this order: the undo snapshot, the action, statistics, achievements, then pushes `Event`s onto a queue that the next view drains. Undo is a clone of `State` rather than a save string (`52-59`). `buyAllUpgrades` keeps earlier purchases if a later one throws (`135-157`). |
| `session.ts` | `swarm-engine::state` + `swarm-save` | `State` is the serde struct (section 5). Legacy encode/decode, `_validateSaveVersion` (`171-196`), heartbeat and `dateClosed` (which takes the max over every date key, including timers, `331-344`) move to `swarm-save::legacy` and `swarm-engine::offline`. |
| `backfill.ts` | `swarm-engine::backfill` | Three load-time fixes (`6-55`): replay hatchery/expansion `onBuy` for pre-mutagen saves (an O(levels) loop); initialise `freeRespec`; restore the ascension count from statistics (issue #431). It runs after every load and import. |
| `parsenumber.ts`, `numbersuffixes.ts` | `swarm-engine::parse_number`; the suffix tables come from `swarm-num::format` | Handles `%` of max, word or short suffixes, `=` for no twins, and `@` for a target. TS uses a decimal.js clone with `ROUND_CEIL` (`parsenumber.ts:12, 72-93`). Num has no rounding modes, so it uses ceil after the twin division. |
| `tab.ts` | `swarm-data::tabs` + view | The tab structure is static. `sortUnits` (by `empower` descending, `56-65`) depends on runtime stats, so the sort order is computed in the view. |
| Dead code | — | `isVelocityConstant`, `ignoredUpgrades`/`unignoredUpgrades` (always threw), `ESTIMATE_BISECTION=false` path, `gameSpeed` (debug only, keep as a field). |

App-side logic that belongs in the engine, so the TUI can reuse it: welcome back and offline gains
(`app/src/game/welcomeback.ts`), tutorial step (`app/src/game/tutorial.ts`,
reads `cache.firstSpawn`), undo window (`app/src/game/progression.ts:11-16`).

## 2. Data pipeline

The Rust engine should not re-implement spreadsheet row parsing. `tables`
already has typed, grouped records in `tables/src/{unittype,upgrade,achievement,mtx}/data.ts`.
Add `tables/src/json/gen-json.ts` (script `gen:json`), which writes
`rust/crates/data/data/gamedata.json`.

**Commit the JSON** into the crate, following the pattern of `static.ts` and
`static.test.ts`. A jest test in `tables` fails if it is stale. Cargo
builds then never need Node, and `cargo package` works.

The shape: arrays keep spreadsheet order, which is significant. Optional fields
are `null` or absent, never `""`.

```jsonc
{
  "schema": 1,
  "unittypes": [{
    "name": "drone", "slug": "drone",
    "text": {"label":"drone","plural":"drones","verb":"hatch","verbone":"hatches","verbing":"hatching","description":"…","lol":"…"},
    "tab": "meat", "column": 1, "tier": 1, "init": 0,
    "ascendPreserve": false, "disabled": false, "unbuyable": false, "isBuyHidden": false,
    "showparent": null,
    "warnfirst": null,                       // or {"unittype":"…","val":0,"text":"…"}
    "cost":     [{"unittype":"meat","val":10}],
    "prod":     [{"unittype":"meat","val":1}],
    "requires": [{"unittype":"meat","val":10,"op":null}, {"upgradetype":"…","val":1,"op":"OR"}],
    "effect":   [{"type":"multStat","unittype":"drone","unittype2":null,"stat":"prod","val":2,"val2":null,"val3":null}]
  }],
  "upgrades": [{
    "name": "hatchery", "text": {"label":"…","description":"…","lol":"…"},
    "class": "upgrade", "unittype": "meat", "maxlevel": null,
    "cost":     [{"unittype":"meat","val":300,"factor":10}],
    "requires": [{"unittype":"drone","val":10}],
    "effect":   [{"type":"addUnitRand","unittype":"premutagen","upgradetype":null,"unittype2":null,"stat":null,"val":1.1,"val2":null}]
  }],
  "achievements": [{
    "name": "…", "text": {"label":"…","description":"… $REQUIRED …","longdesc":"…"}, "points": 10,
    "requires": [{"unittype":"drone","val":1}] /* | [{"upgradetype":…}] | [{"event":"achieveclick","params":{"name":"clickme"}}] | [{"event":"konami","params":null}] */,
    "visible":  [{"unittype":"meat","val":0}]
  }],
  "mtx": [{"name":"crystal000","label":"…","description":"…","uses":1,"pack":{"unittype":"crystal","val":10000},"bulkbonus":1}]
}
```

As built (M1), the shape above holds with these refinements, all forced by
what the engine actually sees (`engine/test/gamedata-json.test.ts` checks every
field against `buildTypes()`):

- Optional values are always present as `null`, never absent. Empty text
  (e.g. `verb` of non-buyable units, `freeRespec`'s `label`) is `null`, so
  `slug` can be `null`; so can `tab`, `column` and `tier`.
- Values that `S.number` encodes, where 0 means "absent" to the engine, are
  `null` when 0: unit `cost`/`prod` `val`, `warnfirst.val`, upgrade
  `maxlevel` and cost `factor`, and the mtx numbers. Thirteen maxlevel-1
  upgrade costs have `"factor": null`; `swarm-data` applies the default 1.
  `init` stays a number (0 when absent), as shown.
- Upgrade effects can lack `unittype` (`skipTime`, `addUpgrade`), and unit
  effects `stat`, so both are nullable.
- mtx also keeps `price_kreds` and `price_usd_paypal`.
- The file has one record per line (117 KB), for readable diffs.
- Besides `producer-paths.json`, `engine/scripts/dump-rust-fixtures.ts`
  (`pnpm --filter @swarmsim/engine dump:rust-fixtures`) also dumps each unit's
  tab, upgrade list and `affectedBy` (`units.json`) and the tabs
  (`tabs.json`). The engine parity test fails while any of them is stale.

Watch these when writing the generator. The engine today sees the data only after an
encode → `parseRows` round trip (`tables/src/spreadsheet/data.ts`,
`engine/src/spreadsheetutil.ts`), and that round trip has semantics of its own:

- `S.number` encodes `0` as `""`, which `defaultFilter` then drops
  (`tables/src/spreadsheet/original.ts:7-12`).
- `S.boolean` decodes `""` as `true`, which is a latent bug (`original.ts:19-22`).
  The codecs test truthiness instead.
- Unit requires are renamed between `upgrade` and `upgradetype`
  (`unittype/codec.ts`, encode).
- Event `val` is a JSON *string* that `AchievementsListener` parses at runtime
  (`achievement.ts:197-199`). Emit it as parsed `params`.
- There is no `cap` column, so `Unit.cap` is always empty and caps come only from
  the stats.

So add **a parity test in `engine/test/gamedata-json.test.ts`**. It loads the JSON,
applies the documented defaults, and compares it field by field to the
`buildTypes()` tables the TS engine actually uses. Mtx isn't used by the engine
(`convertCrystal` was dropped, `command.ts:6-7`), so it is emitted only for
completeness, without the PayPal URLs.

**Loading: `include_str!` plus serde at startup (recommended)** rather than
`build.rs` codegen:

- The JSON is about 100 KB. Parsing and resolving it is about 1 ms natively and
  a few ms in wasm, once, through a `OnceLock<GameData>`.
- Tests and the harness can load alternative data, mirroring
  `createGame({spreadsheet})`. `GameData::from_json(&str)` is public.
- No generated Rust code to review, and no build-script dependencies in the
  wasm build.
- Typos and broken references are caught by a `#[test]` that resolves the
  embedded data, so CI catches them as well as codegen would.
- The one codegen benefit, typed handles for the names hard-coded in the engine
  (`energy`, `mtxEnergy`, `mutagen`, `premutagen`, `ascension`, `freeRespec`,
  `respecEnergy`, `invisiblehatchery`, `hatchery`, `expansion`, `mutatehidden`,
  `swarmwarp`), comes from a `WellKnown` struct resolved and asserted at load.

## 3. Crate layout

```
rust/crates/
  num/        swarm-num      (in progress)                         deps: serde?
  data/       swarm-data     schema + resolved GameData + paths     deps: swarm-num, serde, serde_json
  engine/     swarm-engine   State, Engine, Command, View           deps: swarm-num, swarm-data, serde
  save/       swarm-save     v2 envelope, legacy v1 reader/writer   deps: swarm-engine, lz-str, base64, serde_json
  scenario/   swarm-scenario oracle action language + snapshot ser  deps: swarm-engine, swarm-save, serde_json  (test/tooling)
  cli/        swarm-cli      bin `swarm`                            deps: all above, clap, directories
  tui/        swarm-tui      bin `swarm-tui`                        deps: engine, save, ratatui, crossterm, directories
  wasm/       swarm-wasm     cdylib                                 deps: engine, save, wasm-bindgen, serde_json
  tauri/      swarm-tauri    Tauri 2 shell (NOT in default-members) deps: tauri, tauri-plugin-fs
```

These must stay wasm-portable: `swarm-num`, `swarm-data`, `swarm-engine`,
`swarm-save`. That means no `std::time::SystemTime` or `Instant`, no filesystem,
no threads, and no `rand`/`getrandom`. All times arrive as arguments. Randomness
already comes from the save's seed (`seedrand`). CI runs
`cargo build -p swarm-engine -p swarm-save --target wasm32-unknown-unknown`.
`swarm-tauri` pulls in webkit2gtk, so leave it out of `default-members` so that
`cargo test` works on machines without GTK. All crates are GPL-3.0, like the
workspace.

## 4. Public engine API

```rust
pub struct Engine { data: &'static GameData, state: State, rt: Runtime /* clock, caches, sticky sets, undo, events */ }

pub struct LoadOutcome { pub engine: Engine, pub offline: Option<OfflineReport>, pub warnings: Vec<String> }

impl Engine {
    pub fn new_game(data: &'static GameData, wall_now_ms: i64) -> Engine;
    /// Runs backfill, then anchors the game clock at wall_now: offline progress = wall_now - closed.
    pub fn load(data: &'static GameData, state: State, wall_now_ms: i64, heartbeat_ms: Option<i64>) -> Result<LoadOutcome, LoadError>;
    /// Live time: a monotonic delta. Never negative, so the back-in-time assert disappears.
    pub fn advance(&mut self, dt: core::time::Duration);
    /// After suspend or a hidden tab: if the wall clock moved more than the monotonic clock (> 5 s), add the gap.
    pub fn resync_wall(&mut self, wall_now_ms: i64) -> Option<OfflineReport>;
    pub fn apply(&mut self, cmd: Command) -> Result<CommandOutcome, CommandError>;
    pub fn view(&mut self, req: &ViewRequest) -> View;     // recomputes tick-level data
    pub fn static_view(&self) -> StaticView;               // names, labels, tabs, effect templates: sent once
    pub fn state(&self) -> &State;                          // for saving
    pub fn mark_closed(&mut self, wall_now_ms: i64);        // heartbeat / pagehide
    #[cfg(feature = "parity")] pub fn set_now_ms(&mut self, ms: i64) -> Result<(), TimeError>; // TS tick() incl. 120 s quirk
}

pub enum Command {
    BuyUnit { unit: UnitRef, amount: Amount },          // Amount::Num(Num) | Amount::Input(String) (parse_number)
    BuyMaxUnit { unit: UnitRef, percent: f64 },
    BuyUpgrade { upgrade: UpgradeRef, amount: Amount },
    BuyMaxUpgrade { upgrade: UpgradeRef, percent: f64 },
    BuyAllUpgrades { percent: f64, which: UpgradeSet },  // Autobuyable (game.availableAutobuyUpgrades) | Explicit(Vec<UpgradeRef>)
    Ascend, Respec, RespecFree, Undo,
    Watch { upgrade: UpgradeRef, level: i32 },          // -1 hidden, 0 off, n = notify at 1/n
    SetOption { key: String, value: serde_json::Value }, // the UI bag in state.options (app/src/game/options.ts:92-94)
    UiEvent { name: String, params: serde_json::Value }, // achieveclick, konami, import, changelog, debugPage, …
    DismissWelcomeBack, Reset,
    #[cfg(feature = "parity")] Cheat(Cheat),            // setUnitCount / setUpgradeCount / skipTime for scenarios
}
// UnitRef / UpgradeRef: serde-untagged name strings at the boundary, resolved to ids. `ui: Option<String>` is kept for statistics parity.
```

The design of `View` follows what `app/src` reads. The most common calls are `unit()`
(92), `upgrade()` (34), `count()`, `maxCostMet()` and `maxCostMet(0.25)`
(`BuyUnit.tsx:67-68`, `UpgradeItem.tsx:38-39`), `velocity`, `isVisible`,
`isCostMet`, `twinMult`, `totalProduction`, `totalCost`, `capValue`/`capPercent`/`capDurationSeconds`,
`estimateSecsUntilBuyable`, `isNewlyUpgradable`, `costMetPercent`, the ascend and respec
family, achievements and progress, statistics, and effect
`output()`/`bank()`/`cap()`/`calcStats()` (`content/LiveDescription.tsx`). The view
is **index-aligned with `StaticView`**, so it carries no names:

```rust
pub struct View {
    pub seq: u64, pub now_ms: i64, pub started_ms: i64, pub restarted_ms: i64, pub skipped_ms: i64,
    pub units: Vec<UnitView>, pub upgrades: Vec<UpgradeView>, pub tabs: Vec<TabView>,   // TabView: sorted visible unit ids, newly_upgradable
    pub achievements: AchievementsView,   // per-achievement earned_at, unmasked, progress (val,max,order); points, percent
    pub ascension: AscendView,            // energy_spent, cost, percent, cap_diff, eta: Estimate, respec_{cost,percent,met,spent}, free_respecs
    pub statistics: StatisticsView,       // clicks, by_unit, by_upgrade
    pub undo: Option<UndoView>,           // secs_since, is_redo
    pub hints: Hints,                     // first_spawn flags, tutorial_step
    pub offline: Option<OfflineReport>,   // welcome back until dismissed
    pub events: Vec<Event>,               // drained: Achieved(id), BuyFirst, CommandFailed(msg), SaveRequested
    pub slow_seq: u64,                    // bumps when the 3 s "periodic" fields were recomputed
}
pub struct UnitView {
    pub count: Num, pub velocity: Num, pub visible: bool, pub suffix: String,
    pub buyable: bool, pub buy_button_visible: bool, pub cost_met: bool,
    pub max_cost_met: Num, pub max_cost_met_quarter: Num, pub max_cost_met_of_velocity: Num, pub twin_mult: Num,
    pub each_cost: Vec<(UnitId, Num)>, pub each_production: Vec<(UnitId, Num)>, pub total_production: Vec<(UnitId, Num)>,
    pub cap: Option<Num>, pub cap_percent: Option<Num>, pub cap_eta: Estimate,
    pub newly_upgradable: bool,
    pub stats: Option<Vec<(StatId, Num)>>,  // only for ViewRequest.focus units
}
pub struct UpgradeView {
    pub count: Num, pub visible: bool, pub buyable: bool, pub upgradable: bool, pub newly_upgradable: bool,
    pub watched: i32, pub max_cost_met: Num, pub max_cost_met_quarter: Num, pub cost_met_percent: Num,
    pub total_cost: Vec<(UnitId, Num)>, pub eta: Estimate /* slow */, pub eta_unit: Option<UnitId>,
    pub effects: Vec<EffectView>,           // output, output_next, bank, cap, stats: visible upgrades only
}
```

On the wire, `Num` is `[mantissa, exponent]` (two JSON numbers), not a string, so
JS can compare values without parsing. `ViewRequest { focus: Vec<UnitRef>, slow:
bool }` keeps heavy fields (stats, estimates using a degree-20 bisection) to the
units on screen, and limits recomputation of `slow` fields to every ≥ 3 s,
matching the TS periodic cache. Formatting stays in JS: `app/src/format.ts` moves
from decimal.js to a ~100-line TS `Num` class using the same suffix tables, so
there are no per-number calls into wasm. `Estimate` serialises as `{"reached":true}` /
`{"secs":12.5}` / `{"never":true}`.

wasm surface:

```rust
#[wasm_bindgen] impl WasmGame {
  #[wasm_bindgen(constructor)] pub fn new(save: Option<String>, wall_now_ms: f64, heartbeat_ms: Option<f64>) -> Result<WasmGame, JsError>;
  pub fn static_view(&self) -> String;            // JSON, once
  pub fn command(&mut self, cmd_json: &str) -> Result<String, JsError>; // outcome JSON
  pub fn tick(&mut self, dt_ms: f64, view_req_json: &str) -> String;    // advance + view JSON
  pub fn resync(&mut self, wall_now_ms: f64);
  pub fn export_save(&mut self, wall_now_ms: f64) -> String;            // v2 string
  pub fn mark_closed(&mut self, wall_now_ms: f64);
}
```

Start with JSON strings, since they are simple and easy to inspect. Switch to
`serde-wasm-bindgen` only if profiling at 10 Hz (`TICK_MILLIS = 100`,
`app/src/game/store.ts:14`) shows a need.

As built (M2 engine core, `swarm-engine`), with these deviations:

- Queries are `&self` methods on `Engine` taking ids (`count(UnitId)`,
  `upgrade_max_cost_met(UpgradeId, Num)`, ...; caches in a `RefCell`).
  `Engine::from_state` (no backfill, TS `new Game`) and `import_state` (TS
  `importSave` without backfill) exist for the save/scenario crates.
  `load` doesn't fail when the clock is more than 120 s before `reified`: it
  resumes at `reified` with a warning.
- The `parity` feature gates `set_now_ms`, `force_now_ms` (TS `game.now = x`)
  and `Command::Cheat` (`SetUnitCount`, `SetUpgradeCount`, `SkipMs`).
- `Command` is serde-tagged `{"do": "buy_unit", ...}`; `Amount` is
  `{"num": ..}`/`{"input": ..}`; buy commands carry `ui: Option<String>`.
  `BuyAllUpgrades` with an empty set is a no-op without an undo snapshot
  (what the app's buy-all button does). `Event::Command(CommandEvent)` is
  queued for every TS `'command'` event, and `CommandOutcome.commands`
  repeats this command's.
- Sentinels: `unit_max_cost_met`/`upgrade_max_cost_met` without costs return
  `Num::MAX`; `cost_met_percent` is `Option`; `estimate_secs_until_buyable`
  returns `UpgradeEstimate::{MaxAffordable, Unavailable (TS TypeError), Wait
  {secs, unit, cache_safe}}`, where `secs` can be `Secs(NaN)` like the TS;
  `ascend_cost_duration` returns `Option<Estimate>`.
- `Upgrade.buy` refuses more than `MAX_LEVELS_PER_BUY` (1e7) levels at once
  (`CommandError::TooManyLevels`) instead of hanging.
- `watch(level)` stores the default level as absent (TS stores a numeric 1).
- The unit suffix is computed from the level (`Engine::suffix`), not as a
  stats side effect, so it never lags.
- `view()` is minimal (`ViewRequest { focus }`; units, upgrades,
  achievements, events); `OfflineReport` is `{closed_ms, resumed_ms}`.

## 5. Save format v2

```rust
#[derive(Serialize, Deserialize)]
pub struct SaveV2 {
    pub format: u32,                 // 2
    pub game_version: String,        // crate version that wrote it
    pub data_schema: u32,            // gamedata.json "schema"
    pub dates: Dates,                // started, restarted, reified, saved, closed: i64 ms epoch
    pub skipped_ms: i64,
    pub units: BTreeMap<String, Num>,        // name-keyed: survives data reordering
    pub upgrades: BTreeMap<String, Num>,
    pub achievements: BTreeMap<String, i64>, // elapsed ms when earned
    pub watched: BTreeMap<String, i32>,
    pub timers: BTreeMap<String, i64>,       // addUnitTimed-<unit> date keys
    pub statistics: Statistics,
    pub options: serde_json::Map<String, Value>, // opaque UI bag, round-tripped
    pub flags: Flags,                        // kongregate, …
    #[serde(flatten)] pub unknown: BTreeMap<String, Value>, // forward compatibility
}
```

Encoding is `"SW2|" + lz_str::compress_to_base64(serde_json::to_string(&save))`,
which stays clipboard- and URL-friendly. Unknown unit or upgrade names are kept
and written back unchanged, never dropped.

Versioning works like this:
- `format` is bumped only for incompatible changes.
- `migrate(Value) -> SaveV2` steps run on the raw `serde_json::Value` before
  typed decoding.
- Data changes such as renamed units go through a rename table in `swarm-data`.

The TS/Coffee converter, `swarm-save::legacy`, detects v1 saves by
`/^[A-Za-z0-9+/=]*\|Q2hlYXRlciA6KAoK/` or the bare
`Q2hlYXRlciA6KAoK` prefix used by pre-header saves (`session.ts:3-4, 147-159`).
It then follows these steps:

1. Strip whitespace.
2. Split off the latin1-base64 version header.
3. Drop the prefix and run `decompressFromBase64`.
4. Parse JSON.
5. Apply `_validateSaveVersion` and the publictest blacklist (`session.ts:171-208`).
6. Read numeric counts using the `toPrecision(15)` rule (`session.ts:231-240`),
   and decimal.js strings such as `"1.2345e+21"` with `Num::from_str`.
7. Turn every `date.*` into epoch ms; `addUnitTimed-*` keys become `timers`.
8. Treat `watched` booleans as 1 or 0.
9. Run backfill.

The fixtures are `engine/test/fixtures/session-saves.json` (v0.2, v1, publictest,
whitespace), `swarmsim-ts/src/persist.test.json` (which includes lz-string vectors
for checking `lz-str` compatibility), and `SAVE_V1`/`SAVE_MIDGAME` in
`engine/oracle/scenarios.ts`. Also add a **v1 writer** (behind the `legacy-write`
feature). The harness needs it to resync TS from Rust, and it gives players a
rollback path during the wasm swap. Note: the React app's existing players have
v1 saves in localStorage under `swarmhive-v1` (`store.ts:12`). Converting them is a
**hard requirement for M6**, even though general compatibility is only
"nice to have".

## 6. Test strategy

**Unit tests per module**, ported from `engine/test/*.test.ts`. These mirror the
Coffee specs, and they include the arithmetic examples from `unit.test.ts`,
`upgrade.test.ts`, `effect.test.ts`, `seedrand.test.ts`, `parsenumber.test.ts`,
`session.test.ts`, `backfill.test.ts`, `achievements.test.ts` and
`statistics.test.ts`. Add property tests (proptest) for:
- `maxCostMet`: buying `maxCostMet` always succeeds and leaves
  `count < cost(next)`;
- `sumCost(a+b) == sumCost(a) + sumCost(b, from a)` within tolerance;
- polynomial count monotonicity;
- v2 save round-trip identity.

**Golden fixtures without Node.** `swarm-scenario` implements the oracle action
language (`oracle/scenario.ts:46-90`) and the same serialisation (Decimal →
string, non-finite → `{"$number":"Infinity"}`, Date → ISO). `cargo test` replays
the 12 committed goldens from the original game through a tolerant JSON
comparator.

**Dual-engine harness** (`rust/harness/` script + `swarm scenario run` CLI):

- *Driving TS:* add `engine/oracle/run.ts <scenario.json> [--engine ts|oracle]`.
  It is about 30 lines: `runScenario(s, {}, createTsEngine)` →
  `goldenJson(result)` on stdout, run with `ts-node --transpile-only`. The
  harness runs it and `swarm scenario run` on the same file and diffs the outputs.
  It is kept until the TS engine is retired.
- *Corpus:*
  - the fixture saves;
  - about 50 saves at increasing progress, generated by the deterministic
    auto-player already in `oracle/scenarios.ts` (`Planner`, `buyTab`) at
    t = 1 min to 30 days and after 1-5 ascensions;
  - real player saves if any can be collected, after stripping `options`.
- Each save runs N = 200 steps that mix ticks (0.1 s to 3 days, to cover offline
  catch-up), auto-player buys, buy-alls, abilities (swarmwarp exercises
  `skippedMillis`) and ascend/respec. A full snapshot is taken after each step.
- *Compare:* the full snapshot (units, upgrades, achievements, ascendInfo) plus
  the raw `state`.
- *Tolerances:*
  - **Exact:** booleans, error strings (mapped from Rust enums), command logs,
    achievement sets and `earned_at`, upgrade counts, statistics clicks.
  - **Relative 1e-9:** counts, velocities, costs and stats.
  - **Estimates:** relative 1e-6, or 0.5 s absolute. Bisection has a 0.2 s
    threshold, and the quadratic formula `(-b + sqrt(b²-4ac))/2a`
    (`unit.ts:419-420`) loses accuracy through cancellation in f64.
  - **Integer-valued fields** (`maxCostMet`, unit counts below 1e15): exact,
    **unless** the continuous input lies within 1e-12 relative of an integer
    boundary. Such a case is logged as `precision-boundary`, not as a failure.
- *Modes:*
  - **Lockstep**: after every step Rust re-imports TS's exported save, so
    divergences don't compound; this also exercises the converter.
  - **Free-run**: measures drift over N steps and reports the maximum relative
    error per field. It is informational, with a budget of 1e-6 at N = 200.
- CI runs lockstep on the corpus. The free-run report is attached as an artifact.

**Wasm and frontend tests:** `wasm-bindgen-test` for the boundary. The app's
existing vitest and e2e suites (and `app/bench`) run against the wasm store.

## 7. Work order

| # | Milestone | Size | Deliverable | Done when |
|---|---|---|---|---|
| M0 | `swarm-num` (in progress, other agent) | — | Num with ops, pow/log/sqrt, parse, serde, suffix format | The engine needs `pow_num` (factor^count, t^d, `Decimal.pow(level, val)`), `log10` ratios, `sqrt`, `%` (mod 3 and mod 8), floor/ceil, min/max, `to_f64`, parsing of decimal.js `toString` output (`1.2e+21`), and `Display` of integers below 1e21 identical to JS (seed strings). Add a decimal.js fixture test for each. |
| M1 | Data pipeline | 3-4 d | `tables gen:json` → `rust/crates/data/data/gamedata.json`; `swarm-data` (schema, resolve, ids, StatId, producer paths, tabs, WellKnown) | The tables staleness test, the engine JSON-vs-`buildTypes` parity test, and a Rust test that resolves the embedded data and checks the producer-path list for each unit against a TS dump all pass. |
| M2 | Engine port + harness | 4-6 wk | `swarm-engine` (all of section 1), `swarm-save::legacy` reader (needed for the corpus), `swarm-scenario`, `engine/oracle/run.ts`, harness script | All 12 goldens pass with tolerance, `differential.test.ts` scenarios pass, the corpus passes in lockstep, the free-run drift budget is met, and the wasm32 build of engine + save compiles. Suggested internal order: time + state → production/counts → stats/effects → unit buy → upgrades → seedrand/addUnitRand → achievements/statistics/commands/undo → ascend/respec/backfill → estimates → parse_number → view. |
| M3 | CLI | 3-4 d | `swarm` binary: `new`, `show`, `buy`, `buy-max`, `upgrade`, `ascend`, `advance 3h`, `export`, `import`, `convert v1→v2`, `scenario run`, `bench`; saves in the XDG data dir; `swarm-save` v2 | v2 round-trip, v1→v2→play works on every fixture, and scripted CLI sessions are snapshot-tested with `insta`. |
| M4 | TUI | 1.5-2 wk | ratatui tabs/unit list/unit detail/upgrades/abilities/achievements/stats/options; monotonic ticks at 10 Hz; autosave; welcome-back screen | A manual play-through of the first ascension, a suspend/resume resync check, and render tests using `TestBackend`. |
| M5 | wasm swap in React | 2-3 wk | `swarm-wasm` + wasm-pack build; `app/src/game/store.ts` replaced by `WasmStore` (tick → view JSON); TS `Num` + `format.ts` port; a thin facade so components read `view.units[i]` instead of `Unit` methods; v1 → v2 localStorage migration on first load (keep the v1 copy) | The app's unit tests, e2e and `app/bench` pass; `@swarmsim/engine` and decimal.js are gone from the app bundle; old saves load with identical counts (rel 1e-9). |
| M6 | Tauri (Linux) | 3-5 d | `swarm-tauri` wrapping the built app (wasm in the webview, so one code path); saves through `tauri-plugin-fs` into the app data dir; AppImage/deb | Launches on Ubuntu LTS (WebKitGTK), saves survive restart, and suspend/resume resync works. |

## 8. Open risks

1. **Precision changes outcomes, not just digits.** decimal.js runs at 20
   significant digits; Num guarantees 15. Several computations decide integer
   outcomes:
   - coefficients use `rawCount.floor()` (`unit.ts:89`);
   - `maxCostMet` floors and then applies the #290 correction
     (`upgrade.ts:192-204`);
   - ascend cost is `ceil(1.12^n · 5e6 / 2^(spent/v))` (`game.ts:440`);
   - parse_number uses `ROUND_CEIL`;
   - the addUnitRand quantity uses `ceil`, and its `roll < prob` comparison
     can flip near the boundary.

   Each of these can flip near a boundary, after which the two engines diverge
   permanently, for example by one more upgrade bought. Exact parity with
   goldens is therefore impossible. That is why the harness uses lockstep
   with a boundary classifier (section 6).
2. **No Infinity or NaN in Num.** The TS engine treats `Infinity` as a value. For example,
   `maxCostMet` with no costs is Infinity, which then goes through
   `.times(percent).floor()`, and goldens record `"Infinity"`. Every sentinel must
   become an `Option`/enum, or a `Num::MAX` that is never fed into further
   arithmetic. Audit each `new Decimal(Infinity)` (`unit.ts:403, 530, 540`,
   `upgrade.ts:174, 215, 233`).
3. **Cache timing is part of game behaviour** (point 3 in section 0). Replicate it
   behind explicit generations first, for parity. After cut-over, decide
   whether to remove the 3 s staleness in buy-all, which is a deliberate behaviour change.
4. **Clock model.** All TS timestamps are wall `Date`s: seeds use
   `restarted.getTime()`, timers sit in dynamic `state.date` keys, and
   `dateClosed` takes the max over all of them. Monotonic deltas still need a
   wall-anchored game timeline. Linux `CLOCK_MONOTONIC` and some browsers'
   `performance.now()` don't advance during suspend, so without `resync_wall` the
   live game would silently lose time across laptop sleep. The 120 s
   back-in-time tolerance (`game.ts:255-264`) exists only in parity mode.
5. **O(n) effect loops.** `Upgrade.buy` runs `onBuy` once per level
   (`upgrade.ts:323-327`), and compoundUnit compounds on each pass. Backfill replays
   every hatchery and expansion level (`backfill.ts:25-31`). Keep the loops for
   parity, but put a guard on `num` (TS would build a huge array first).
6. **The app reaches into engine internals.** It uses `game.cache.firstSpawn` and
   `cache.tutorialStep` (`tutorial.ts:8-19`), `commands._undo`
   (`progression.ts:11-16`), and `session.state.statistics`/`options` directly
   (`StatisticsScreen.tsx:85-112`, `options.ts:92-94`). It also uses
   `_countInSecsFromReified` (`welcomeback.ts:52`), `session._loads` for import
   validation (`SaveTools.tsx:98`), and effect `output/bank/cap/calcStats` per
   upgrade (`LiveDescription.tsx`). Each of these needs an explicit view field or
   command. Expect M5 to touch most components.
7. **Seeded randomness must be bit-exact.** That covers the seedrandom ARC4 port,
   `utcDateString` of `started`, JS number → string for `roll + ""` and
   `modqty + ""`, and decimal.js `toString` of `level` in the seed
   (`effecttypes.ts:187-203`). A single mismatch changes every premutagen spawn.
8. **Quirk-as-error behaviour.** TS deliberately throws TypeErrors that
   players can see as missing ETAs (`game.ts:449-464`, `upgrade.ts:244-247`).
   Rust returns `Estimate::Reached`. The UI must handle that instead of
   showing a blank.
9. **The data round trip hides semantics** (section 2). `""` versus `0` versus
   absent matters for compoundUnit `val2` and upgrade `factor`, and the requires key
   `upgrade` versus `upgradetype` differs between codecs. The parity test is
   essential: don't trust the typed records alone.
10. **Event-sourced achievements depend on UI events**: `konami`, `changelog`,
    `debugPage`, `therightquestion`, `import{success:true}`,
    `achieveclick{name:clickme}`. Every frontend must send these as `UiEvent` or
    the achievements become unobtainable. The TUI needs equivalents.
11. **Undo restores more than counts.** TS undo re-imports the save string, which
    resets every cache, sticky visibility included (`command.ts:52-59` →
    `game.importSave` → `_init`). Rust must clear the runtime caches on undo as
    well, or the two engines will disagree on visibility after an undo.
12. **Wasm payload and per-tick cost.** A full view with every effect and estimate
    is about 30-60 KB of JSON at 10 Hz. Degree-20 bisections over every
    upgrade cost could be ~1-3 ms in wasm. Budget for focus- and slow-tier
    trimming early, and profile against `app/bench`.
