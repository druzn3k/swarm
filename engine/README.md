# @swarmsim/engine

A framework-agnostic TypeScript port of the Swarm Simulator game engine
(`swarmsim-coffee/app/scripts/services`). No Angular, React or DOM: time,
storage and events are passed in, so any UI can sit on top.

It produces exactly the same numbers as the original CoffeeScript engine. See
[PLAN.md](PLAN.md) for how the port was done.

## Usage

```ts
import { createGame } from "@swarmsim/engine";

const { game, commands, session, events, parseNumber } = createGame({
  now: () => new Date(), // injectable clock; default is the system clock
  // storage: window.localStorage, // anything with getItem/setItem/removeItem; default in-memory
  // save: "...",                  // import a save string instead of loading/starting fresh
});

// read state (all numbers are decimal.js Decimals)
game.unit("meat").count();
game.unit("drone").velocity();          // per second
game.unit("drone").maxCostMet();        // how many you can afford

// act
const drone = game.unit("drone");
commands.buyUnit({ unit: drone, num: parseNumber("50%", drone) });
commands.buyUpgrade({ upgrade: game.upgrade("hatchery"), num: 1 });
commands.buyAllUpgrades({ upgrades: game.availableAutobuyUpgrades(), percent: 1 });
commands.undo();

// advance time (e.g. once per animation frame), then read again
game.tick();

// events: "command", "achieve", "buyFirst", "save", "reset", ...
events.on("achieve", (achievement) => { /* show a toast */ });

// saves are compatible with the old game in both directions
game.save();
const exported = session.exportSave();
```

`test/readme-example.test.ts` runs a version of this example.

## Tests

```sh
pnpm test            # typecheck + all Jest suites
TZ=Asia/Tokyo pnpm test
pnpm oracle:golden   # regenerate test/golden/*.json from the ORIGINAL engine
```

- `oracle/` runs the original CoffeeScript engine headlessly in Node (a tiny
  Angular DI shim plus an injectable clock). It is test-only.
- `test/golden/*.json` are 12 recorded play-throughs from the original engine
  (idle time, early game, undo, estimates, a real mid-game save, abilities,
  ascend/respec, random spawns, save import/export, number parsing).
  `test/golden.test.ts` replays them on the TS engine and requires
  byte-identical output.
- `test/differential.test.ts` runs extra scenarios on both engines side by side
  (catches cache and visibility timing bugs the goldens can't).
- Game data comes from `@swarmsim/tables`, decoded at build time
  (`pnpm --filter @swarmsim/tables gen:static`, see the tables README);
  `test/data.test.ts` checks it matches the tables' codecs.
- Lodash functions come one module at a time through `src/lodash.ts`
  (`import * as _ from "./lodash"`), so the app doesn't bundle all of lodash.
- The other suites are the old Jasmine service specs, ported to Jest.

## Known quirks kept on purpose

For parity, the port reproduces the original engine's behavior, including a
few bugs. Fix them only once the old game is retired, and regenerate or
update the goldens when you do:

- `parseNumber` strips only the first comma, so `"1,000,000"` doesn't parse.
- Once you have enough energy to ascend, `game.ascendCostDurationSecs()` throws
  instead of returning 0.
- `Unit.isVelocityConstant`, `Game.ignoredUpgrades` and
  `Game.unignoredUpgrades` call methods that don't exist and always throw.
- `buyAllUpgrades` can throw partway through if an earlier purchase makes a
  later one unaffordable; the earlier purchases are kept.
- Random spawn seeds use the start date's `Date#toString()`, which depends on
  the player's timezone in the old game. The port always uses the UTC form.

## Not included

Platform and UI concerns stay with the UI layer: PlayFab, Kongregate, remote
saves, analytics, purchases (MTX), options, favicon, notifications.
Moment-based helpers were dropped (`game.skipTime(num, "seconds")` replaces the moment-duration form).
