// React renders per second by component, from a stand-in React DevTools hook:
// after each commit it walks the fiber tree and counts the components that
// rendered in that commit. A fiber counts when it has the PerformedWork flag,
// isn't a mount (it has an alternate) and wasn't already the current fiber in
// the previous commit (a fiber object that stays current across commits was
// bailed out, its flag is stale). An approximation of what the React DevTools
// profiler shows, good for spotting components that re-render every tick.
// Measured without CPU throttling: it counts work, it doesn't time it.
// Component names come from the build's source map (the bundle is minified).
import type { CDPSession } from "@playwright/test";
import { openPage, sleep } from "../lib";
import { SourceMap } from "../sourcemap";
import { matrix } from "../types";
import type { Sample, Selection, Suite } from "../types";
import { SCREENS } from "./screens";
import type { Screen } from "./screens";

declare global {
  interface Window {
    __benchRenders?: { counts: Record<string, number>; commits: number; types: unknown[] };
  }
}

function installHook() {
  type Fiber = { type: unknown; flags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null };
  type Component = { type?: Component; render?: Component };
  const PERFORMED_WORK = 1;
  const seen = new WeakMap<Fiber, number>();
  // counts by index into `types`: the component functions, named later from the source map
  const state = (window.__benchRenders = { counts: {} as Record<string, number>, commits: 0, types: [] as unknown[] });
  const ids = new Map<unknown, number>();
  let commit = 0;
  const idOf = (t: Component): number => {
    // memo() and forwardRef() wrap the function
    const fn = typeof t === "function" ? t : t.render ?? (t.type && (typeof t.type === "function" ? t.type : t.type.render)) ?? t;
    let id = ids.get(fn);
    if (id == null) {
      id = state.types.push(fn) - 1;
      ids.set(fn, id);
    }
    return id;
  };
  const walk = (f: Fiber | null) => {
    while (f) {
      const prev = seen.get(f);
      seen.set(f, commit);
      const t = f.type;
      if ((typeof t === "function" || (t && typeof t === "object")) && f.flags & PERFORMED_WORK && prev !== commit - 1 && f.alternate) {
        const n = idOf(t as Component);
        state.counts[n] = (state.counts[n] ?? 0) + 1;
      }
      if (f.child) walk(f.child);
      f = f.sibling;
    }
  };
  (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: object }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      commit++;
      state.commits++;
      walk(root.current.child);
    },
  };
}

const TOP = 5;

export const renders: Suite<ReturnType<typeof cases>[number]> = {
  name: "renders",
  describe: (env) => `React commits and component renders per second (no CPU throttle), ${env.duration} s per run`,
  metrics: [
    { key: "commits", label: "commits/s", digits: 1, better: "lower", noise: 1 },
    { key: "renders", label: "renders/s", digits: 0, better: "lower", noise: 10 },
    { key: "components", label: "components", digits: 0, better: "lower", noise: 2 },
  ],
  cases: (sel) => cases(sel),
  async run(env, c) {
    const { page, cdp, close } = await openPage(env, { save: c.save, viewport: c.viewport, route: c.route, init: { fn: installHook } });
    try {
      await page.evaluate(() => {
        const s = window.__benchRenders!;
        s.counts = {};
        s.commits = 0;
      });
      await sleep(page, env.duration);
      const r = await page.evaluate(() => ({ counts: window.__benchRenders!.counts, commits: window.__benchRenders!.commits }));
      const names = await componentNames(cdp, Object.keys(r.counts).map(Number));
      const perSec: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.counts)) perSec[names.get(Number(k))!] = (perSec[names.get(Number(k))!] ?? 0) + v / env.duration;
      return {
        values: {
          commits: r.commits / env.duration,
          renders: Object.values(perSec).reduce((a, b) => a + b, 0),
          components: Object.keys(perSec).length,
        },
        detail: { perSecond: perSec },
      };
    } finally {
      await close();
    }
  },
  note(samples: Sample[]) {
    // average each component over the runs that measured it
    const sum: Record<string, number> = {};
    for (const s of samples) for (const [k, v] of Object.entries((s.detail?.perSecond ?? {}) as Record<string, number>)) sum[k] = (sum[k] ?? 0) + v / samples.length;
    const top = Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, TOP);
    return top.length ? "top: " + top.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ") : undefined;
  },
};

const maps = new Map<string, Promise<SourceMap | undefined>>();

function sourceMap(url: string): Promise<SourceMap | undefined> {
  if (!maps.has(url)) {
    maps.set(
      url,
      fetch(url + ".map")
        .then((r) => (r.ok ? r.json() : undefined))
        .then((m) => (m ? new SourceMap(m) : undefined))
        .catch(() => undefined),
    );
  }
  return maps.get(url)!;
}

/** The components' source names, from where each function sits in the bundle; the minified name if that fails. */
async function componentNames(cdp: CDPSession, ids: number[]): Promise<Map<number, string>> {
  const scripts = new Map<string, string>();
  cdp.on("Debugger.scriptParsed", (e) => scripts.set(e.scriptId, e.url));
  await cdp.send("Debugger.enable");
  const names = new Map<number, string>();
  try {
    for (const id of ids) {
      const { result } = await cdp.send("Runtime.evaluate", { expression: `window.__benchRenders.types[${id}]` });
      let name = result.description?.match(/^(?:function|class)\s*([\w$]*)/)?.[1] || "?";
      if (result.objectId) {
        const props = await cdp.send("Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
        const loc = props.internalProperties?.find((p) => p.name === "[[FunctionLocation]]")?.value?.value as
          | { scriptId: string; lineNumber: number; columnNumber: number }
          | undefined;
        const url = loc && scripts.get(loc.scriptId);
        const map = url ? await sourceMap(url) : undefined;
        name = (loc && map?.functionName(loc.lineNumber, loc.columnNumber)) || name;
      }
      names.set(id, name);
    }
  } finally {
    await cdp.send("Debugger.disable");
  }
  return names;
}

function cases(sel: Selection) {
  return matrix<Screen>(sel, SCREENS, (s) => s.screen);
}
