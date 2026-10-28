import { SeedRand } from "../src";

describe("seedrand", () => {
  const seedrand = new SeedRand({ state: { date: { started: new Date(0) } } });

  it("should do something", () => {
    expect(!!seedrand).toBe(true);
  });

  it("generates deterministic random numbers", () => {
    expect(seedrand.rand("x", "y")).not.toEqual(seedrand.rand("x", "z"));
    expect(seedrand.rand("x", "y")).not.toEqual(seedrand.rand("w", "y"));
    expect(seedrand.rand("x", "y")).not.toEqual(seedrand.rand("y", "x"));
    expect(seedrand.rand("x", "y")).toEqual(seedrand.rand("x", "y"));
    expect(seedrand.rand("x", "y")).toEqual(seedrand.rand("x", "y"));
    expect(seedrand.rand("x", "y")).toEqual(seedrand.rand("x", "y"));
  });

  it("defaults the base seed to session.state.date.started", () => {
    expect(seedrand.mkseed("x")).toBe("Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time):x");
    expect(seedrand.rand("x")).toEqual(seedrand.rand("x", new Date(0)));
    expect(seedrand.rand("x")).not.toEqual(seedrand.rand("x", new Date(1000)));
  });
});
