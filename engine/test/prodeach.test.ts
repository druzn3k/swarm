// ProducerPath.prodEach caches each path's prefixes (shared by many paths).
// Whatever order paths are asked in, each must get the value it gets when
// worked out alone, link by link from an empty cache.
import * as fs from "fs";
import * as path from "path";
import { createGame } from "../src";

describe("ProducerPath.prodEach prefix cache", () => {
  it("gives every path the value it has when computed alone", () => {
    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "golden/midgame-save.json"), "utf8"));
    const { game } = createGame({ save: golden.start.save, now: () => new Date(golden.start.now) });
    const paths = game.unitlist().flatMap((u: any) => u._producerPath.list);
    expect(paths.length).toBeGreaterThan(100);
    const alone = new Map<string, string>();
    for (const p of paths) {
      game.cache.producerPathProdEach = {};
      alone.set(p.name, p.prodEach().toString());
    }
    // shared prefixes cached; shortest first, longest first, and as listed
    const orders = [
      [...paths].sort((a, b) => a.degree() - b.degree()),
      [...paths].sort((a, b) => b.degree() - a.degree()),
      paths,
    ];
    for (const order of orders) {
      game.cache.producerPathProdEach = {};
      for (const p of order) expect(p.prodEach().toString()).toBe(alone.get(p.name));
    }
  });
});
