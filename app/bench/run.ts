// Swarm Hive benchmark runner: `pnpm --filter @swarmsim/app bench [flags]`.
// Builds the app (or uses an existing build), serves it with `vite preview`
// on a free port, runs the suites in Playwright's Chromium, prints a table and
// writes the results as JSON. See bench/README.md.
import { spawn, spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer } from "net";
import { cpus, platform } from "os";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { VIEWPORT_NAMES, launchBrowser } from "./lib";
import type { Env, ViewportName } from "./lib";
import { formatComparison, formatResults, summarize } from "./report";
import type { Results, Row } from "./report";
import { SAVE_NAMES, craftSave } from "./saves";
import type { BenchSave, SaveName } from "./saves";
import type { Case, Sample, Suite } from "./types";
import { canvas } from "./suites/canvas";
import { memory } from "./suites/memory";
import { renders } from "./suites/renders";
import { startup } from "./suites/startup";
import { tap } from "./suites/tap";
import { tick } from "./suites/tick";

const SUITES = { tick, renders, tap, startup, memory, canvas } as unknown as Record<string, Suite>;
const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `usage: pnpm --filter @swarmsim/app bench [flags]

  --suites <list>     ${Object.keys(SUITES).join(",")} (default: all)
  --saves <list>      ${SAVE_NAMES.join(",")} or all (default: late)
  --viewports <list>  ${VIEWPORT_NAMES.join(",")} or all (default: phone)
  --cases <list>      only cases whose name contains one of these (e.g. drone,meat)
  --throttle <n>      CPU slowdown for timed suites (default: 4)
  --duration <s>      seconds per measurement window (default: 5)
  --repeat <n>        runs per case; the table shows the median (default: 3)
  --no-build          use the existing build instead of running vite build
  --dist <dir>        serve this build (relative to app/; implies --no-build)
  --json <file>       where to write the results (default: bench/results/<date>.json)
  --compare <file>    also print the change from an earlier results file
  --report <file>     don't run anything: print the tables of a results file (with --compare, its changes)
  --help`;

function list<T extends string>(value: string | undefined, all: readonly T[], fallback: T[], what: string): T[] {
  if (!value) return fallback;
  if (value === "all") return [...all];
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const i of items) if (!all.includes(i as T)) throw new Error(`unknown ${what} "${i}" (choose from ${all.join(", ")})`);
  return items as T[];
}

function positive(value: string | undefined, fallback: number, what: string): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!(n > 0)) throw new Error(`--${what} must be a positive number`);
  return n;
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => ok(port));
    });
  });
}

/** `vite preview` of `dist`; resolves once it answers. */
async function preview(dist: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child = spawn("pnpm", ["exec", "vite", "preview", "--port", String(port), "--strictPort", "--outDir", dist], {
    cwd: APP,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  const url = `http://localhost:${port}/`;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; ) {
    if (child.exitCode != null) break;
    try {
      if ((await fetch(url)).ok) return { url, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  stop();
  throw new Error(`vite preview didn't start:\n${log}`);
}

function git(...args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd: APP, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** A results file, with the current metric definitions (labels, noise floors) for the suites that still exist. */
function load(file: string): Results {
  const res = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8")) as Results;
  for (const [name, suite] of Object.entries(res.suites)) if (SUITES[name]) suite.metrics = SUITES[name].metrics;
  return res;
}

function print(results: Results, baseline?: Results): void {
  console.log(`# Swarm Hive benchmark, ${results.date} (${results.commit}), ${results.machine.cpu} x${results.machine.cpus}, Chromium ${results.machine.chromium}`);
  console.log(formatResults(results));
  if (baseline) console.log(formatComparison(baseline, results));
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function main() {
  const { values: args } = parseArgs({
    options: {
      suites: { type: "string" },
      saves: { type: "string" },
      viewports: { type: "string" },
      cases: { type: "string" },
      throttle: { type: "string" },
      duration: { type: "string" },
      repeat: { type: "string" },
      "no-build": { type: "boolean" },
      dist: { type: "string" },
      json: { type: "string" },
      compare: { type: "string" },
      report: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (args.help) {
    console.log(HELP);
    return;
  }
  const suiteNames = list(args.suites, Object.keys(SUITES), Object.keys(SUITES), "suite");
  const saveNames = list<SaveName>(args.saves, SAVE_NAMES, ["late"], "save");
  const viewports = list<ViewportName>(args.viewports, VIEWPORT_NAMES, ["phone"], "viewport");
  const only = args.cases?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const settings = {
    throttle: positive(args.throttle, 4, "throttle"),
    duration: positive(args.duration, 5, "duration"),
    repeat: Math.round(positive(args.repeat, 3, "repeat")),
    dist: args.dist ?? "dist",
  };
  const baseline = args.compare ? load(args.compare) : undefined;
  if (args.report) {
    print(load(args.report), baseline);
    return;
  }
  const jsonPath = resolve(process.cwd(), args.json ?? `bench/results/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);

  const started = Date.now();
  if (!args["no-build"] && !args.dist) {
    console.error("building the app (vite build)...");
    const b = spawnSync("pnpm", ["run", "build"], { cwd: APP, stdio: ["ignore", "ignore", "inherit"] });
    if (b.status !== 0) throw new Error("vite build failed");
  }

  let t = Date.now();
  const saves = {} as Record<SaveName, BenchSave>;
  for (const s of saveNames) saves[s] = craftSave(s);
  console.error(`crafted saves ${saveNames.join(", ")} in ${seconds(Date.now() - t)}`);

  const server = await preview(settings.dist);
  const browser = await launchBrowser();
  const cleanup = async () => {
    server.stop();
    await browser.close().catch(() => {});
  };
  process.once("SIGINT", () => {
    server.stop();
    process.exit(130);
  });
  const env: Env = { browser, saves, baseURL: server.url, throttle: settings.throttle, duration: settings.duration };
  const results: Results = {
    format: 1,
    date: new Date().toISOString(),
    commit: (git("rev-parse", "--short", "HEAD") ?? "?") + (git("status", "--porcelain", "--", ".") ? "+dirty" : ""),
    machine: { cpu: cpus()[0]?.model ?? "?", cpus: cpus().length, platform: platform(), node: process.version, chromium: browser.version() },
    settings,
    suites: {},
  };
  try {
    for (const name of suiteNames) {
      const suite = SUITES[name];
      const cases = suite.cases({ saves: saveNames, viewports }).filter((c) => !only || only.some((o) => c.id.toLowerCase().includes(o)));
      if (!cases.length) continue;
      const rows: Row[] = [];
      t = Date.now();
      for (const [i, c] of cases.entries()) {
        const samples: Sample[] = [];
        const errors: string[] = [];
        for (let r = 0; r < settings.repeat; r++) {
          try {
            samples.push(await suite.run(env, c as Case));
          } catch (e) {
            errors.push(String((e as Error).message ?? e).split("\n")[0]);
          }
        }
        console.error(`  ${name} ${i + 1}/${cases.length}: ${c.save} ${c.viewport} ${c.id}${errors.length ? ` (${errors.length} failed)` : ""}`);
        rows.push({
          id: c.id,
          save: c.save,
          viewport: c.viewport,
          values: summarize(samples, suite.metrics),
          ...(suite.note && samples.length ? { note: suite.note(samples) } : {}),
          ...(errors.length ? { errors } : {}),
        });
      }
      console.error(`${name} done in ${seconds(Date.now() - t)}`);
      results.suites[name] = { description: suite.describe(env), metrics: suite.metrics, rows };
    }
  } finally {
    await cleanup();
  }

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(results, null, 1) + "\n");
  print(results, baseline);
  const shown = relative(process.cwd(), jsonPath);
  console.log(`\nresults: ${shown.startsWith("..") ? jsonPath : shown} (total ${seconds(Date.now() - started)})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
