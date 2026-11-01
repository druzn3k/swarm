# @swarmsim/engine-wasm

Swarm Simulator's Rust engine (`rust/crates/wasm`, crate `swarm-wasm`) built
for the web with `wasm-bindgen --target web`, plus a typed TypeScript wrapper.
This is the wasm boundary of milestone M5 in `rust/PLAN.md`; the React app
(`app/`) runs on it (`app/src/game/store.ts`). The TypeScript engine
(`@swarmsim/engine`) stays as the parity oracle and a test dependency.

## Build and test

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --locked --version 0.2.130   # = wasm-bindgen in rust/Cargo.lock
pnpm --filter @swarmsim/engine-wasm build   # -> engine-wasm/pkg/ (gitignored)
pnpm --filter @swarmsim/engine-wasm test    # tsc + vitest
cargo test -p swarm-wasm                    # the boundary, natively (from rust/)
```

`scripts/build-wasm.sh` runs `cargo build -p swarm-wasm --target
wasm32-unknown-unknown --release` (LTO, opt-level `s`), `wasm-bindgen`, and
`wasm-opt -Oz` if it is on the `PATH` (e.g. `npm i -g binaryen`). Without
cargo, the wasm32 target or a matching `wasm-bindgen` it prints a warning and
exits 0 (`SWARM_WASM_REQUIRED=1` makes it fail), and the wasm test suite is
skipped with a message, so `pnpm test:packages` works without Rust.
Size: about 850 KB after `wasm-opt -Oz` (300 KB gzipped), including the
embedded 117 KB `gamedata.json`. A mid-game `view` + `JSON.parse` takes
about 2.6 ms in Node.

Cargo features of `swarm-wasm` (both default): `legacy-write`
(`exportLegacy`, `convertSave(_, 'v1')`), `panic-hook`
(`console_error_panic_hook`). Pass others with
`SWARM_WASM_CARGO_FLAGS="--no-default-features"`.

## Usage

```ts
import { initEngine, GameHandle, Num, formatShort } from '@swarmsim/engine-wasm'

await initEngine()                 // browser: fetches pkg/swarm_wasm_bg.wasm
// Node: await initEngine(readFileSync('.../pkg/swarm_wasm_bg.wasm'))

const game = localStorage['swarmhive-v1']
  ? GameHandle.load(localStorage['swarmhive-v1'], Date.now())   // v1 or v2
  : GameHandle.newGame(Date.now())
const statics = game.staticView()  // once: names, texts, costs, tabs
game.apply({ do: 'buy_unit', unit: 'drone', amount: { input: '50%' } })
game.advance(100)                  // monotonic ms (performance.now() deltas)
const view = game.view({ focus: [3] })
formatShort(view.units![3].count) // "1.23M"
localStorage['swarmhive-v2'] = game.exportV2(Date.now())
```

## The boundary

Flat, as `rust/PLAN.md` section 4 asks: every structured value crosses as a
JSON string (serde_json on the Rust side, `JSON.parse` in `src/index.ts`).
`src/types.ts` restates the serde output by hand, with identical field names.

* **Numbers.** Every `Num` is its canonical string (`NumString`: `"0"`,
  `"123"`, `"1.5e300"`; decimal.js `"1.5e+21"` is also accepted as input).
  `src/num.ts` parses, compares and converts them without wasm; `src/dec.ts`
  (`Dec`) adds the little arithmetic a UI needs (plus, times, div, floor,
  compare) on the same model, 15 significant digits, no float noise;
  `formatShort`/`formatLong` format them (in wasm, the app's `format.ts`
  standard-notation rules; the app formats in TS with `Dec` and the
  `NUMBER_SUFFIXES_*` tables of `src/suffixes.ts`, for its other
  notations). `Num.MAX` (exponent 9e15) stands for the TS `Infinity`.
* **Indices.** Views refer to units, upgrades, achievements, effects, stats
  and tabs by `u16` index into the `StaticView` lists. Commands take names.
* **Scoped upgrades.** The request may carry `upgrades_of: [unit, ...]`
  besides the engine's `ViewRequest` fields: the view then lists only the
  upgrades of those units (and the focused ones) while `units` stays
  complete, which the engine's `only_units` can't do. Upgrades are about
  three quarters of a full view's cost; the app asks for the units on
  screen.
* **Absent = default.** `None`, empty lists and `false` are omitted.
* **Times.** Epoch ms for wall clocks, ms deltas for `advance`; the engine
  keeps whole ms and the wrapper carries sub-ms remainders. `NaN`/`Infinity`
  times throw.
* **Errors** are thrown as `Error`s with the engine's message (`"We require
  more resources"`, `"no such unit: x"`, `"not a Swarm Simulator save"`,
  `"bad command: ..."`). A failed command also queues a `command_failed`
  view event.

| wasm (`Game`, `pkg/`) | wrapper (`GameHandle`) | JSON |
|---|---|---|
| `Game.new_game(wall_now_ms)` | `GameHandle.newGame(now?)` | |
| `Game.load(text, wall_now_ms, heartbeat_ms?)` | `GameHandle.load(text, now?, heartbeatMs?)` | v1 or v2 save in |
| `load_report()` | `loadReport()` | `{format: "v1"\|"v2"\|"new", warnings, offline}` |
| `static_view()` | `staticView()` (cached) | `StaticView` |
| `view(request_json)` | `view(req?)` | `ViewRequest` in (`""`/`{}`: default; plus `upgrades_of`, below), `View` out; drains events |
| `apply(command_json)` | `apply(cmd)` | `{"do":"buy_unit",...}` in, `CommandOutcome` out |
| `advance_ms(dt_ms)` | `advance(dtMs)` | |
| `resync_wall(wall_now_ms)` | `resyncWall(now?)` | `OfflineReport` or `undefined`/`null` |
| `mark_closed(wall_now_ms)` | `markClosed(now?)` | |
| `export_v2(wall_now_ms)` | `exportV2(now?)` | `SW2\|...` |
| `export_legacy(wall_now_ms)` | `exportLegacy(now?)` | v1 text the TS/Coffee game imports |
| `parse_number(input, unit_name?)` | `parseNumber(input, unit?)` | `NumString` or `null` |
| `ui_state()` | `uiState()` | `{options, unknown}`: the options bag `set_option` writes, and the save's unknown top-level keys |
| `welcome_back(force)` | `welcomeBack(force?)` | `WelcomeBack` or `null`, computed now for the load's offline time (`force`: even under 3 minutes); not stored |
| `unit_stats(unit_name)` | `unitStats(name)` | `{stats, each_production, total_production}` of any unit, visible or not (the view's `detail` covers visible focused units only) |
| `format_short(num)` / `format_long(num)` | `formatShort` / `formatLong` | |
| `detect_save_format(text)` | `detectSaveFormat(text)` | `"v1"`, `"v2"` or `null` |
| `convert_save(text, to)` | `convertSave(text, to)` | state unchanged: no backfill, no new dates |

`CommandOutcome` is not a serde type in the engine; `swarm-wasm` writes it as
`{commands: CommandEvent[], bought?: {num, twinnum}, levels?, upgrades?:
index[]}`, where each `CommandEvent` is the engine's serde output plus
`unit`/`upgrade` indices. An `Estimate` with NaN seconds arrives as
`{"secs": null}`.

The Rust side keeps the logic in `swarm_wasm::core` (plain Rust, tested
natively); `bindings.rs` is a wasm32-only `#[wasm_bindgen]` shell over it.
