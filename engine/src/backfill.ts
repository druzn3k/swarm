// Port of services/backfill.coffee: fix up old/broken save data at load time.
import Decimal from "decimal.js";
import type { Game } from "./game";

export class Backfill {
  run(game: Game): void {
    // grant mutagen for old saves, created before mutagen existed
    (() => {
      const premutagen = game.unit("premutagen");
      const ascension = game.unit("ascension");
      const hatchery = game.upgrade("hatchery");
      const expansion = game.upgrade("expansion");
      const minlevelHatch = game.unit("invisiblehatchery").stat("random.minlevel.hatchery");
      const minlevelExpo = game.unit("invisiblehatchery").stat("random.minlevel.expansion");
      // at minlevel hatcheries/expos, premutagen is always granted. if it wasn't - no ascensions and no premutagen -
      // this must be an old save, they got the upgrades before mutagen existed.
      if (
        premutagen.count().isZero() &&
        ascension.count().isZero() &&
        (hatchery.count().greaterThanOrEqualTo(minlevelHatch) || expansion.count().greaterThanOrEqualTo(minlevelExpo))
      ) {
        // backfilling mutagen for old save
        for (const up of [hatchery, expansion]) {
          // toNumber is safe; old saves won't exceed 1e300 expansions/hatcheries
          const n = up.count().toNumber();
          for (let i = 0; i < n; i++) {
            for (const e of up.effect) {
              e.onBuy(new Decimal(i + 1));
            }
          }
        }
      }
    })();

    // grant free respecs for all saves created before respecs existed
    (() => {
      const respec = game.unit("freeRespec");
      if (!respec.isCountInitialized()) {
        respec._setCount(respec.unittype.init);
      }
    })();

    // restore lost ascension count. https://github.com/erosson/swarm/issues/431
    (() => {
      const ascension = game.unit("ascension");
      const stats = ascension.statistics();
      if (new Decimal(stats?.num ?? 0).greaterThan(ascension.count()) && ascension.count().isZero()) {
        ascension._setCount(stats.num);
      }
    })();

    // apply all new achievements. https://github.com/swarmsim/swarm/issues/701
    // On second thought, wait for them to buy a unit so achievement popups appear
    //achievementslistener.achieveUnit()
  }
}
