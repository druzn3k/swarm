// The animated hive. The scene module draws; this component owns the canvas,
// the animation loop, and feeds it the population after each tick. The scene
// follows the current tab (#/tab/<tab>).
import { useEffect, useRef } from "react";
import { HiveScene, SCENE_INFO, sceneFor } from "../art/scene";
import type { Population } from "../art/scene";
import { population } from "../art/population";
import { Animator } from "../art/animator";
import { useStore } from "../game/GameContext";
import { useRoute } from "../router";

const REDUCED = "(prefers-reduced-motion: reduce)";
/** How often the hive re-reads the population on its own (counts drift slowly; purchases update it at once). */
const POPULATION_MILLIS = 500;

/**
 * Runs a scene's animation loop (see ../art/animator.ts): about 20 redraws a
 * second at the scenes' usual speed, paused while the canvas is off screen
 * or the page is hidden, and honouring reduced motion.
 */
function animate(scene: HiveScene, canvas: HTMLCanvasElement): { stop: () => void } {
  const media = window.matchMedia?.(REDUCED);
  const anim = new Animator((steps) => scene.frame(steps), {
    now: () => performance.now(),
    requestAnimationFrame: (fn) => window.requestAnimationFrame(fn),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  });
  const setMotion = () => {
    scene.reduced = !!media?.matches;
    // with reduced motion the hive is redrawn on game updates only
    if (scene.reduced) scene.frame();
    anim.set("reduced", scene.reduced);
  };
  const setHidden = () => anim.set("hidden", document.visibilityState === "hidden");
  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          const e = entries[entries.length - 1];
          if (e) anim.set("offscreen", !e.isIntersecting);
        });
  setHidden();
  setMotion();
  anim.start();
  io?.observe(canvas);
  media?.addEventListener?.("change", setMotion);
  document.addEventListener("visibilitychange", setHidden);
  return {
    stop: () => {
      anim.stop();
      io?.disconnect();
      media?.removeEventListener?.("change", setMotion);
      document.removeEventListener("visibilitychange", setHidden);
    },
  };
}

export function HiveCanvas({ tab: tabProp }: { tab?: string }) {
  const store = useStore();
  const route = useRoute();
  const tab = sceneFor(tabProp ?? (route.name === "tab" ? route.tab : undefined));
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !canvas.getContext("2d")) return;
    const scene = new HiveScene(canvas, tab);
    let lastPop = "";
    let lastAt = -Infinity;
    let dirty = false;
    // reading every unit's count is one of the bigger costs of a tick: a few times a second is plenty
    const update = () => {
      const now = performance.now();
      if (!dirty && now - lastAt < POPULATION_MILLIS) return;
      dirty = false;
      lastAt = now;
      const pop = population(store.game);
      const key = JSON.stringify(pop);
      if (key === lastPop) return;
      lastPop = key;
      scene.setPopulation(pop);
      if (scene.reduced) scene.frame();
    };
    update();
    const anim = animate(scene, canvas);
    const unsubscribe = store.subscribe(update);
    const offCommand = store.events.on("command", (cmd) => {
      dirty = true;
      if (cmd.unitname) scene.burst(cmd.unitname);
      else if (cmd.upgrade) scene.burst(cmd.upgrade.unit.name);
    });
    return () => {
      anim.stop();
      unsubscribe();
      offCommand();
    };
  }, [store, tab]);

  const info = SCENE_INFO[tab];
  return (
    <section className="scene frame" aria-label="Your hive" data-scene={tab}>
      <canvas ref={ref} role="img" aria-label={info.label} />
      <div className="scene-bar">
        <span>{info.title}</span>
      </div>
    </section>
  );
}

/** A scene with a fixed, made-up population (for the art gallery). No game needed. */
export function SceneView({ tab, pop, label }: { tab: string; pop: Population; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(pop);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !canvas.getContext("2d")) return;
    const scene = new HiveScene(canvas, tab);
    scene.setPopulation(JSON.parse(key) as Population);
    const anim = animate(scene, canvas);
    return anim.stop;
  }, [tab, key]);
  const info = SCENE_INFO[sceneFor(tab)];
  return (
    <section className="scene frame" aria-label={label ?? info.title} data-scene={sceneFor(tab)}>
      <canvas ref={ref} role="img" aria-label={info.label} />
      <div className="scene-bar">
        <span>{label ?? info.title}</span>
      </div>
    </section>
  );
}
