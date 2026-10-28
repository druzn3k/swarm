# Pixel mock-up

A playable, phone-first pixel-art UI mock-up running on `@swarmsim/engine`.
It covers one screen: a live hive scene, unit cards with large buy buttons,
upgrades, and a bottom tab bar. All art is generated in code (`src/sprites.ts`).

```sh
yarn install
yarn build    # writes dist/swarm-hive.html, a single self-contained file
```

Open `dist/swarm-hive.html` in a browser. Progress saves to localStorage under
its own key, separate from the real game. The "Speed" button is a demo aid
that makes time pass faster.
