# Engine port plan

Goal: a framework-agnostic TypeScript port of the Swarm Simulator game engine
(`swarmsim-coffee/app/scripts/services/*.coffee`), behaving exactly like the
original, so a new mobile-first UI can be built on top of it.

## Ground rules

- **Parity over cleanup.** Same numbers as the old game, to the last digit.
  Same `decimal.js` version (7.1.1), same formulas, same rounding. Refactor
  only where Angular forced a shape (DI, `$rootScope` events, `$log`).
- **No framework, no DOM.** No Angular, React, `window` or `localStorage` in
  `src/`. Time, storage and randomness are passed in.
- **Data comes from `tables/`.** `src/data.ts` builds the same spreadsheet
  object the old app preloads, so both engines read identical data.
- **Saves stay compatible.** The new engine must import existing save strings
  and export saves the old game can read.
- `swarmsim-coffee/` is never modified by this work.

## Layout

```
engine/
  src/            the TypeScript engine
  oracle/         headless runner for the ORIGINAL CoffeeScript engine (test-only)
  test/           jest specs; ports of swarmsim-coffee/test/spec/services/*
  test/golden/    JSON snapshots produced by the oracle, compared against src/
```

## Phases

1. **Scaffold** — package, jest, data loading. (done)
2. **In parallel:** (done)
   - **Oracle**: run the original CoffeeScript services in Node with a tiny
     Angular DI shim, and generate golden snapshots for scripted scenarios
     (fresh game over time, buying units, buying upgrades, abilities, ascend,
     respec, max-affordable, time-to-afford, achievements, save import).
   - **Leaf modules**: `util`, `spreadsheetutil`, `parsenumber`, `seedrand`,
     `tab`, and the type tables (`UnitTypes`, `UpgradeTypes`,
     `AchievementTypes`, `effecttypes` definitions), with their specs ported.
3. **Core runtime** (done): `Effect`, `ProducerPath(s)`, `Unit`, `Upgrade`,
   `Achievement` + listener, `Cache`, `Game`, `Session` (state, save
   encode/decode), `Commands`, `Statistics`. Specs ported; golden tests pass.
4. **Review & parity hardening** (done): diff against goldens, fill gaps, document
   the public API in `README.md`.

## Out of scope (UI/platform concerns, stay with the UI layer)

PlayFab, Kongregate, remote saves, analytics, favicon, flash queue, options,
MTX/purchases, user API, feedback, timecheck.
