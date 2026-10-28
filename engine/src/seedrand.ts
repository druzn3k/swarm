// Port of services/seedrand.coffee
//
// Deterministic serializable random numbers.
// Fights savestate scumming that would occur with math.rand().
import seedrandom from "seedrandom";
import { SeedSession } from "./interfaces";

export class SeedRand {
  // The old service took the Angular `session`; we take anything with
  // `state.date.started` (the session, or `{state:{date:{started}}}`).
  constructor(public session: SeedSession) {}

  // normal seeding uses session.date.started, but let unittests override it
  mkseed(seedstring: string, baseseed: any = null): string {
    const base = baseseed ?? this.session.state.date.started;
    return `${base}:${seedstring}`;
  }

  rng(seedstring: string, baseseed: any = null): () => number {
    const seed = this.mkseed(seedstring, baseseed);
    // Math.seedrandom from https://github.com/davidbau/seedrandom
    return new (seedrandom as any)(seed);
  }

  rand(seedstring: string, baseseed: any = null): number {
    // create a seeded rng, use it once, and throw it away.
    // `seedrand.rand(str)` will always return the same result for constant `str`.
    return this.rng(seedstring, baseseed)();
  }
}
