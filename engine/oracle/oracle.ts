// Headless runner for the ORIGINAL CoffeeScript Swarm Simulator engine.
//
// Compiles swarmsim-coffee/app/scripts/services/*.coffee with coffee-script
// 1.12.4 (the version the old app used), evaluates each file with the
// browser globals it expects (`_`, `Decimal`, `moment`, `LZString`, `math`,
// `numberformat`, `Math.seedrandom`, ...) passed in as function parameters,
// and wires the Angular services together with a tiny DI shim.
//
// Time is fully controlled: inside the coffee code, `new Date()` and
// `Date.now()` read the oracle's clock instead of the system clock.
//
// Test-only code: never imported by engine/src.
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import _ from "lodash";
import LZString from "lz-string";
import seedrandom from "seedrandom";
import { spreadsheet } from "../src/data";
import { createAngular, EventBus, Injector, Registry } from "./shim";

/* eslint-disable @typescript-eslint/no-var-requires */
const coffee: { compile(src: string, opts?: object): string } = require("coffee-script");
const DecimalBase: any = require("decimal.js");
const moment: any = require("moment");
const mathjs: any = require("mathjs");
const numberformat: any = require("swarm-numberformat");
/* eslint-enable @typescript-eslint/no-var-requires */

export const COFFEE_ROOT = path.resolve(__dirname, "../../swarmsim-coffee/app/scripts");

/** Engine service files, in dependency-agnostic order (DI resolves lazily). */
export const ENGINE_FILES = [
  "services/util.coffee",
  "services/spreadsheetutil.coffee",
  "services/seedrand.coffee",
  "services/parsenumber.coffee",
  "services/tab.coffee",
  "services/spreadsheet.coffee",
  "services/effect.coffee",
  "services/unit.coffee",
  "services/upgrade.coffee",
  "services/achievement.coffee",
  "services/game.coffee",
  "services/session.coffee",
  "services/command.coffee",
  "services/statistics.coffee",
  "services/backfill.coffee",
];

/** Values the old app defines in app.coffee / the generated env.js. */
export const OLD_VERSION = "1.1.17"; // swarmsim-coffee/package.json
export const UNIT_LIMIT = "1e100000"; // app.coffee
export const ENV = {
  // Gruntfile.js ngconstant prod env (the parts the engine reads)
  isOffline: false,
  isDebugLogged: false,
  spreadsheetKey: "v0.2",
  saveId: "v0.2",
  httpsAllowInsecure: false,
  isServerBackendEnabled: false,
  isServerFrontendEnabled: false,
};

const GLOBAL_NAMES = [
  "angular",
  "_",
  "Decimal",
  "moment",
  "LZString",
  "math",
  "numberformat",
  "Math",
  "Date",
  "window",
  "btoa",
  "atob",
  // window.name: a few util.assert calls accidentally pass the browser global `name` (always "")
  "name",
] as const;

type CompiledFile = (...globals: unknown[]) => void;
const compiledCache: { [file: string]: CompiledFile } = {};

function compiled(file: string): CompiledFile {
  if (!compiledCache[file]) {
    const filename = path.join(COFFEE_ROOT, file);
    const js = coffee.compile(fs.readFileSync(filename, "utf8"), { bare: false });
    const wrapped = `(function(${GLOBAL_NAMES.join(", ")}) {\n${js}\n})`;
    compiledCache[file] = vm.runInThisContext(wrapped, { filename: filename + ".js" });
  }
  return compiledCache[file];
}

/** A controllable clock. */
export class Clock {
  constructor(public millis: number) {}
  set(date: Date | number | string) {
    this.millis = new Date(date).getTime();
  }
  date(): Date {
    return new Date(this.millis);
  }
}

/** A Date class whose zero-arg constructor and now() read `clock`. */
function makeDateClass(clock: Clock): DateConstructor {
  class OracleDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.millis);
      else super(...(args as [any]));
    }
    static now() {
      return clock.millis;
    }
  }
  // calling Date() without `new` returns a string; nothing in the engine does that.
  return OracleDate as unknown as DateConstructor;
}

export function silentLog() {
  const noop = () => {};
  return { debug: noop, info: noop, log: noop, warn: noop, error: noop };
}

class MemoryStorage {
  private data: { [k: string]: string } = {};
  getItem(k: string) {
    return k in this.data ? this.data[k] : null;
  }
  setItem(k: string, v: unknown) {
    this.data[k] = String(v);
  }
  removeItem(k: string) {
    delete this.data[k];
  }
}

export interface OracleOptions {
  /** wall-clock time the game starts at. Default 2020-01-01T00:00:00Z */
  now?: Date | string | number;
  /** an exported save string to import, like the options-screen import */
  save?: string;
  /** spreadsheet data; defaults to engine/src/data.ts spreadsheet() */
  spreadsheet?: unknown;
}

export const DEFAULT_START = "2020-01-01T00:00:00.000Z";

export interface Oracle {
  injector: Injector;
  get(name: string): any;
  game: any;
  session: any;
  commands: any;
  statistics: any;
  achievementslistener: any;
  parseNumber: (value: unknown, unit?: any) => any;
  rootScope: EventBus;
  /** every 'command' event emitted, as plain copies (without unit/upgrade object refs) */
  commandLog: { [k: string]: unknown }[];
  clock: Clock;
  Decimal: any;
  /** advance the clock and tick the game there */
  tick(date: Date | string | number): void;
}

export function createOracle(opts: OracleOptions = {}): Oracle {
  const clock = new Clock(new Date(opts.now ?? DEFAULT_START).getTime());
  const OracleDate = makeDateClass(clock);
  // a private Decimal constructor, so nothing else can change its config
  const Decimal = DecimalBase.clone();
  const OracleMath = Object.assign(Object.create(Math), { seedrandom });
  const window = {
    location: { search: "", host: "localhost", protocol: "https:" },
    Decimal,
  };
  const registry: Registry = { recipes: {} };
  const angular = createAngular(registry);
  const globals: { [k in (typeof GLOBAL_NAMES)[number]]: unknown } = {
    angular,
    _,
    Decimal,
    moment,
    LZString,
    math: mathjs,
    numberformat,
    Math: OracleMath,
    Date: OracleDate,
    window,
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    name: "",
  };

  const rootScope = new EventBus();
  const commandLog: { [k: string]: unknown }[] = [];
  // registered before any engine listener; copies, never mutates
  rootScope.$on("command", (_event: unknown, cmd: { [k: string]: unknown }) => {
    commandLog.push(_.omit(cmd, ["unit", "upgrade", "upgrades"]));
  });
  const app = angular.module("swarmApp", []);
  // ---- stubs for app.coffee / env.js / platform services ----
  app.value("$log", silentLog());
  app.value("$rootScope", rootScope);
  app.value("$timeout", Object.assign((fn: Function) => fn(), { cancel: () => {} }));
  app.value("$animate", {});
  app.value("$q", {});
  app.value("$location", { search: () => ({}), path: () => "/", protocol: () => "https" });
  app.value("$filter", (name: string) => {
    const filterName = `${name}Filter`;
    if (injector.has(filterName)) return injector.get(filterName);
    return (x: unknown) => x;
  });
  app.value("env", ENV);
  app.value("version", OLD_VERSION);
  app.value("UNIT_LIMIT", UNIT_LIMIT);
  app.value("storage", new MemoryStorage());
  app.value("isKongregate", () => false);
  app.value("kongregate", { reportStats: () => {}, isKongregate: () => false });
  app.value("loginApi", { saveCommand: () => {} });
  app.value("mtx", {
    convert: () => {
      throw new Error("oracle: mtx not supported");
    },
  });
  // filters/bignum.coffee (only the parts parseNumber needs)
  app.constant("numberSuffixesShort", numberformat.Formats.standard.suffixGroups.short);
  app.constant("numberSuffixesLong", numberformat.Formats.standard.suffixGroups.full);
  app.value("spreadsheetPreload-v0.2", opts.spreadsheet ?? spreadsheet());

  const order = GLOBAL_NAMES.map((n) => globals[n]);
  for (const file of ENGINE_FILES) compiled(file)(...order);

  const injector = new Injector(registry);
  // Same instantiation order as the real app's HeaderCtrl: statistics before
  // achievementslistener, so 'command' listeners update statistics first.
  const session = injector.get("session");
  const game = injector.get("game");
  const statistics = injector.get("statistics");
  const achievementslistener = injector.get("achievementslistener");
  const commands = injector.get("commands");
  const parseNumber = injector.get("parseNumber");

  // LoadSaveCtrl: no stored save -> game.reset(true); or import; then backfill.
  if (opts.save != null) {
    game.importSave(opts.save, true);
  } else {
    game.reset(true);
  }
  injector.get("backfill").run(game);

  return {
    injector,
    get: (name: string) => injector.get(name),
    game,
    session,
    commands,
    statistics,
    achievementslistener,
    parseNumber,
    rootScope,
    commandLog,
    clock,
    Decimal,
    tick(date) {
      clock.set(date);
      game.tick(new OracleDate(clock.millis));
    },
  };
}
