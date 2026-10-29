Units, upgrades, and other game content.

It used to come from a Google spreadsheet. This had several problems:

- The spreadsheet was independent of git. Rolling back the source code didn't roll back the spreadsheet, so old code simply won't work anymore.
- A while back, Google broke the APIs I used to pull data from the spreadsheet.

So, now it's hardcoded in Typescript files. The static type checking is quite nice, although this format is a lot harder to read. Maybe someday I'll put together a nice custom editor, or find a shorter way to express this data.

## Static copy for the engine

The engine and the app don't run the io-ts codecs at startup. They load
`src/spreadsheet/static.ts`, the output of `toSpreadsheet()` generated ahead
of time (in a compact form, `src/spreadsheet/compact.ts`). After editing the
tables, regenerate it:

```sh
pnpm --filter @swarmsim/tables gen:static
```

`src/spreadsheet/static.test.ts` (and the engine's `test/data.test.ts`) fail
while the static copy differs from what `toSpreadsheet()` returns.
