import { describe, expect, it } from "vitest";
import { Animator, DRAW_MILLIS, MAX_STEPS } from "./animator";
import type { AnimatorHost } from "./animator";

/** A deterministic event loop: timers, and display frames every `refresh` ms. */
function loop(refresh = 1000 / 60) {
  let now = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const add = (at: number, fn: () => void) => {
    const id = nextId++;
    queue.set(id, { at, fn });
    return id;
  };
  const host: AnimatorHost = {
    now: () => now,
    setTimeout: (fn, ms) => add(now + Math.max(0, ms), fn),
    clearTimeout: (id) => void queue.delete(id),
    // the next display refresh after now
    requestAnimationFrame: (fn) => add((Math.floor(now / refresh + 1e-9) + 1) * refresh, fn),
    cancelAnimationFrame: (id) => void queue.delete(id),
  };
  const run = (ms: number) => {
    const end = now + ms;
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | undefined;
      for (const e of queue) if (!first || e[1].at < first[1].at) first = e;
      if (!first || first[1].at > end) break;
      queue.delete(first[0]);
      now = Math.max(now, first[1].at);
      first[1].fn();
    }
    now = end;
  };
  return { host, run, advance: (ms: number) => (now += ms), pending: () => queue.size };
}

function recorder() {
  const draws: number[] = [];
  return { draws, draw: (steps: number) => draws.push(steps), steps: () => draws.reduce((a, b) => a + b, 0) };
}

describe("Animator", () => {
  it("draws about 20 times a second and moves 60 steps a second (60 Hz screen)", () => {
    const l = loop(1000 / 60);
    const r = recorder();
    new Animator(r.draw, l.host).start();
    l.run(10_000);
    expect(r.draws.length).toBeGreaterThanOrEqual(190);
    expect(r.draws.length).toBeLessThanOrEqual(10_000 / DRAW_MILLIS + 1);
    expect(Math.abs(r.steps() - 600)).toBeLessThanOrEqual(2);
  });

  it("keeps the same speed on a 120 Hz screen", () => {
    const l = loop(1000 / 120);
    const r = recorder();
    new Animator(r.draw, l.host).start();
    l.run(10_000);
    expect(r.draws.length).toBeLessThanOrEqual(10_000 / DRAW_MILLIS + 1);
    expect(r.draws.length).toBeGreaterThanOrEqual(190);
    expect(Math.abs(r.steps() - 600)).toBeLessThanOrEqual(2);
  });

  it("pauses (off screen, hidden) and resumes without catching up", () => {
    const l = loop();
    const r = recorder();
    const a = new Animator(r.draw, l.host);
    a.start();
    l.run(1000);
    const before = r.steps();
    a.set("offscreen", true);
    expect(a.isRunning).toBe(false);
    expect(l.pending()).toBe(0);
    l.run(5000);
    expect(r.steps()).toBe(before);
    a.set("hidden", true);
    a.set("offscreen", false);
    l.run(5000);
    expect(r.steps()).toBe(before);
    a.set("hidden", false);
    expect(a.isRunning).toBe(true);
    l.run(1000);
    // one second's worth of steps, not eleven
    expect(Math.abs(r.steps() - before - 60)).toBeLessThanOrEqual(2);
    expect(Math.max(...r.draws)).toBeLessThanOrEqual(4);
  });

  it("does not run while reduced motion is set, or before start / after stop", () => {
    const l = loop();
    const r = recorder();
    const a = new Animator(r.draw, l.host);
    a.set("reduced", true);
    l.run(1000);
    a.start();
    l.run(1000);
    expect(r.draws).toEqual([]);
    a.set("reduced", false);
    l.run(1000);
    expect(r.draws.length).toBeGreaterThan(0);
    a.stop();
    const n = r.draws.length;
    l.run(1000);
    expect(r.draws.length).toBe(n);
    expect(l.pending()).toBe(0);
  });

  it("skips ahead at most MAX_STEPS after a stall", () => {
    const l = loop();
    const r = recorder();
    new Animator(r.draw, l.host).start();
    l.run(100);
    l.advance(5000); // the main thread was busy for 5 seconds
    l.run(100);
    expect(Math.max(...r.draws)).toBe(MAX_STEPS);
  });
});

describe("NULL_CONTEXT", () => {
  it("has every context member the scenes use", async () => {
    const { readFileSync, readdirSync } = await import("fs");
    const { NULL_CONTEXT } = await import("./animator");
    const dir = new URL("./scenes/", import.meta.url);
    const files = [...readdirSync(dir).map((f) => new URL(f, dir)), new URL("./draw.ts", import.meta.url)];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/\bctx\.(\w+)/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(3);
    for (const name of used) expect(NULL_CONTEXT, name).toHaveProperty(name);
  });
});
