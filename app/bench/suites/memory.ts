// Memory: JS heap, DOM nodes and event listeners (Performance.getMetrics,
// after two forced garbage collections) on the meat tab, again after idling
// for the run's duration, and again after a round of route changes that ends
// back on the meat tab. Growth after idling or navigating that doesn't level
// off between runs (or with a longer --duration) points at a leak.
// No CPU throttle: it measures memory, not time.
import { collectGarbage, metrics, openPage, sleep } from "../lib";
import type { CDPSession } from "@playwright/test";
import { matrix } from "../types";
import type { Selection, Suite } from "../types";

const ROUTES = ["#/unit/drone", "#/tab/all", "#/achievements", "#/statistics", "#/tab/energy", "#/unit/queen", "#/tab/mutagen", "#/options", "#/tab/meat"];
const ROUNDS = 4;
const ROUTE_GAP_SECONDS = 0.25;

async function snapshot(cdp: CDPSession) {
  await collectGarbage(cdp);
  const m = await metrics(cdp);
  return { heap: m.JSHeapUsedSize / 1e6, nodes: m.Nodes, listeners: m.JSEventListeners };
}

interface Mem {
  mem: string;
  route: string;
}

export const memory: Suite<ReturnType<typeof cases>[number]> = {
  name: "memory",
  describe: (env) => `heap after GC on the meat tab, after ${env.duration} s idle, and after ${ROUTES.length * ROUNDS} route changes (no CPU throttle)`,
  metrics: [
    { key: "heap", label: "heap", unit: "MB", better: "lower", noise: 0.3 },
    { key: "idleGrowth", label: "+idle", unit: "MB", better: "lower", noise: 0.3 },
    { key: "navGrowth", label: "+nav", unit: "MB", better: "lower", noise: 0.3 },
    { key: "nodes", label: "DOM nodes", digits: 0, better: "lower", noise: 10 },
    { key: "navNodes", label: "+nav", digits: 0, better: "lower", noise: 10 },
    { key: "listeners", label: "listeners", digits: 0, better: "lower", noise: 3 },
    { key: "navListeners", label: "+nav", digits: 0, better: "lower", noise: 3 },
  ],
  cases: (sel) => cases(sel),
  async run(env, c) {
    const { page, cdp, close } = await openPage(env, { save: c.save, viewport: c.viewport, route: c.route });
    try {
      const start = await snapshot(cdp);
      await sleep(page, env.duration);
      const idle = await snapshot(cdp);
      for (let r = 0; r < ROUNDS; r++) {
        for (const route of ROUTES) {
          await page.evaluate((h) => (location.hash = h), route);
          await sleep(page, ROUTE_GAP_SECONDS);
        }
      }
      await sleep(page, 0.5);
      const nav = await snapshot(cdp);
      return {
        values: {
          heap: start.heap,
          idleGrowth: idle.heap - start.heap,
          navGrowth: nav.heap - idle.heap,
          nodes: start.nodes,
          navNodes: nav.nodes - start.nodes,
          listeners: start.listeners,
          navListeners: nav.listeners - start.listeners,
        },
      };
    } finally {
      await close();
    }
  },
};

function cases(sel: Selection) {
  return matrix<Mem>(sel, [{ mem: "meat tab", route: "#/tab/meat" }], (m) => m.mem);
}
