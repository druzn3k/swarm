// The animated hive. The scene module draws; this component owns the canvas,
// the animation loop, and feeds it the population after each tick. The scene
// follows the current tab (#/tab/<tab>).
import { useEffect, useRef } from "react";
import { HiveScene, SCENE_INFO, sceneFor } from "../art/scene";
import type { Population } from "../art/scene";
import { population } from "../art/population";
import { useStore } from "../game/GameContext";
import { useRoute } from "../router";

const REDUCED = "(prefers-reduced-motion: reduce)";
/** How often the hive re-reads the population on its own (counts drift slowly; purchases update it at once). */
const POPULATION_MILLIS = 500;

/** Runs a scene's animation loop, honouring reduced motion. */
function animate(scene: HiveScene): { stop: () => void } {
  const media = window.matchMedia?.(REDUCED);
  let raf = 0;
  const loop = () => {
    scene.frame();
    raf = requestAnimationFrame(loop);
  };
  const setMotion = () => {
    scene.reduced = !!media?.matches;
    cancelAnimationFrame(raf);
    // with reduced motion the hive is redrawn on game updates only
    if (scene.reduced) scene.frame();
    else raf = requestAnimationFrame(loop);
  };
  setMotion();
  media?.addEventListener?.("change", setMotion);
  return {
    stop: () => {
      cancelAnimationFrame(raf);
      media?.removeEventListener?.("change", setMotion);
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
    const anim = animate(scene);
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
    const anim = animate(scene);
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
