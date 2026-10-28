// The animated hive. The scene module draws; this component owns the canvas,
// the animation loop, and feeds it the population after each tick.
import { useEffect, useRef } from "react";
import { HiveScene } from "../art/scene";
import { population } from "../art/population";
import { useStore } from "../game/GameContext";

const REDUCED = "(prefers-reduced-motion: reduce)";

export function HiveCanvas() {
  const store = useStore();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !canvas.getContext("2d")) return;
    const scene = new HiveScene(canvas);
    const media = window.matchMedia?.(REDUCED);
    scene.reduced = !!media?.matches;
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
    let lastPop = "";
    const update = () => {
      const pop = population(store.game);
      const key = JSON.stringify(pop);
      if (key === lastPop) return;
      lastPop = key;
      scene.setPopulation(pop);
      if (scene.reduced) scene.frame();
    };
    update();
    setMotion();
    media?.addEventListener?.("change", setMotion);
    const unsubscribe = store.subscribe(update);
    const offCommand = store.events.on("command", (cmd) => {
      if (cmd.unitname) scene.burst(cmd.unitname);
      else if (cmd.upgrade) scene.burst(cmd.upgrade.unit.name);
    });
    return () => {
      cancelAnimationFrame(raf);
      media?.removeEventListener?.("change", setMotion);
      unsubscribe();
      offCommand();
    };
  }, [store]);

  return (
    <section className="scene frame" aria-label="Your hive">
      <canvas ref={ref} role="img" aria-label="Animated view of your hive: drones carry meat to the pile while queens lay eggs" />
      <div className="scene-bar">
        <span>Your hive, live</span>
      </div>
    </section>
  );
}
