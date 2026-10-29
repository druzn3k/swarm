// Port of services/command.coffee: Commands, the player actions. Each
// successful command emits a 'command' event, which StatisticsListener and
// AchievementsListener (in that order) react to. Each command also stores an
// undo state first.
//
// Dropped from the old engine: loginApi.saveCommand (server backend),
// convertCrystal (mtx).
import * as _ from "./lodash";
import Decimal from "decimal.js";
import { assert } from "./util";
import type { Game } from "./game";
import type { Unit } from "./unit";
import type { Upgrade } from "./upgrade";
import type { EngineEventEmitter } from "./engineevents";

/** The payload of a 'command' event. Statistics deletes now/unit/upgrade after recording it. */
export interface CommandEvent {
  name: string;
  unit?: Unit;
  unitname?: string;
  upgrade?: Upgrade;
  upgradename?: string;
  now?: Date;
  elapsed?: number;
  attempt?: Decimal.Value;
  num?: Decimal.Value;
  twinnum?: Decimal.Value;
  percent?: Decimal.Value;
  ui?: string;
  [key: string]: any;
}

export interface UndoState {
  state: string;
  date: Date;
  isRedo?: boolean;
}

export class Commands {
  _undo?: UndoState;

  constructor(public game: Game, public events: EngineEventEmitter) {}

  _setUndo(opts: { isRedo?: boolean } = {}): void {
    this._undo = _.extend({}, opts, {
      state: this.game.session.exportSave!() as string,
      date: this.game.now,
    });
  }

  /** Restore the state before the last command. Undoing again redoes it. */
  undo(): void {
    if (!this._undo?.state) {
      throw new Error("no undostate available");
    }
    const state = this._undo.state;
    this._setUndo({ isRedo: true });
    this.game.importSave(state, false);
  }

  _emit(name: string, params: any): void {
    assert(params.name == null, "command has a name already?");
    params.name = name;
    this.events.emit("command", params as CommandEvent);
  }

  buyUnit(opts: { unit: Unit; num?: Decimal.Value; ui?: string }): void {
    this._setUndo();
    const unit = opts.unit;
    const num = opts.num;
    const bought = unit.buy(num);
    this._emit("buyUnit", {
      unit: unit,
      // names are included for easier jsonification
      unitname: unit.name,
      now: unit.game.now,
      elapsed: unit.game.elapsedStartMillis(),
      attempt: num,
      num: bought.num,
      twinnum: bought.twinnum,
      ui: opts.ui,
    });
  }

  buyMaxUnit(opts: { unit: Unit; percent?: Decimal.Value; ui?: string }): void {
    this._setUndo();
    const unit = opts.unit;
    const bought = unit.buyMax(opts.percent);
    this._emit("buyMaxUnit", {
      unit: unit,
      unitname: unit.name,
      now: unit.game.now,
      elapsed: unit.game.elapsedStartMillis(),
      num: bought.num,
      twinnum: bought.twinnum,
      percent: opts.percent,
      ui: opts.ui,
    });
  }

  buyUpgrade(opts: { upgrade: Upgrade; num?: Decimal.Value; ui?: string }): void {
    this._setUndo();
    const upgrade = opts.upgrade;
    const num = upgrade.buy(opts.num);
    this._emit("buyUpgrade", {
      upgrade: upgrade,
      upgradename: upgrade.name,
      now: upgrade.game.now,
      elapsed: upgrade.game.elapsedStartMillis(),
      num: num,
      ui: opts.ui,
    });
  }

  buyMaxUpgrade(opts: { upgrade: Upgrade; percent?: Decimal.Value; ui?: string }): void {
    this._setUndo();
    const upgrade = opts.upgrade;
    const num = upgrade.buyMax(opts.percent);
    this._emit("buyMaxUpgrade", {
      upgrade: upgrade,
      upgradename: upgrade.name,
      now: upgrade.game.now,
      elapsed: upgrade.game.elapsedStartMillis(),
      num: num,
      percent: opts.percent,
      ui: opts.ui,
    });
  }

  /**
   * Buy max of each upgrade in `upgrades` (usually game.availableAutobuyUpgrades()).
   * Like the old engine, if one throws midway the earlier purchases are kept
   * and the final 'buyAllUpgrades' event is not emitted.
   */
  buyAllUpgrades(opts: { upgrades: Upgrade[]; percent: number }): void {
    this._setUndo();
    const upgrades = opts.upgrades;
    for (const upgrade of upgrades) {
      const num = upgrade.buyMax(opts.percent / upgrade.watchedDivisor());
      this._emit("buyMaxUpgrade", {
        upgrade: upgrade,
        upgradename: upgrade.name,
        now: upgrade.game.now,
        elapsed: upgrade.game.elapsedStartMillis(),
        num: num,
        percent: opts.percent,
        ui: "buyAllUpgrades",
      });
    }
    if (upgrades.length) {
      this._emit("buyAllUpgrades", {
        now: upgrades[0].game.now,
        elapsed: upgrades[0].game.elapsedStartMillis(),
        percent: opts.percent,
      });
    }
  }

  ascend(opts: { game?: Game } = {}): void {
    this._setUndo();
    const game = opts.game ?? this.game;
    game.ascend();
    this._emit("ascension", {
      now: game.now,
      unit: game.unit("ascension"),
      unitname: "ascension",
      num: 1,
      twinnum: 1,
      elapsed: game.elapsedStartMillis(),
    });
  }

  respec(opts: { game?: Game } = {}): void {
    this._setUndo();
    const game = opts.game ?? this.game;
    game.respec();
    this._emit("respec", {
      now: game.now,
      elapsed: game.elapsedStartMillis(),
    });
  }

  respecFree(opts: { game?: Game } = {}): void {
    this._setUndo();
    const game = opts.game ?? this.game;
    game.respecFree();
    this._emit("respec", {
      now: game.now,
      elapsed: game.elapsedStartMillis(),
    });
  }
}
