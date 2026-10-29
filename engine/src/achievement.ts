// Port of the runtime half of services/achievement.coffee: Achievement and
// AchievementsListener. (AchievementTypes lives in ./achievementtypes.)
import * as _ from "./lodash";
import Decimal from "decimal.js";
import { assert } from "./util";
import type { Game } from "./game";
import type { EngineEventEmitter } from "./engineevents";

export class Achievement {
  name: string;
  requires!: any[];
  visible!: any[];

  constructor(public game: Game, public type: any) {
    this.name = this.type.name;
  }

  _init(): void {
    this.game.session.state.achievements ??= {};
    this.requires = _.map(this.type.requires, (require0) => {
      const require = _.clone(require0);
      if (require.unittype) {
        require.resource = require.unit = assert(this.game.unit(require.unittype));
      }
      if (require.upgradetype) {
        require.resource = require.upgrade = assert(this.game.upgrade(require.upgradetype));
      }
      assert(!(require.unit && require.upgrade), "achievement requirement can't have both unit and upgrade", this.name);
      return require;
    });
    assert(this.requires.length <= 1, "multiple achievement requirements not yet supported", this.name);
    this.visible = _.map(this.type.visible, (visible0) => {
      const visible = _.clone(visible0);
      if (visible.unittype) {
        visible.resource = visible.unit = assert(this.game.unit(visible.unittype));
      }
      if (visible.upgradetype) {
        visible.resource = visible.upgrade = assert(this.game.upgrade(visible.upgradetype));
      }
      assert(!!visible.unit !== !!visible.upgrade, "achievement visiblity must have unit xor upgrade", this.name);
      return visible;
    });
  }

  /**
   * The description, with `$REQUIRED` replaced by the formatted requirement.
   * The old engine used the UI's 'longnum' number filter; pass your own
   * formatter (default: String).
   */
  description(format: (n: any) => string = (n) => String(n)): string {
    let desc: string = this.type.description;
    if (this.type.requires.length > 0 && (this.type.requires[0].unittype || this.type.requires[0].upgradetype)) {
      // don't apply significant figures, achievement numbers are okay as-is
      desc = desc.replace("$REQUIRED", format(this.type.requires[0].val));
    }
    return desc;
  }

  isEarned(): boolean {
    return this.game.session.state.achievements[this.name] != null;
  }

  earn(elapsed: number = this.game.elapsedStartMillis()): void {
    if (!this.isEarned()) {
      this.game.withUnreifiedSave(() => {
        this.game.session.state.achievements[this.name] = elapsed;
      });
      this.game.events?.emit("achieve", this);
    }
  }

  earnedAtMillisElapsed(): number | undefined {
    return this.game.session.state.achievements[this.name];
  }

  pointsEarned(): number {
    return this.isEarned() ? this.type.points : 0;
  }

  // invisible achievements are masked with ???s. TODO support truly hidden achievements
  isMasked(): boolean {
    return !this.isUnmasked();
  }
  isUnmasked(): boolean {
    // special case: no requirements specified == forever-masked
    // (if you'd like always-visible, a visibility of meat:0 works)
    if (this.visible.length === 0) {
      return false;
    }
    for (const visible of this.visible) {
      if (visible.resource.count().lessThan(visible.val)) {
        return false;
      }
    }
    return true;
  }

  hasProgress(): boolean {
    for (const req of this.requires) {
      if (req.resource != null) {
        return true;
      }
    }
    return false;
  }
  progressMax(): Decimal | undefined {
    // coffee: `if @hasProgress()? and @requires[0].val?` (hasProgress()? is always true)
    if (this.requires[0].val != null) {
      return new Decimal(this.requires[0].val);
    }
    return undefined;
  }
  progressVal(): Decimal | undefined {
    const req = this.requires[0];
    if (req.upgrade != null) {
      return req.upgrade.count();
    }
    if (req.unit != null) {
      if (req.unit.unittype.unbuyable) {
        return req.unit.count();
      }
      return new Decimal(req.unit.statistics().twinnum ?? 0);
    }
    return undefined;
  }
  progressPercent(): Decimal {
    return this.progressVal()!.dividedBy(this.progressMax()!);
  }
  progressOrder(): number {
    if (this.isEarned()) {
      return 2;
    }
    if (this.isMasked()) {
      return -2;
    }
    // coffee compared the Decimal to 0 with `>` (valueOf)
    if (this.hasProgress() && (this.progressMax() as any) > 0) {
      return this.progressPercent().toNumber();
    }
    return -1;
  }
}

export class AchievementsListener {
  constructor(public game: Game, public scope: EngineEventEmitter) {
    this._listen(this.scope);
  }

  achieveUnit(unitname?: string, rawcount: boolean = false): void {
    // actually checks all units
    for (const achieve of this.game.achievementlist()) {
      for (const require of achieve.requires) {
        // unit count achievement
        if (!require.event && require.unit && require.val) {
          let count: Decimal;
          if (rawcount) {
            // exceptional case, count all units, ignoring statistics
            count = require.unit.count();
          } else {
            // usually we want to ignore generators, so use statistics-count
            // statistics are added before achievement-check, fortunately
            count = new Decimal(require.unit.statistics().twinnum ?? 0);
          }
          if (count != null && count.greaterThanOrEqualTo(require.val)) {
            // requirements are 'or'ed
            achieve.earn();
          }
        }
      }
    }
  }
  achieveUpgrade(upgradename?: string): void {
    // actually checks all upgrades
    for (const achieve of this.game.achievementlist()) {
      for (const require of achieve.requires) {
        if (!require.event && require.upgrade && require.val) {
          // no upgrade-generators, so count() is safe
          const count = require.upgrade.count();
          if (count != null && count.greaterThanOrEqualTo(require.val)) {
            // requirements are 'or'ed
            achieve.earn();
          }
        }
      }
    }
  }

  _listen(scope: EngineEventEmitter): void {
    this.scope = scope;
    // Note: like the old engine, this binds the achievement objects that exist
    // now; they keep working after game._init() replaces them, since they
    // only touch game.session.state.
    for (const achieve of this.game.achievementlist()) {
      for (const require of achieve.requires) {
        if (require.event && !require.unit) {
          // trigger event once achievement
          if (require.val) {
            require.val = JSON.parse(require.val);
          }
          scope.on(require.event, (param: any) => {
            if (require.val) {
              // very simple equality validation
              const validparam = _.pick(param, _.keys(require.val));
              const valid = _.isEqual(validparam, require.val);
              if (!valid) {
                return;
              }
            }
            achieve.earn();
          });
        }
      }
    }

    scope.on("command", (cmd) => {
      if (cmd.unitname != null) {
        this.achieveUnit(cmd.unitname);
      }
      if (cmd.upgradename != null) {
        this.achieveUpgrade(cmd.upgradename);
      }
      if (cmd.name === "ascension") {
        this.achieveUnit("ascension", true);
      }
    });
  }
}
