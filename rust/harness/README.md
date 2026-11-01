# Dual-engine parity harness: scenario corpus

This directory holds the TS side of the harness described in `rust/PLAN.md` §6.

| Path | What |
|---|---|
| `corpus/<name>.json` | 60 scenarios (input). |
| `expected/<name>.json` | The TS engine's output for each scenario: exactly what `engine/oracle/run.ts corpus/<name>.json` prints. Rust tests can diff against it without Node. |
| `manifest.json` | The sha256 of every corpus/expected file and of the generator inputs. `engine/test/harness-corpus.test.ts` uses it to detect a stale corpus. |

Regenerate everything with `pnpm --filter @swarmsim/engine oracle:corpus` (about 4 minutes; `engine/oracle/gen-corpus.ts`).
Do not edit these files by hand. The jest staleness test fails when any generator input changes: `engine/src`, the
static tables, the fixtures, or `oracle/{gen-corpus,scenario,scenarios,generate,run}.ts` and `test/tsengine.ts`.

Run one scenario through the TS engine:

```sh
pnpm --filter @swarmsim/engine oracle:run -- rust/harness/corpus/progress-01-1m.json    # path relative to engine/
pnpm --filter @swarmsim/engine oracle:run -- - < scenario.json                         # stdin
pnpm --filter @swarmsim/engine oracle:run -- scenario.json --engine oracle             # the original CoffeeScript engine
```

Because `pnpm --filter` runs in `engine/`, give absolute paths or paths relative to `engine/`. You can also call it directly:
`cd engine && npx ts-node --transpile-only oracle/run.ts <file>`. Start-up takes about 2 s. `--engine oracle` runs
the original 1.1.17 CoffeeScript engine headlessly (`oracle/oracle.ts`). It produces byte-identical output for all
12 goldens, and for all 60 corpus scenarios it produces output byte-identical to `expected/`. That makes `expected/` the original game's behaviour, not just the TS port's. It is about as fast as the TS engine.

## Corpus contents

- `fixture-*` (9 scenarios): every fixture save. These come from `engine/test/fixtures/session-saves.json` (v0.2, v1,
  3 publictest saves, whitespace), `swarmsim-ts/src/persist.test.json` (`exports[0..1]` and `format[0]`, whose body is
  `null`), and `SAVE_V1` (the same string as session `v1`, deduplicated). Each scenario starts a fresh game at the
  save's last `date.reified` + 1 h (T0 if the save does not import). Step 0 is `importSave`. The 3 publictest saves
  fail with `blacklisted save version`, and `persist-format0` fails with `Cannot read properties of null (reading 'date')`.
  These scenarios then play a fresh game.
- `progress-NN-<t>` (27 scenarios): saves from one deterministic auto-player run that starts from a fresh game at T0 =
  2020-01-01. Each round is tick, `buyAllUpgrades`, mutagen-upgrade unlocks, and `buyMaxUnit` 50% for every unit in
  the mutagen, energy, territory and meat tabs. Saves are taken at t = 1 min to 30 days. They are loaded through
  `start.save` (createGame import + backfill) with an offline gap that cycles through 0 s, 10 s, 1 h, 8 h, 2 d.
- `ascension-N-*` (24 scenarios): the same run continues through 5 natural ascensions. Each ascension happens as soon
  as it is affordable, but at least 2 days after the previous one. Saves are taken right after each ascension
  (`-0-just-ascended`), then 1 min, 1 h and 1 d later, and just before the next ascension.
- Every scenario has 200 steps. The fixture scenarios count `importSave` among them. The steps come from a seeded
  (`seedrandom("swarm-harness:<name>")`) random auto-player that plans on a live TS engine. It mixes:
  - `tick` of 0.1 s to 3 days (log-uniform, so it covers offline catch-up);
  - `buyMaxUnit` per tab (`buyTab`), `buyAllUpgrades`, `buyUnit`, `buyMaxUnit`, `buyUpgrade` and `buyMaxUpgrade` on
    random visible units and upgrades;
  - abilities (`buyUpgrade` of larvarush, meatrush, territoryrush, clonelarvae, swarmwarp). Swarmwarp is forced to
    appear at least twice. It succeeds 255 times across the corpus;
  - `ascend` (22 succeed), `respec`, `respecFree`, `undo`;
  - queries (`estimateUnit`, `estimateUpgrade`, `ascendInfo`, `countInSecs`, `effects`, `parseNumber`, `save`).

  Many steps fail on purpose: unaffordable buys, invisible units, ascending too early. Error strings are part of the
  expected output.
- **Snapshot frequency (reduced from the plan).** A `full` snapshot is about 45 KB, so one after every step would come
  to about 0.5 GB. Instead the corpus takes:
  - `full` after steps 99 and 199, and after every `ascend`/`respec` that succeeds;
  - `counts` after every 20th step;
  - nothing otherwise.

  Every step still records `now`, `result`, `error` and `commands`. Lockstep mode can call `exportSave` itself.

## Scenario file (input)

```jsonc
{
 "name": "progress-01-1m",
 "description": "...",
 "start": { "now": "2020-01-01T00:01:00.000Z", "save": "MS4xLjE3|Q2hlYXRlciA6KAoK..." },  // save optional
 "prefixSteps": [ /* optional: Step[] replayed (snapshots taken and discarded) before recording; unused in the corpus */ ],
 "steps": [ { "action": { "do": "tick", "at": "2020-01-01T00:01:02.000Z" } },
            { "action": { "do": "buyAllUpgrades" }, "snapshot": "counts" } ]
}
```

`start`: create a game whose clock reads `now` (ISO, ms precision). With `save`, import it through `createGame`, then
run backfill. An import failure here throws, so the whole run fails. Without `save`, start a new game, then run
backfill. The engine clock is a variable: everything that reads "now" inside the engine (save dates, `date.started`,
…) reads it. Only `tick` moves it.

`Step.snapshot` is `"none" | "counts" | "full"`, and absent means none. The snapshot is taken **after** the action,
even when the action threw.

### Actions

`Num` means a JSON number or a decimal string (`"1e30"`). The engine builds a Decimal from it with `new Decimal(x)`.
A JSON number goes through the JS double, so `1e21` and `"1e21"` are equal. "Cmd" means the action goes through
`commands.*`, which emits a `command` event (see Commands below) and sets the undo state *before* attempting the
purchase.

| `do` | params | effect | `result` |
|---|---|---|---|
| `tick` | `at: ISO` | Sets the engine clock to `at`, then `game.tick(at)`. If `at` < `game.now` by ≤ 120 s, `game.now` stays, **but the clock still moves back**. More than 120 s throws `tick tried to go back in time. System clock problem?,Wed Jan 01 2020 00:02:00 GMT+0000 (Coordinated Universal Time),Wed Jan 01 2020 00:00:00 GMT+0000 (Coordinated Universal Time),120001` (`game.now`, `at`, diff ms; an assert message, see Errors). | — |
| `buyUnit` | `unit, num: Num` | Cmd `buyUnit({unit, num: Decimal(num)})`. Buys `min(num, maxCostMet)` (more than affordable is not an error). | — |
| `buyMaxUnit` | `unit, percent: number` | Cmd `buyMaxUnit`. | — |
| `buyUpgrade` | `upgrade, num: Num` | Cmd `buyUpgrade`. Throws `We require more resources` if not even 1 is affordable, else `Cannot buy that upgrade` if invisible, else buys `min(num, maxCostMet)`. Abilities are upgrades (`swarmwarp` adds to `skippedMillis`). | — |
| `buyMaxUpgrade` | `upgrade, percent: number` | Cmd `buyMaxUpgrade`. | — |
| `buyAllUpgrades` | `percent?: number` | `ups = game.availableAutobuyUpgrades(percent)` (no argument when absent). If `ups` is non-empty, Cmd `buyAllUpgrades({upgrades: ups, percent: percent ?? 1})`. Each upgrade is bought with `buyMax(percent / watchedDivisor)`. If one throws midway, earlier purchases are kept and the final event is not emitted. | `{"upgrades": [names]}`: the list computed **before** buying, even when empty, and even when the step then throws (the result is lost: see Errors). |
| `ascend` | | Cmd `ascend`. Throws `We require more resources (ascension cost)` when `ascendCostPercent < 1`. | — |
| `respec` | | Cmd `respec`. Throws `We require more resources`. | — |
| `respecFree` | | Cmd `respecFree`. It needs `freeRespec > 0` and succeeds even when nothing was spent. A new game has free respecs, so this usually succeeds. It emits a command named `respec`. | — |
| `undo` | | `commands.undo()`: re-imports the save taken before the last command, non-transiently. An undo directly after an undo is a redo. Throws `no undostate available`. Emits no command. | — |
| `setUnitCount` | `unit, val: Num` | Cheat: `game.withSave(() => unit._setCount(val))`. Not used in the corpus, but used in goldens. | — |
| `setUpgradeCount` | `upgrade, val: Num` | Cheat, the same for an upgrade. | — |
| `importSave` | `save: string, transient?: bool (default true)` | `game.importSave(save, transient)`, then `backfill.run(game)`. | — |
| `exportSave` | | | `session.exportSave()` (string): the cached export. Right after an import, this is the imported string verbatim. |
| `save` | | `game.save()` | `session.exportSave()`: the freshly encoded v1 save (`<base64 version>\|Q2hlYXRlciA6KAoK<lz base64>`). |
| `estimateUnit` | `unit, target: Num` | Passes `target` **raw** (not a Decimal) to `unit.estimateSecsUntilEarned`. | A Decimal (`"Infinity"` when never), or the **JS number 0** when the target is already met. |
| `estimateUpgrade` | `upgrade` | | `{"val": Decimal\|number, "unit": unitName\|null, "cacheSafe": …}` |
| `ascendInfo` | | | See ascendInfo below. |
| `effects` | `upgrade?` or `unit?` | | `[{type, unit, upgrade, stat, power, output, outputNext, bank, cap}]` for each effect of the parent. `type` is the effect type name. `unit`, `upgrade` and `stat` are names or null. The other 5 fields are each wrapped in `attempt`. |
| `parseNumber` | `input: string, unit?` | `parseNumber(input, unit)` | A Decimal. On a parse error it returns undefined, so **the `result` key is absent**. |
| `countInSecs` | `unit, secs: Num` | No state change. | `unit._countInSecsFromNow(Decimal(secs))` |

An unknown unit or upgrade name throws `oracle: no such unit <name>` / `oracle: no such upgrade <name>`.

## Output (`run.ts` / `expected/*.json`)

The output is `JSON.stringify(result, null, 1) + "\n"`: one-space indentation, `": "` after keys, `[]`/`{}` for empty
containers, and LF line endings. Strings are escaped as in JSON.stringify: `"`, `\\`, `\b \f \n \r \t`, other control
characters as `\u00XX` (lowercase hex), lone surrogates as `\udXXX`. Non-ASCII is left as is. Numbers use ECMAScript
`Number#toString`: `0.1`, `1e+21`, `1e-7`, `123456789` (integers below 1e21 plainly), and `-0` prints as `0`. Ryu or
serde_json formatting differs, for example `1e21` vs `1e+21`.

```jsonc
{
 "name": …, "description": …,                    // copied from the scenario
 "oldEngineVersion": "swarmsim-coffee 1.1.17",  // constant, even for --engine ts
 "start": …,                                     // copied verbatim (same key order as the input)
 "prefixSteps": […],                             // only if the scenario had a non-empty prefixSteps (copied verbatim)
 "initial": <full snapshot>,                     // after start (and after prefixSteps)
 "steps": [ StepResult … ]
}
```

A StepResult has these keys, in this order, and absent keys are omitted:

1. `action`: the input action object, verbatim. Its keys keep the input file's order, and it is **not** passed
   through `ser`.
2. `now`: `game.now.toISOString()` after the action (and after the snapshot queries).
3. `result`: `ser(return value)`. It is omitted when the action returns undefined, and also when it threw.
4. `error`: the thrown error's `message`. Exceptions thrown by event listeners are swallowed by the emitter and
   appended as `listener <event>: <message>`, all joined with `"; "`. (None occur in the corpus.)
5. `commands`: the `command` events emitted during the step, as `ser`-ed copies. Omitted when there are none.
6. `snapshot`: the snapshot **data** (not its kind). Omitted for none.

### `ser` (all result/snapshot values)

| JS value | JSON |
|---|---|
| `undefined`, `null` | `null` (inside objects, `undefined` members and functions are **dropped** instead) |
| Decimal | `Decimal#toString()` as a string. decimal.js 7.1.1 defaults apply: `toExpPos` 21, `toExpNeg` -7, and the string is exact, not rounded to 20 digits. Examples: `"35"`, `"181027177.7035388471"`, `"1e+21"`, `"1.2345e+21"`, `"1e-7"`, `"0.000001"`, `"NaN"`, `"Infinity"`, `"-Infinity"`. **Negative zero prints `"0"`.** |
| finite number | a JSON number (see above) |
| non-finite number | `{"$number": "Infinity"}`, `{"$number": "-Infinity"}`, `{"$number": "NaN"}` |
| string, boolean | as is |
| Date | `toISOString()`: `YYYY-MM-DDTHH:mm:ss.sssZ`, always 3 ms digits, always UTC. |
| array | element-wise |
| object | `Object.keys` order: insertion order, except that integer-like keys come first in ascending order (none occur in practice) |

So a Decimal Infinity is the **string** `"Infinity"` (for example `maxCostMet` of meat), while a JS-number Infinity is
`{"$number":"Infinity"}` (for example an estimate that never arrives, or `ascendCostDurationSecs`). Rust must remember
which side of the JS boundary each field came from. The tables below give the type of each field.

`attempt(f)` means: the value of `f()`, or `{"error": message}` if it threw.

### Snapshots

`counts`: `{"units": {<unitname>: {"count": D, "velocity": D}}}` for every unit in unitlist order (data order).

`full`:

```jsonc
{
 "units":    { <unitname>: UnitSnap },        // every unit, unitlist order
 "upgrades": { <upgradename>: UpgradeSnap },  // every upgrade, upgradelist order
 "achievements": { "earned": { <name>: earnedAtMillisElapsed (number) }, "points": number },  // earned only, achievementlist order
 "ascendInfo": AscendInfo,
 "state": JSON.parse(session.exportJson())    // the raw session state, see below
}
```

The queries run in this order: all units, all upgrades, achievements, ascendInfo, state. Order matters because
visibility is sticky, and `isVisible()` caches true until ascend, respec or import.

UnitSnap: `count: D, velocity: D, isVisible: bool`. When visible, these follow:

- `eachCost: Cost[]`, `maxCostMet: attempt D`, `maxCostMet25: attempt D` (`maxCostMet(0.25)`), `isCostMet: attempt bool`;
- `isBuyButtonVisible: bool`, `isBuyable: attempt bool`, `twinMult: D`, `capValue: D | null`;
- `eachProduction: {unit: D}`, `totalProduction: {unit: D}`, `stats: {stat: D}`, `suffix: string`.

UpgradeSnap: `count: D, isVisible: bool, totalCost: Cost[], isUpgradable: attempt bool`. When visible, these follow:

- `maxCostMet: attempt D`, `isCostMet: attempt bool`, `isBuyable: attempt bool`, `isAutobuyable: bool`;
- `isNewlyUpgradable: attempt bool`, `costMetPercent: attempt D` (often `"NaN"`);
- `estimateSecsUntilBuyable: attempt {val: D|number, unit: name|null, cacheSafe}`.

Cost: `{"unit": name, "val": D}`, plus `"factor": D` after `val` only when the cost has a factor (upgrade costs do).

AscendInfo (each field is wrapped in `attempt`):

- `ascendEnergySpent: D`, `ascendCost: D`, `ascendCostPercent: D`;
- `ascendCostDurationSecs: number | null`;
- `respecCost: D`, `respecCostPercent: D`, `isRespecCostMet: bool`, `respecSpent: D`.

`ascendCostDurationSecs` is null when the cost exceeds the energy cap. When energy already covers the cost, it is
`{"error": "energy.estimateSecsUntilEarned(...).toNumber is not a function"}`, a TypeError quirk kept from the old
engine.

`state` is serialised by `JSON.stringify`, **not** `ser`, so the Decimal rules differ there:

- Decimals use `toJSON`, so negative zero is `"-0"` (`respecEnergy` can be `"-1253203"`, and a negative zero
  appears as `"-0"`).
- Dates are ISO.
- Key order is the session state's insertion order: `unittypes`, `date` (`started`, `restarted`, `saved`, `reified`,
  `closed`, then `addUnitTimed-<unit>`), `options`, `upgrades`, `statistics`, `achievements`, `watched`, `skippedMillis`,
  `version`, ….

The exact key set and order depend on how the state was built. An imported save keeps its own order and extra
keys, for example `id`, `heartbeatId`, `achievementsShown`, and `date.loaded`. Copy the order from the legacy reader
and `expected/` rather than assuming it. Units in `unittypes` and upgrades are in data order for a new game, but in
the imported save's order after an import.

### Commands

These are the `command` event payloads, with the object refs `unit`, `upgrade` and `upgrades` removed and
`undefined` members (`ui` when not given) dropped. The key order is fixed per command, and `name` always comes last:

| name | keys | notes |
|---|---|---|
| `buyUnit` | `unitname, now, elapsed, attempt, num, twinnum, name` | `attempt` is the requested Decimal as a string. `num`/`twinnum` are what was bought. |
| `buyMaxUnit` | `unitname, now, elapsed, num, twinnum, percent, name` | `percent` is the action's JS number. |
| `buyUpgrade` | `upgradename, now, elapsed, num, name` | |
| `buyMaxUpgrade` | `upgradename, now, elapsed, num, percent, ui?, name` | Inside `buyAllUpgrades`, one per upgrade, with `percent` = the buy-all percent (not divided) and `ui: "buyAllUpgrades"`. |
| `buyAllUpgrades` | `now, elapsed, percent, name` | Emitted after the per-upgrade events. |
| `ascension` | `now, unitname ("ascension"), num: 1, twinnum: 1, elapsed, name` | `num` and `twinnum` are **JS numbers** here, not Decimal strings. |
| `respec` | `now, elapsed, name` | Emitted by both `respec` and `respecFree`. |

`now` is `game.now` (ISO). `elapsed` is `now - date.started` in ms (a JS number) and excludes `skippedMillis`.
A command that throws emits nothing. Its undo state is still set, though.

## Errors and other surprises (read before implementing)

- An error is the thrown JS `message`, and the comparator treats it as exact. Most messages come from the engine:
  `We require more resources`, `We require more resources (ascension cost)`, `Cannot buy that unit`,
  `Cannot buy that upgrade`, `no undostate available`, `blacklisted save version`.
- **Assert messages** (`util.assert(cond, ...args)`) are the args joined like `Array#toString`. The joiner is `,`;
  `undefined` and `null` become empty, objects become `[object Object]`, and Dates use `Date#toString`. Example from
  the corpus: `zero cost from sumCost, yet cost was met?,centipedetwin,,[object Object]` (23 occurrences, from
  `buyMaxUpgrade`/`buyAllUpgrades` at percent < 1).
- **JS runtime errors leak through**: `persist-format0` gives `Cannot read properties of null (reading 'date')`. Rust
  has to map its "save body is null" case to this exact string, or the comparator has to whitelist it.
- `buyAllUpgrades` with a throwing upgrade: purchases before it are kept and their `buyMaxUpgrade` events are logged,
  but the final `buyAllUpgrades` event is not. Because the action threw, the step has `error` and no `result`.
- `buyUnit`/`buyUpgrade` with more than is affordable succeed and buy the max. But `buyMaxUpgrade` (and
  `buyAllUpgrades`) at percent < 1, when 1 is affordable but not with `percent` of the resources, computes num = 0
  and then trips the `zero cost from sumCost` assert above; a cost subtracted before the assert stays subtracted.
- Every Cmd sets the undo state before acting, so a failed buy replaces the undo state. `undo` re-imports
  (non-transient), and an `undo` right after an `undo` redoes.
- `estimateUnit` returns the number `0` (not `"0"`) when already met, and the Decimal string `"Infinity"` when never.
  `estimateUpgrade.val` is a Decimal string too. JS-number fields (`ascendCostDurationSecs`, `elapsed`,
  `earnedAtMillisElapsed`, `cacheSafe`) use `{"$number": …}` for non-finite values.
- `tick` backwards by ≤ 120 s keeps `game.now`, but the engine clock still moves (the corpus only ticks forward).
- `now` in a StepResult is `game.now`, which only `tick` moves. After `start.save`, game.now is the start time.
- The planner's own queries (`isVisible` etc. between steps) are **not** part of the scenario. Replays may therefore
  differ from the plan, for example a planned buy that fails. That is fine: `expected/` comes from the replay.
- A visible upgrade's `estimateSecsUntilBuyable` uses a periodic cache that the clock clears every 3 s. Snapshot
  values can be up to 3 s stale (see `engine/test/differential.test.ts`).
