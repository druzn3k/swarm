# Parity audit: Swarm Hive vs. the old game

Phase C walk-through of the feature inventory in [PLAN.md](PLAN.md) against
the old AngularJS game (`swarmsim-coffee/app/views`, `scripts/directives`,
`scripts/filters`, `scripts/controllers`). The app was exercised in Chromium at
390×844 and 360×800 with crafted early, mid and late-game saves (made with the
engine, like `e2e/saves.ts`).

Legend: ✅ same information, actions and conditions · ⚠️ differs (says how,
and whether it is intentional) · ❌ missing.

The **Before** column is the state at the start of phase C; **After** is the
state after the phase C fixes. Intentional differences are listed again at
the end.

## 1. Tabs (`views/tabs.html`, `directives/tabs.coffee`)

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| One tab per resource; "all units" via More | ✅ | ✅ | `components/TabBar.tsx`, `MoreSheet.tsx` | |
| Lead unit count (`bignum`) | ✅ | ✅ | `TabBar.tsx` | |
| Cap percent (floored) | ✅ | ✅ | `TabBar.tsx` | |
| Mutagen tab shows inactive mutagen `(+N)` | ⚠️ | ✅ | `TabBar.tsx` | Old showed it always, even `+0`; the app only when > 0. Fixed. |
| Upgrade-available marker | ✅ | ✅ | `TabBar.tsx` | `tab.isNewlyUpgradable()` |
| Locked tabs | ⚠️ | ✅ | `TabBar.tsx` | Old hid tabs that aren't visible yet; the app showed them dimmed as "Locked", which spoils energy and mutagen from the first minute. Now hidden like the old game. |
| Hotkeys (z undo, alt+a, alt+c) | ⚠️ | ⚠️ | — | Intentional: phone-first, no keyboard shortcuts (documented in PLAN.md). |

## 2. Unit list (`views/main.html`)

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Visible units of the tab | ✅ | ✅ | `components/UnitList.tsx`, `game/selectors.ts` | |
| Order | ⚠️ | ✅ | `selectors.ts visibleUnits` | The old table's `sortUnits()` order on every tab: most advanced unit at the top, the cheapest at the bottom (meat last); "all units" cheapest first. Phase C kept the mock-up's lowest-tier-first order; changed after phase D. |
| Icon, name with suffix, count (`bignum:0`) | ✅ | ✅ | `UnitList.tsx` | |
| Rate `+x/<velocity unit>` (`bignum:2`) | ✅ | ✅ | `UnitList.tsx` | |
| Territory units show territory captured | ✅ | ✅ | `UnitList.tsx` | |
| Cap percent | ✅ | ✅ | `UnitList.tsx` | |
| Upgrade marker | ✅ | ✅ | `UnitList.tsx` | |
| Achievement points row on the larva tab | ✅ | ✅ | `meta/AchievementPointsRow.tsx` | |
| Quick-buy dropdown per row with advanced unit data (`buyunit-dropdown.html`) | ❌ | ✅ | `components/unit/QuickBuy.tsx`, `unit/CardActions.tsx` | Every choice of the old dropdown is there with "advanced unit data": buy 1 and max of the unit on the card's buy row (below), and in a "More: 25%, each upgrade" disclosure the unit's 25% and each visible upgrade's buy 1/25%/max. |
| Buy row under each buyable card: +1 (times twins), max N, upgrade | — | ⚠️ | `components/unit/CardActions.tsx` | Addition (after phase D; no old equivalent without advanced data). "Upgrade" buys one level of the first affordable upgrade not hidden by its notify setting, in the unit screen's order, and is named after it ("Upgrade: buy Faster Drones"). Same commands as the unit screen. No row on units that can't be bought (meat, larvae, territory, energy...). The card head stays the link. |

## 3. Unit screen (`views/unit.html`, `directive-unit.html`, `buyunit*.html`)

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Name with suffix, owned count (`longnum`) | ✅ | ✅ | `screens/UnitScreen.tsx` | |
| Description | ⚠️ | ✅ | `content/descriptions.tsx` | Templated descriptions (`views/desc/unit/*.html`) were static text without their live numbers (bat, moth, nightbug, mutant units, cocoon, energy, crystal, mutagen). All ported with live numbers. |
| Flavor text (`lol`) | ✅ | ✅ | `UnitScreen.tsx` | Old showed it as a tooltip; shown as text (no hover on phones). |
| "You own …" (pluralized, hidden for capped units) | ✅ | ✅ | `unit/UnitInfo.tsx` | |
| Each/total production, bonus `(×N bonus)` | ✅ | ✅ | `UnitInfo.tsx` | |
| "You earn X per <velocity unit>", cap note | ✅ | ✅ | `UnitInfo.tsx` | |
| Cap and time to cap (energy) | ✅ | ✅ | `UnitInfo.tsx CapInfo` | |
| "Need more energy?" link on energy | ❌ | ✅ | `descriptions.tsx` | |
| Crystal: energy from crystals, "Converting crystals has permanently increased your maximum energy by …" | ❌ | ✅ | `UnitScreen.tsx`, `descriptions.tsx` | Old crystal page embedded the energy buy input. Crystal sale/MTX text dropped on purpose. |
| Territory production chart (`ChartCtrl`, show/hide) | ❌ | ✅ | `components/unit/TerritoryChart.tsx` | Pixel bar chart instead of a Google pie chart; show/hide kept in the save (`options.showCharts`, default on, like the old game). |
| Buy input syntax (`10%`, `=n`, `@n`, suffixes), help | ✅ | ✅ | `unit/BuyUnit.tsx` | Engine `parseNumber`. |
| `?num=` from cost links | ✅ | ✅ | `UnitScreen.tsx`, `CostList.tsx` | |
| Live cost preview with twins | ✅ | ✅ | `BuyUnit.tsx` | |
| Buy 1 / 25% / max (`is25Visible`, `maxCostMet > 1`) | ✅ | ✅ | `BuyUnit.tsx` | Old omitted unavailable buttons; the app shows them disabled (stable layout). |
| `warnfirst` warnings | ✅ | ✅ | `BuyUnit.tsx` | |
| Advanced unit data | ✅ | ✅ | `meta/AdvancedUnitData.tsx` | |
| Prev / next unit (only visible ones) | ✅ | ⚠️ | `unit/UnitNav.tsx`, `selectors.ts unitNeighbours` | At 360px the name was cut off entirely; now name and count on two lines. Intentional: they follow the list as shown — previous (‹, left) is the card above (more advanced), next (›, right) the card below (cheaper), skipping hidden units. The old game's ‹ went down a tier (`unit.prev`), the opposite of its own list. Stepping replaces the history entry (old: a new one), so Back returns to the list; a sideways swipe does the same as the arrows (`unit/useSwipe.ts`; swipe left = next). |
| Number formatting (`bignum` / `longnum`) | ⚠️ | ✅ | `format.ts` | `longnum` started suffixes at 1e6 and dropped trailing zeros of small numbers; the old filter (swarm-numberformat with the old options, checked by running it) starts at 1e5 (`minsuffix` typo in the old code) and keeps zeros: `123.456 thousand`, `8.00000 million`, `1.00`. Now identical, except that trailing zeros are dropped on purpose (`8 million`, `1.5B`): they add digits without adding information. |

## 4. Upgrades on a unit

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Name, level (when `maxlevel != 1`) | ✅ | ✅ | `unit/UpgradeItem.tsx` | |
| Description | ⚠️ | ✅ | `content/descriptions.tsx` | Templates (`views/desc/upgrade/*.html`): hatchery/expansion production and mutagen chances, crystal timer, achievement bonus rate, empower ("destroy all N of your …") were static. Ported live. |
| Icon | ❌ | ✅ | `UpgradeItem.tsx`, `progression/AbilityItem.tsx` | B3 drew icons but didn't show them. |
| "This/Next upgrade costs …" with buy links | ✅ | ✅ | `CostList.tsx` | |
| Progress bar, percent, time until affordable ("or less") | ✅ | ✅ | `UpgradeItem.tsx` | |
| Buy buttons | ❌ | ✅ | `UpgradeItem.tsx` | Old `buyupgrade` used `buyunit.html`: buy 1 / 25% / max on every upgrade. The app had buy 1, plus max only on twins. |
| Notify setting (hide/never/buyable/2×/4×), only with advanced data or when hidden | ✅ | ✅ | `progression/UpgradeNotify.tsx` | |

## 5. Abilities

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Live description | ✅ | ✅ | `content/descriptions.tsx` | Moved to the shared description module. |
| Cost per use, progress, ETA | ✅ | ✅ | `progression/AbilityItem.tsx` | |
| Cast 1 / 25% / max | ✅ | ✅ | `AbilityItem.tsx` | |
| Show / hide | ✅ | ✅ | `AbilityItem.tsx` | |
| Icon | ❌ | ✅ | `AbilityItem.tsx` | |
| Cast result note | ⚠️ | ⚠️ | `AbilityItem.tsx` | Addition (no old equivalent). |

## 6. More menu

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Buy all N upgrades | ✅ | ✅ | `progression/MoreActions.tsx` | |
| Buy cheapest N upgrades (25%) | ✅ | ✅ | `MoreActions.tsx` | |
| Undo with seconds left, no redo | ✅ | ✅ | `MoreActions.tsx`, `game/progression.ts` | |
| Options, achievements, statistics, all units, about | ✅ | ✅ | `MoreSheet.tsx` | |
| Patch notes, feedback, report problem | ⚠️ | ⚠️ | — | Dropped on purpose (PLAN.md); About links to the repository's issues. |
| Focus trap and focus return | ⚠️ | ✅ | `MoreSheet.tsx` | Trap and return worked, but the page behind stayed reachable to screen readers; it is now `inert` while the sheet is open, and the trap includes form fields. |

## 7. Mutagen

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Ascension text, cost, energy spent, progress, cap warning, ETA | ✅ | ✅ | `progression/AscensionPanel.tsx` | |
| Ascend button (disabled when unaffordable) | ✅ | ✅ | `AscensionPanel.tsx` | Adds a confirm step (intentional). |
| Respec and free respec with old conditions | ✅ | ✅ | `AscensionPanel.tsx` | |
| Reset upgrade notifiers | ⚠️ | ✅ | `AscensionPanel.tsx` | Old showed it only with advanced unit data; the app always. Fixed. |
| Mutation upgrades and mutant unit descriptions | ⚠️ | ✅ | `content/descriptions.tsx` | Live percentages now. |

## 8. Achievements

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Points (`longnum`), percent bar | ✅ | ✅ | `screens/AchievementsScreen.tsx` | |
| Earned / unearned / masked filters, order, reverse, stored in save | ✅ | ✅ | `AchievementsScreen.tsx`, `meta/achievements.ts` | |
| Earned date, progress | ✅ | ✅ | `AchievementsScreen.tsx` | App shows "x of y" at any progress (old: above 30%). |
| Larva bonus line | ✅ | ✅ | `AchievementsScreen.tsx` | |
| Toast on earn, queue, close clears | ✅ | ✅ | `meta/AchievementToast.tsx` | |
| `achieveclick` event | ✅ | ✅ | `AchievementsScreen.tsx` | |

## 9. Statistics

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Per unit: first bought, clicks, bought manually, twins | ✅ | ✅ | `screens/StatisticsScreen.tsx` | |
| Per upgrade: first bought, clicks, total | ✅ | ✅ | `StatisticsScreen.tsx` | |
| Save size, start date, last ascended | ✅ | ✅ | `StatisticsScreen.tsx` | |
| Time played, skipped time, totals | ✅ | ✅ | `StatisticsScreen.tsx` | Additions from PLAN.md. |

## 10. Options

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Number notation with examples | ✅ | ✅ | `screens/OptionsScreen.tsx` | |
| Standard-decimal suffix legend (`#/decimallegend`) | ❌ | ✅ | `OptionsScreen.tsx` | Collapsible table. |
| Velocity unit (incl. Swarmwarp, energy stays /sec) | ✅ | ✅ | `game/options.ts` | |
| Duration format (Exact / Approximate) | ✅ | ✅ | `OptionsScreen.tsx` | |
| Advanced unit data | ✅ | ✅ | `OptionsScreen.tsx` | |
| Import / export / reset with confirm | ✅ | ✅ | `meta/SaveTools.tsx` | |
| Themes, FPS, Kongregate, PlayFab, analytics | ⚠️ | ⚠️ | — | Dropped on purpose (PLAN.md). |

## 11. Welcome back

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Offline gains on load, humanized time, links | ✅ | ✅ | `progression/WelcomeBack.tsx`, `game/welcomeback.ts` | |

## 12. Tutorial

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Steps 1–11, 100 with the old conditions and text | ✅ | ✅ | `progression/TutorialHint.tsx`, `game/tutorial.ts` | "Click" reworded as "tap"; each step can be dismissed (addition). |

## 13. About

| Feature | Before | After | App | Notes |
|---|---|---|---|---|
| Credits (Evan Rosson), GPLv3, source link | ✅ | ✅ | `screens/AboutScreen.tsx`, `Footer.tsx` | |

## Cross-cutting

| Feature | Before | After | Notes |
|---|---|---|---|
| Re-render cost per tick (mid/late save, 4× CPU throttle) | ⚠️ | ✅ | Mean main-thread time of the tick task (engine tick + React render), late-game save, 390px, CPU 4×: meat tab 18.0 → 9.5 ms, all units 19.6 → 10.0 ms, larva screen 11.5 → 10.4 ms; mid-game meat tab 10.2 → 5.0 ms. |
| Accessibility (landmarks, headings, labels, live regions, contrast) | ⚠️ | ✅ | axe-core found no violations on any screen; manual pass: no skip link, confirms didn't close with Escape or return focus (import, reset), opacity lowered contrast of masked achievements, default placeholder color. Muted text (`--dust`) is 7.4:1 on `--burrow` and 8.0:1 on `--earth` (AA). Fixed. |
| 360px layout | ⚠️ | ✅ | Header rate, tab bar labels/counts and prev/next names were cut off. |
| Place in the list kept when coming back from a unit | — | ✅ | Addition (after phase D): back arrow, browser/Android back or the tab's own tab bar button put the phone list where it was (`scrollMemory.ts`, per tab, sessionStorage). |
| Re-render cost with the buy rows (late save, CPU 4×, tick+render mean over 10 s) | — | ✅ | 390px meat tab 9.3 → 9.4 ms; 1440px meat tab 17.0 → 14.0 ms. Rows re-read every 4th tick, phased, comparing upgrade costs with counts; the "new upgrade" marker on cards as often; cards far off screen every 5 s (`components/useInView.ts`); next to the list the unit screen and the tab bar refresh on alternate ticks. Player actions always show at once. |

## Phase D: laptop layout

| Feature | Old | App | Notes |
|---|---|---|---|
| Wide unit page: list beside the unit (`views/unit.html` sidebar) | ✅ | ✅ | `components/Split.tsx`, from 1000px. The old list sat on the left at `col-lg-3`; here it holds the hive too. |
| Tab links go to the last unit selected on the tab (`tab.url(lastselected)`) | ✅ | ✅ | Laptop layout: `#/tab/<tab>` shows `tab.lastselected`, else the lead unit if it has something to buy or cast, else the cheapest unit that does (`game/selectors.ts defaultUnit`). The old main page showed only the table until a unit was picked; the app always fills the right column. |
| Close button back to the table | ✅ | ⚠️ | No close/back button next to the list (it is in view); prev/next stay. |
| Re-render cost, laptop layout (late save, 1440×900, CPU 4×) | — | ✅ | Tick+render mean: meat tab 8.3 ms, drone 12.8 ms (was 16.2 before these fixes), queen 13.1 ms, energy 11.4 ms, mutagen tab 10.1 ms (was 15.3), all units 9.2 ms. List cards next to a unit refresh every other tick, half on each; ascension cost is worked out once per render; the hive re-reads counts twice a second. |

## Counts

| | ✅ | ⚠️ | ❌ |
|---|---|---|---|
| Before | 57 | 16 | 8 |
| After | 76 | 5 | 0 |
| Now (list order, buy row, place in list, swipe) | 78 | 6 | 0 |

## Remaining intentional differences

- Tab bar is a bottom bar with a More sheet on phones and a strip with a More panel from 1000px.
- Prev/next unit follow the list (previous = the card above) and replace the history entry; a sideways swipe steps too.
- Buy row (+1, max, upgrade) under each buyable unit card; with advanced data the old dropdown's other choices sit in a disclosure under it.
- No keyboard hotkeys.
- Unavailable buy buttons are shown disabled instead of omitted.
- Confirm steps before ascend, respec, reset and import.
- Flavor text is shown inline instead of as a tooltip.
- Dropped on purpose (PLAN.md): PlayFab/Kongregate, cloud saves, analytics,
  feedback widget, crystal purchases, themes, FPS, debug pages, changelog.
- The old `mutantfreq` template printed an undefined plural (`More  have…`);
  the app writes the unit's plural.
