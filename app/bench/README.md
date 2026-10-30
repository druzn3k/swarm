# Swarm Hive benchmarks

A benchmark suite for the app: how much main-thread time the game tick takes,
how many React components re-render, how fast a buy button responds, how fast
the app starts, whether memory grows, and whether the hive canvas sleeps when
nobody can see it. It runs the production build in Playwright's Chromium with
saves made by the engine at run time.

It is not part of `pnpm test` or CI: browser timings on a shared machine move
by a millisecond or two between runs, too much for a pass/fail gate. Use it to
check a change against a baseline, on the same machine.

## Running

```sh
pnpm --filter @swarmsim/app bench                       # all suites, late save, phone, 3 runs each
pnpm --filter @swarmsim/app bench --saves all --viewports all
pnpm --filter @swarmsim/app bench --suites tick,tap --cases drone --repeat 5
```

It builds the app (`vite build`; the workspace packages must have been built
once, `pnpm -r build`), serves `dist/` with `vite preview` on a free port,
runs the suites, stops the server, prints one table per suite and writes the
results to `bench/results/<date>.json` (gitignored).

| flag | default | |
| --- | --- | --- |
| `--suites <list>` | all | `tick`, `renders`, `tap`, `startup`, `memory`, `canvas` |
| `--saves <list>` | `late` | `early`, `mid`, `late` or `all` |
| `--viewports <list>` | `phone` | `phone` (390×844, DPR 3, mobile, touch), `laptop` (1440×900) or `all` |
| `--cases <list>` | all | only rows whose name contains one of these, e.g. `drone,meat` |
| `--throttle <n>` | 4 | CPU slowdown for the timed suites (tick, tap, startup, canvas) |
| `--duration <s>` | 5 | seconds per measurement window (tick, renders, canvas per state, memory idle) |
| `--repeat <n>` | 3 | runs per row, each in a fresh browser context; the table shows the median ± half the range |
| `--no-build` | | use the existing `dist/` |
| `--dist <dir>` | `dist` | serve another build (relative to `app/`); implies `--no-build` |
| `--json <file>` | `bench/results/<date>.json` | where to write the results |
| `--compare <file>` | | also print each value's change from an earlier results file |
| `--report <file>` | | run nothing: print a results file's tables (with `--compare`, its changes) |

A full run (`--saves all --viewports all`) is 132 rows. At `--duration 2
--repeat 2` it takes about 23 minutes on a 4-core machine, build included;
with the defaults (5 s, 3 runs) expect about an hour. Narrow it with `--suites`,
`--saves`, `--viewports` and `--cases` while working on something.

### Checking a change

Measure the baseline, make the change, measure again with `--compare`:

```sh
pnpm --filter @swarmsim/app bench --suites tick,renders --json bench/results/before.json
# ...change the code...
pnpm --filter @swarmsim/app bench --suites tick,renders --compare bench/results/before.json
```

The comparison repeats the tables with each new median and its change, and
marks with `*` the changes beyond the noise: the medians differ by more than
10% of the baseline and more than the metric's noise floor (e.g. 0.5 ms for
the tick mean, 5 ms for tap→paint, 30 ms for startup times; see `noise` in
`suites/`), and, with two or more runs on each side, the runs' min–max ranges
don't overlap. It ends with the list of marked metrics that got worse and
better. Use the same flags for both runs (it warns when throttle, duration or
repeat differ), use `--repeat 3` or more for numbers you will act on, and
keep the machine otherwise idle.

Treat the marks as pointers, not verdicts. The whole machine drifts: on the
development container two identical full runs back to back differed by
10–20% on most timings (the second one slower nearly everywhere), and the
comparison flagged dozens of "changes" in unchanged code. A real regression
shows up in the screens and buttons that the change touches and survives
re-running; drift moves everything. When in doubt, measure the baseline
again after the change (before, after, before) and narrow the run with
`--suites`/`--cases` so the runs are close together in time.

To compare two builds side by side without switching branches back and
forth, build the baseline into its own directory and point `--dist` at it:

```sh
git stash && pnpm --filter @swarmsim/app exec vite build --outDir /tmp/base && git stash pop
pnpm --filter @swarmsim/app bench --dist /tmp/base --json bench/results/base.json
pnpm --filter @swarmsim/app bench --compare bench/results/base.json
```

The manual GitHub workflow "benchmark" (`.github/workflows/bench.yml`, Run
workflow with any flags) runs the suite on a GitHub runner, puts the tables
in the run summary and uploads the JSON as an artifact. Runner numbers are
only comparable with other runner numbers.

## Saves

`saves.ts` plays the engine to make three saves (ported from the performance
reviews' craft script): **early** (300 meat, 12 drones; the first minutes),
**mid** (queens, nests, territory, energy; 20 rounds of buying a quarter of
everything, 37 of 121 achievements) and **late** (every meat generation, the
army, mutations, 10 ascensions; 40 rounds, 75 achievements). They are played
on a fixed clock, so every run gets the same game; only the save's dates are
moved to five seconds before each page load, so the app shows no welcome-back
summary and does no offline catch-up. Each browser context gets the save and
"every tutorial step dismissed" in localStorage before the app starts (once:
reloads and route changes keep the game's own state). Making the late save
takes about 14 s, so only the selected saves are made.

Every page blocks Google Fonts (the fallback fonts are used; font loading
would only add network noise) and service workers (no install traffic during
a measurement; startup is a cold first visit).

## Suites

The screens visited by `tick` and `renders`: the meat tab, all units, the
drone screen, the energy and mutagen tabs, achievements, statistics and
options. On a phone a unit route shows the unit alone; on a laptop it shows
the tab's list beside it. The early save hasn't unlocked energy or mutagen,
so those rows show what that save sees there.

### tick

The cost of the game's 100 ms tick, which is where an idle game spends its
time. The page's `setInterval(…, 100)` callbacks are marked with
`console.timeStamp("tick")`; after the page settles (and a forced GC) a
Chrome trace of `--duration` seconds is taken under the CPU throttle and each
top-level task on the main thread is sorted into tick, animation frame,
rendering or other.

- **tick mean / p95 / max** (ms): duration of the tasks that ran a tick. The
  store's updates go through `useSyncExternalStore`, which re-renders
  synchronously in the same task, so this includes React's render and
  commit (but not style, layout and paint, which come in the next frame).
- **ticks/s**: ticks that ran; below 10 means the main thread fell behind.
- **long tasks**: tasks over 50 ms during the window, of any kind.
- **busy %**: all main-thread task time over the window's wall time
  (ticks, the hive's frames, rendering, garbage collection).

The JSON also has the mean animation-frame and rendering task, the heap and
the DOM node count per run.

### renders

React commits and component renders per second, without CPU throttling (it
counts work rather than timing it). A stand-in React DevTools hook walks the
fiber tree after each commit and counts the function components that
rendered in it: those with the PerformedWork flag that aren't mounts and
weren't already the current fiber in the previous commit (a fiber object that
stays current across commits was bailed out and its flag is stale). That is
an approximation of the React DevTools profiler, good for catching
components that re-render on every tick.

- **commits/s**, **renders/s** (component renders, summed), **components**
  (distinct components that rendered).
- Under the table, the five components that rendered most per second.
  The bundle is minified, so names come from the build's source map: the
  function's position in the bundle (CDP `[[FunctionLocation]]`) is mapped
  back to its declaration in the source.

Zero commits is a good result: the store's selectors return formatted
values, so a screen whose shown numbers didn't change doesn't re-render.

### tap

Latency of a buy, on three buttons: the drone card's quick buy on the meat
tab (`[data-actions="drone"]`, the first enabled button), and on the drone
screen the first enabled buy button and the first enabled upgrade button.
Each run taps (phone) or clicks (laptop) the button 8 times, 0.7 s apart,
under the CPU throttle.

- **tap→paint** (ms, median and worst of the 8): from `pointerdown`'s
  timestamp to a message posted from the next animation frame, i.e. just
  after the frame showing the purchase was produced. Like Event Timing's
  duration (what INP reports), without its 8 ms rounding and 16 ms floor.
- **handler** (ms, median and worst): from the click reaching `window` in
  the capture phase to leaving it in the bubble phase: React's handler, the
  engine's purchase, the save it triggers, and the synchronous re-render
  (for a trusted event the microtask that renders runs between listeners).

A row shows `–` when nothing was affordable (the early save has no
affordable drone upgrade), and a note says how many taps landed.

### startup

A cold first visit to the meat tab: a fresh context, no service worker, the
CPU throttled before navigation, traced until a second after the first
render. No network throttling: the server is local.

- **FCP** (ms): first-contentful-paint (Paint Timing).
- **first render** (ms): when the first unit card or page heading appeared
  (a MutationObserver installed before the app runs), from navigation start.
- **module eval** (ms): evaluating the bundle's module (`v8.evaluateModule`),
  which includes everything run at import time.
- **JS to render** (ms): all JavaScript (script evaluation and function
  calls, overlaps counted once) between navigation and the first render.
- **long tasks**, **long total**: tasks over 50 ms from navigation to a
  second after the first render, and their summed duration.

### memory

Memory on the meat tab, from `Performance.getMetrics` after two forced
garbage collections: once settled, again after idling for `--duration`
seconds, and again after 36 route changes (four rounds of nine routes, 0.25
s apart, ending on the meat tab). No CPU throttle.

- **heap** (MB): JS heap in use at the start; **+idle**, **+nav**: its
  growth while idle and while navigating.
- **DOM nodes**, **listeners** at the start; **+nav**: their change after
  navigating (back on the same screen, so it should be about zero).

Some growth is normal (caches, JIT feedback) and levels off; growth that
keeps going with a longer `--duration` or across rounds is a leak.

### canvas

The hive's animation, which should redraw about 20 times a second while
visible and not at all otherwise (see `src/art/animator.ts`). All 2D-context
drawing calls are wrapped; an animation frame "drew" if one ran during its
`requestAnimationFrame` callback. Timer callbacks (setTimeout and
setInterval) are counted as wake-ups, a proxy for battery use. Under the CPU
throttle, `--duration` seconds per state.

- **draws/s visible**: the meat tab at the top.
- **off screen**: the canvas's scroll container (the page on a phone, the
  left column on a laptop) is padded and scrolled so the canvas is above the
  viewport; `–` if it couldn't be scrolled out of view.
- **hidden**: headless Chromium never hides a page, so
  `document.visibilityState` is overridden to `hidden` and a
  `visibilitychange` dispatched; the game should stop ticking and the hive
  stop drawing.
- **wake-ups/s visible / hidden**: about 30 while visible (10 ticks, 20 hive
  frames' timers), zero when hidden apart from the minute heartbeat.

## Caveats

- Numbers are machine-specific. Compare runs from the same machine, with the
  same flags, with nothing else busy. Expect ±1–2 ms on tick and tap times
  from run to run; that is why each row is run several times and the
  comparison only marks changes beyond the runs' spread.
- The CPU throttle (`Emulation.setCPUThrottlingRate`) slows JavaScript and
  rendering on the main thread to approximate a slower phone; it doesn't
  model a phone's GPU, memory or thermal behaviour, and how slow 4x is
  depends on the machine it divides.
- Headless Chromium has no real display: frames run at about 60 Hz, paint
  and compositing are cheaper than on a device, and visibility has to be
  simulated (canvas suite).
- The first run after a build can be a little slower (cold disk cache); the
  median over `--repeat` runs absorbs it.
- Times come from traces and in-page timers, which add a little overhead of
  their own; it is the same in both runs of a comparison.

## Layout

- `run.ts`: the entry point (flags, build, `vite preview`, the loop over suites, output).
- `saves.ts`: the early, mid and late saves.
- `lib.ts`: browser contexts seeded with a save, throttling, tracing, statistics.
- `report.ts`: the JSON format, the tables and the comparison.
- `sourcemap.ts`: names for minified functions (renders).
- `types.ts`: what a suite is.
- `suites/`: one file per suite; `screens.ts` lists the screens.

To add a suite, export a `Suite` (metrics, cases, `run` returning one sample
of values) from `suites/` and add it to `SUITES` in `run.ts`. The files are
type-checked with the app (`tsconfig.json`), and vitest only collects
`src/**/*.test.ts`, so nothing here runs in `pnpm test`.

## Reference numbers

Machine-specific: one run on the development container (Intel Xeon @ 2.30
GHz, 4 cores, Chromium 153 headless), commit ce6cd05, `--saves all
--viewports all --duration 2 --repeat 2` (medians; the spread between the
two runs of a row was mostly under 0.5 ms for tick means and under 4 ms for
taps, but a second full run straight after came out 10–20% slower overall).
Numbers from another machine aren't comparable with these; measure your own
baseline.

tick, 4x throttle (tick mean ms / busy %):

| screen | early phone | mid phone | late phone | late laptop |
| --- | --- | --- | --- | --- |
| meat | 2.5 / 7.0 | 3.8 / 9.0 | 5.0 / 10.7 | 7.3 / 16.2 |
| all units | 2.4 / 6.1 | 4.2 / 8.8 | 5.2 / 11.9 | 8.2 / 14.5 |
| drone | 4.7 / 5.3 | 7.0 / 8.5 | 7.9 / 12.5 | 6.3 / 13.9 |
| energy | 2.5 / 7.2 | 3.4 / 8.4 | 3.4 / 8.5 | 6.3 / 13.3 |
| mutagen | 2.2 / 6.2 | 3.5 / 9.4 | 7.5 / 11.8 | 7.6 / 12.0 |
| achievements | 3.1 / 3.3 | 3.8 / 4.0 | 3.8 / 3.9 | 4.1 / 4.2 |
| statistics | 2.3 / 2.4 | 3.3 / 3.4 | 3.6 / 4.0 | 2.9 / 2.9 |
| options | 2.3 / 2.4 | 2.8 / 3.0 | 3.3 / 3.6 | 2.4 / 2.7 |

No long tasks during any tick window; p95 stayed under 15 ms (4x).

renders (late): no commits at all on the phone's meat, all units, energy,
achievements, statistics and options screens; the drone screen commits every
tick (10/s, 440 component renders/s, mostly `StackButton`, `SpriteIcon`,
`Paragraphs`, `CostList`); on a laptop the right-hand unit screen commits
5/s (220 renders/s, 465 on energy).

tap, 4x throttle (tap→paint / handler, ms, median of 8 taps):

| button | mid phone | late phone | late laptop |
| --- | --- | --- | --- |
| meat quick buy | 61 / 28 | 85 / 50 | 79 / 56 |
| drone buy | 60 / 30 | 74 / 45 | 79 / 59 |
| drone upgrade | 72 / 35 | 92 / 50 | 83 / 59 |

startup, 4x throttle, phone (FCP / first render / JS to render / long
tasks, ms): early 430 / 383 / 308 / 2, mid 478 / 410 / 338 / 2, late
594 / 510 / 436 / 3; laptop late 700 / 574 / 493 / 3.

memory (late phone): 5.6 MB heap, +0.13 MB after idling 2 s, +1.1 MB after
36 route changes; 808 DOM nodes (+20), 285 listeners (+0).

canvas (every save and viewport): 20 draws/s visible, 0 off screen, 0
hidden; 30 wake-ups/s visible, 0 hidden.
