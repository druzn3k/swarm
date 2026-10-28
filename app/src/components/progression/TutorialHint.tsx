// The old step-by-step hints for new players (directives/tutorial.coffee),
// as a card above the screen. Each step can be dismissed; the next step shows
// again when the player gets there.
import { useState } from "react";
import type { ReactNode } from "react";
import { useGameValue } from "../../game/GameContext";
import { tutorialStep } from "../../game/tutorial";
import { unitHref } from "../../router";
import "../../styles/progression.css";

const DISMISSED_KEY = "swarmhive-tutorial-dismissed";

function loadDismissed(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}
function saveDismissed(steps: number[]): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(steps));
  } catch {
    /* not remembered after a reload; fine */
  }
}

const U = ({ unit, children }: { unit: string; children: ReactNode }) => <a href={unitHref(unit)}>{children}</a>;

/** The old text, with "click/select" made "tap" and the arrow icon described. */
export function tutorialText(step: number): ReactNode {
  switch (step) {
    case 1:
      return (
        <>
          <p>Welcome to Swarm Simulator. Starting with just a few larvae and a small pile of meat, grow a massive swarm of giant bugs.</p>
          <p>
            Your brood starts its life with a small pile of meat and a single larva-producing hatchery. Larvae mutate into other units. Begin your growth by
            using your meat and larvae to hatch some <U unit="drone">drones</U>.
          </p>
        </>
      );
    case 2:
      return <p>You lead a small brood of worker drones. Drones gather meat. Use this meat to build more drones and expand your brood.</p>;
    case 3:
      return (
        <p>
          You lead a small brood of worker drones. Once you have plenty of meat, upgrade your hatchery to produce more larvae by tapping '
          <U unit="larva">larvae</U>' and spending some meat.
        </p>
      );
    case 11:
      return (
        <p>
          An amber marker <span className="tut-dot" role="img" aria-label="(new upgrade marker)" /> appears when you have enough meat to upgrade your hatchery.
        </p>
      );
    case 4:
      return (
        <p>
          You lead a small brood of worker drones. They long for a <U unit="queen">queen</U>. You must sacrifice many drones to hatch a queen, but once born,
          your queen will slowly hatch drones without consuming meat or larvae.
        </p>
      );
    case 5:
      return <p>Hatch more queens to grow your swarm. Hatching drones with the "Twin Drones" upgrade will allow you to rapidly raise more queens.</p>;
    case 6:
      return (
        <p>
          Queens have rapidly grown your swarm, and your growth demands more <U unit="territory">territory</U>. Begin capturing{" "}
          <U unit="territory">territory</U> by building military units - swarmlings or stingers.
        </p>
      );
    case 7:
      return <p>Your warriors have slowly begun securing territory. Continue expanding your military.</p>;
    case 8:
      return (
        <p>
          Your warriors have captured a lot of territory, and soon you can secure your first expansion. Expansions increase larva production. Tap '
          <U unit="larva">larvae</U>' to expand.
        </p>
      );
    case 9:
      return (
        <p>
          Expansion is the key to growing your swarm rapidly. Build a large military to expand your territory and produce more larvae. Build more queens and,
          eventually, nests to produce more meat for your military.
        </p>
      );
    case 10:
      return (
        <p>
          Your swarm has grown large enough to <b>ascend</b> - gain even greater power and restart on a new world! Take a look at the{" "}
          <U unit="mutagen">mutagen tab</U>.
        </p>
      );
    case 100:
      return (
        <p>
          Congratulations on your first ascension! Mutations can make your swarm much more powerful. Mutagen you haven't spent yet will produce some larvae -
          don't spend it all right away!
        </p>
      );
    default:
      return null;
  }
}

export function TutorialHint() {
  const step = useGameValue((s) => tutorialStep(s.game));
  const [dismissed, setDismissed] = useState(loadDismissed);
  const text = tutorialText(step);
  if (!step || !text || dismissed.includes(step)) return null;
  const dismiss = () => {
    const next = [...dismissed, step];
    setDismissed(next);
    saveDismissed(next);
  };
  return (
    <aside className="hint tutorial" aria-label="Tutorial" data-slot="tutorial" data-step={step}>
      <div className="hint-body">{text}</div>
      <button type="button" className="icon-btn" aria-label="Dismiss tip" onClick={dismiss}>
        ✕
      </button>
    </aside>
  );
}
