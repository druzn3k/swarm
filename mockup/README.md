# Pixel mock-up

A playable, phone-first pixel-art UI mock-up running on `@swarmsim/engine`.
It covers one screen: a live hive scene, unit cards with large buy buttons,
upgrades, and a bottom tab bar. All art is generated in code (`src/sprites.ts`).

```sh
pnpm install
pnpm build    # writes dist/swarm-hive.html, a single self-contained file
```

Open `dist/index.html` in a browser (`dist/swarm-hive.html` is the same page
without the document skeleton, for hosts that add their own).

Every push to `master` publishes it to GitHub Pages at
https://druzn3k.github.io/swarm/ (`.github/workflows/pages.yml`). Progress saves to localStorage under
its own key, separate from the real game. The "Speed" button is a demo aid
that makes time pass faster.
