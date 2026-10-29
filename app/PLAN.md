# Swarm Hive app plan

Goal: a complete, phone-first, pixel-art Swarm Simulator built on
`@swarmsim/engine`, with everything the old game offers to a player, in the
style of the first pixel mock-up (retired; see git history). It is deployed to GitHub Pages.

## Decisions

- **Stack:** React 18 + TypeScript, built with Vite, in the pnpm workspace as
  `app/` (`@swarmsim/app`). Depends on `@swarmsim/engine` by name.
- **Look:** the mock-up's direction. Dark burrow palette, amber actions,
  chitin purple, Silkscreen + Pixelify Sans, hard pixel frames, sprites drawn
  in code. Single dark theme by design.
- **Phone first:** one column, large touch targets (48px+), bottom tab bar,
  no hover-only information, works from 360px wide. Usable on desktop too.
- **Laptop layout (phase D):** from 1000px wide (`src/layout.ts`
  `WIDE_MIN`, `styles/wide.css`). A tab or unit route splits in two: the
  tab's hive, title, extras and unit list on the left (its own scroll, so it
  stays put), a unit's screen on the right (`<main>`, where the skip link
  goes). With no unit in the route (`#/tab/<tab>`) the right shows the unit
  last opened on that tab this session (the old game's `tab.lastselected`),
  else the tab's lead unit if its screen has something to buy or cast, else
  the cheapest unit that does (so a new game opens on drones). The
  old wide page showed only the table until a unit was picked; an empty half
  screen helps nobody. A unit picked from "all units" keeps that list. Other
  screens are one column up to 960px. Tabs are a strip under the header and
  More drops down from it as an anchored panel. The hive is drawn at a
  whole-number scale of its 160×84 art: 3× (480px), 4× from 1280×860, 5× from
  1800×1000, 6× from 2400×1300. Type steps up a size. Tutorial and
  welcome-back cards go at the top of the right column. Below 1000px the phone
  layout is unchanged.
- **Saves:** localStorage under the app's own key. Import and export use the
  old game's save format, so players can bring a swarmsim.com save over.
  The engine saves after every player action (purchases, abilities, ascension,
  undo, options), like the old game; on top of that the app saves 30 s after
  the last save, in idle time (`requestIdleCallback`, else `setTimeout`), and
  at once when the page is hidden or closed (`src/game/autosave.ts`). No timed
  saves while the page is hidden.
- **Battery:** the hive redraws about 20 times a second, advancing its scene
  by the 60 Hz steps that really passed (same speed in wall-clock time,
  `src/art/animator.ts`), and stops while it is off screen or the page is
  hidden. The game doesn't tick while the page is hidden; one tick on return
  catches up (idle progress comes from elapsed time).
- **Routing:** hash routes, so the app works from any static host
  (GitHub Pages under `/swarm/`): `#/tab/<tab>`, `#/unit/<unit>`,
  `#/achievements`, `#/statistics`, `#/options`, `#/about`.
- **Engine is the only source of game rules.** The app never re-implements
  formulas; if something is missing from the engine, add it there with tests.

## Feature inventory (from swarmsim-coffee views)

1. Tabs: meat, larva, territory, energy, mutagen, plus "all units". Tab shows
   lead unit count, cap %, and an upgrade-available marker.
2. Unit list per tab, most advanced unit first and the cheapest last (the old
   `sortUnits()` order): icon, name, count, rate, upgrade marker. Under each
   buyable unit a buy row: +1, max N, and upgrade (one level of the first
   affordable, shown upgrade). Coming back from a unit keeps the list's place.
3. Unit screen: description and flavor text; owned count; production each and
   total; "you earn X per <velocity unit>"; cap and time to cap; buy input
   with the old syntax (`10%`, `=1000`, `@1000`, `1.5k`, `23 billion`) and a
   live cost preview; buy 1 / 25% / max buttons; twins; warnings before a
   first buy (`warnfirst`); advanced data (cost as % of stock/income) when
   enabled; prev/next unit (the cards above and below; a sideways swipe does
   the same; both replace the history entry so Back returns to the list).
4. Upgrades on a unit: level, cost, progress bar, time until affordable,
   buy 1 and buy max for twin upgrades, notify setting (hide, never,
   when buyable, at 2x, at 4x).
5. Abilities (energy): cost per use, progress, cast, show/hide.
6. More menu: buy all upgrades, buy cheapest upgrades (25%), undo with
   countdown, options, achievements, statistics, show all units, about.
7. Mutagen: ascension (cost, progress, time to afford, confirm), respec and
   free respec, mutation upgrades.
8. Achievements: list with earned date, points, progress, total points and
   percent, filters (earned / unearned / masked), toast on earn.
9. Statistics: per unit and upgrade (bought, clicks, elapsed first), totals,
   time played, skipped time.
10. Options: number notation (standard, scientific, hybrid, engineering),
    velocity unit (second, minute, hour, day, warp), duration format,
    advanced unit data, import/export save, reset (with confirm). Old
    theme/FPS/Kongregate options are dropped.
11. Welcome back: offline gains summary on load.
12. Tutorial: the old step-by-step hints for new players.
13. About: credits (Evan Rosson, original game), GPLv3, source link.

Dropped on purpose: PlayFab/Kongregate login and cloud saves, analytics,
feedback widget, purchases (MTX), themes, debug pages, changelog page (link to
the repository instead).

Documented deviations (phase C parity audit, see [PARITY.md](PARITY.md)):
prev/next unit follow the list (previous is the card above); no keyboard hotkeys; unavailable buy
buttons are shown disabled rather than omitted; drastic actions (ascend,
respec, import, reset) ask for confirmation on the page; flavor text is shown
inline rather than as a tooltip; the territory chart is a bar chart.

## Phases

A. **Shell** — package, engine provider and tick loop, save/load, routing,
   layout (header resources, hive scene, unit list, unit screen with buy
   input and upgrades), bottom nav with More sheet, Playwright smoke test,
   Pages deploys the app.
B. **In parallel, on the shell:**
   - B1 Progression: abilities, mutagen ascension and respec, buy-all and
     cheapest upgrades, undo, all-units view, upgrade notify settings,
     welcome back, tutorial.
   - B2 Meta screens: achievements, statistics, options, about, number and
     duration formatting driven by options.
   - B3 Art: sprites for every unit, upgrade and ability icons, per-tab hive
     scenes (territory war band, energy nexus, mutagen lab), animations.
C. **Review and polish** — parity walk-through against the feature
   inventory, accessibility, performance of the tick loop, end-to-end tests
   in CI, retire `mockup/`.
D. **Laptop layout** — from about 1000px wide: two columns (hive scene and
   unit list on the left, the selected unit's screen on the right, so picking
   a unit keeps the list in view), the tab bar as a strip along the top, a
   larger pixel-sharp scene, larger type. Phone layout below that width stays
   as it is.
