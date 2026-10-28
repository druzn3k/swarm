// Port of services/statistics.coffee: StatisticsListener. Records per-unit
// and per-upgrade purchase statistics from 'command' events. Unit achievements
// count statistics' twinnum, so this must listen before AchievementsListener.
import Decimal from "decimal.js";
import type { Session } from "./session";
import type { CommandEvent } from "./command";
import type { EngineEventEmitter } from "./engineevents";

export class StatisticsListener {
  constructor(
    public session: Pick<Session, "state" | "save">,
    public scope: EngineEventEmitter,
    /** called when a unit's/upgrade's statistics were corrupt and got reset (the old engine logged it) */
    public onWarn: (message: string, ...args: any[]) => void = () => {}
  ) {
    this._init();
  }

  _init(): void {
    const stats = (this.session.state.statistics ??= {});
    stats.byUnit ??= {};
    stats.byUpgrade ??= {};
    stats.clicks ??= 0;
  }

  push(cmd: CommandEvent): void {
    const stats = this.session.state.statistics;
    stats.clicks += 1;
    if (cmd.unitname != null) {
      let ustats = stats.byUnit[cmd.unitname];
      if (ustats == null) {
        ustats = stats.byUnit[cmd.unitname] = { clicks: 0, num: 0, twinnum: 0, elapsedFirst: cmd.elapsed };
        this.scope.emit("buyFirst", cmd);
      }
      ustats.clicks += 1;
      try {
        ustats.num = new Decimal(ustats.num).plus(cmd.num as Decimal.Value);
        ustats.twinnum = new Decimal(ustats.twinnum).plus(cmd.twinnum as Decimal.Value);
      } catch (e) {
        this.onWarn("statistics corrupt for unit, resetting", cmd.unitname, ustats, e);
        ustats.num = new Decimal(cmd.num as Decimal.Value);
        ustats.twinnum = new Decimal(cmd.twinnum as Decimal.Value);
      }
    }
    if (cmd.upgradename != null) {
      let ustats = stats.byUpgrade[cmd.upgradename];
      if (ustats == null) {
        ustats = stats.byUpgrade[cmd.upgradename] = { clicks: 0, num: 0, elapsedFirst: cmd.elapsed };
        this.scope.emit("buyFirst", cmd);
      }
      ustats.clicks += 1;
      try {
        ustats.num = new Decimal(ustats.num).plus(cmd.num as Decimal.Value);
      } catch (e) {
        this.onWarn("statistics corrupt for upgrade, resetting", cmd.upgradename, ustats, e);
        ustats.num = new Decimal(cmd.num as Decimal.Value);
      }
    }
    this.session.save(); //TODO session is saved twice for every command, kind of lame
    delete cmd.now;
    delete cmd.unit;
    delete cmd.upgrade;
  }

  listen(scope: EngineEventEmitter): void {
    scope.on("reset", () => {
      this._init();
    });
    scope.on("command", (cmd) => {
      this.push(cmd);
    });
  }
}
