// ScenarioEngine adapter for the TS engine, so oracle/scenario.ts can drive it
// exactly like it drives the old engine.
import _ from "lodash";
import Decimal from "decimal.js";
import { createEventEmitter, createGame } from "../src";
import { Scenario, ScenarioEngine } from "../oracle/scenario";

export function createTsEngine(start: Scenario["start"]): ScenarioEngine {
  let millis = Date.parse(start.now);
  const listenerErrors: { event: string; error: unknown }[] = [];
  const commandLog: { [k: string]: unknown }[] = [];
  const events = createEventEmitter((event, error) => listenerErrors.push({ event, error }));
  // registered before any engine listener; copies, never mutates
  events.on("command", (cmd) => {
    commandLog.push(_.omit(cmd, ["unit", "upgrade", "upgrades"]));
  });
  const e = createGame({ now: () => new Date(millis), save: start.save, events });
  return {
    game: e.game,
    session: e.session,
    commands: e.commands,
    Decimal,
    isDecimal: (v) => v instanceof Decimal,
    parseNumber: e.parseNumber,
    tick(date: string) {
      millis = new Date(date).getTime();
      e.game.tick(new Date(millis));
    },
    runBackfill: () => e.backfill.run(e.game),
    commandLog,
    listenerErrors,
  };
}

