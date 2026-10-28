// Keeps the README's usage example honest.
import { createGame } from "../src";

test("README example", () => {
  let now = new Date("2026-01-01T00:00:00Z");
  const { game, commands, session, parseNumber } = createGame({ now: () => now });

  expect(game.unit("meat").count().toString()).toBe("35");
  const drone = game.unit("drone");
  commands.buyUnit({ unit: drone, num: parseNumber("3", drone) });
  expect(drone.count().toString()).toBe("3");

  now = new Date("2026-01-01T00:01:00Z");
  game.tick();
  expect(game.unit("meat").count().greaterThan(35)).toBe(true);

  game.save();
  const saved = session.exportSave();
  const loaded = createGame({ now: () => now, save: saved });
  expect(loaded.game.unit("drone").count().toString()).toBe("3");
});
