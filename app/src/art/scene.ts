// Framework-agnostic: the app's HiveCanvas component owns the canvas and the
// animation loop, and feeds in population() from ./population.
//
// The hive scene: a small pixel canvas that shows the swarm, one scene per
// tab. Real counts get huge (trillions), so each kind of creature is drawn
// on a log scale with a cap, and new kinds appear as they're unlocked.
import { W, H } from "./scenes/base";
import type { Population, Scene } from "./scenes/base";
import { MeatScene } from "./scenes/meat";
import { LarvaScene } from "./scenes/larva";
import { TerritoryScene } from "./scenes/territory";
import { EnergyScene } from "./scenes/energy";
import { MutagenScene } from "./scenes/mutagen";
import { NULL_CONTEXT } from "./animator";

export { W, H };
export type { Population };

export const SCENE_TABS = ["meat", "larva", "territory", "energy", "mutagen"] as const;
export type SceneTab = (typeof SCENE_TABS)[number];

/** the scene shown for a tab; anything else (e.g. "all") shows the burrow */
export function sceneFor(tab: string | undefined): SceneTab {
  return (SCENE_TABS as readonly string[]).includes(tab ?? "") ? (tab as SceneTab) : "meat";
}

export const SCENE_INFO: Record<SceneTab, { title: string; label: string }> = {
  meat: { title: "Your hive, live", label: "Animated view of your hive: drones carry meat to the pile while queens lay eggs" },
  larva: { title: "The egg chamber", label: "Animated egg chamber: larvae wriggle among eggs while cocoons hang from the ceiling" },
  territory: { title: "Your war band", label: "Animated battlefield: your army marches across the surface under your banners" },
  energy: { title: "The nexus chamber", label: "Animated nexus chamber: crystal spires glow while nightbugs and moths circle the light" },
  mutagen: { title: "The mutation lab", label: "Animated mutation lab: a vat of mutagen bubbles beneath the ascension rift" },
};

function make(tab: SceneTab): Scene {
  switch (tab) {
    case "larva":
      return new LarvaScene();
    case "territory":
      return new TerritoryScene();
    case "energy":
      return new EnergyScene();
    case "mutagen":
      return new MutagenScene();
    default:
      return new MeatScene();
  }
}

const DEFAULT_POP: Population = { meat: 1.5, larva: 1 };

export class HiveScene {
  private ctx: CanvasRenderingContext2D;
  private scene: Scene;
  private pop: Population = DEFAULT_POP;
  private _reduced = false;
  tab: SceneTab;

  constructor(
    private canvas: HTMLCanvasElement,
    tab: string = "meat"
  ) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.tab = sceneFor(tab);
    this.scene = make(this.tab);
  }

  /** prefers-reduced-motion: creatures stand still and no particles fly */
  get reduced(): boolean {
    return this._reduced;
  }
  set reduced(v: boolean) {
    this._reduced = v;
    this.scene.reduced = v;
  }

  setTab(tab: string): void {
    const next = sceneFor(tab);
    if (next === this.tab) return;
    this.tab = next;
    this.scene = make(next);
    this.scene.reduced = this._reduced;
    this.scene.setPopulation(this.pop);
  }

  setPopulation(pop: Population): void {
    this.pop = pop;
    this.scene.setPopulation(pop);
  }

  /** a little burst where a unit of this kind lives */
  burst(unit: string): void {
    this.scene.burst(unit);
  }

  /** Advance `steps` animation steps (one per 60 Hz frame) and draw the last. */
  frame(steps = 1): void {
    // the steps in between move creatures and particles without drawing
    for (let i = 1; i < steps; i++) this.scene.frame(NULL_CONTEXT);
    this.scene.frame(this.ctx);
  }
}
