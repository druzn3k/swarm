// #/art: every unit sprite, every upgrade and ability icon, and each tab's
// scene, for reviewing the art. Not linked from the game's menus.
import { spreadsheet } from "@swarmsim/engine";
import { SpriteIcon } from "../components/Icon";
import { SceneView } from "../components/HiveCanvas";
import { ICONS, framesFor, iconNameForUpgrade, spriteDataUrl } from "../art/sprites";
import type { Population } from "../art/scene";

type Row = { name: string; label?: string; tab?: string; class?: string; disabled?: boolean; unittype?: string };
const data = spreadsheet() as unknown as { unittypes: { elements: Row[] }; upgrades: { elements: Row[] } };
const TABS = ["meat", "larva", "territory", "energy", "mutagen"];

const all = (names: string[], log: number): Population => Object.fromEntries(names.map((n, i) => [n, log - i * 0.3]));
const MEAT_ALL = ["meat", "larva", "drone", "queen", "nest", "greaterqueen", "hive", "hivequeen", "empress", "prophet", "goddess", "pantheon", "pantheon2", "pantheon3", "pantheon4", "pantheon5", "overmind", "overmind2", "overmind3"];
const ARMY = ["territory", "swarmling", "stinger", "spider", "mosquito", "locust", "roach", "giantspider", "centipede", "wasp", "devourer", "goon"];
const MUTANTS = ["mutanthatchery", "mutantbat", "mutantclone", "mutantswarmwarp", "mutantrush", "mutanteach", "mutantfreq", "mutantnexus", "mutantarmy", "mutantmeat"];

const SCENES: [string, string, Population][] = [
  ["meat", "Meat: a new swarm", { meat: 2, larva: 1.3, drone: 1.2, queen: 0.2 }],
  ["meat", "Meat: late game", { ...all(MEAT_ALL, 12), meat: 30, larva: 20, drone: 25 }],
  ["larva", "Larva: a few", { larva: 1.5, cocoon: 0.3 }],
  ["larva", "Larva: millions", { larva: 30, cocoon: 25 }],
  ["territory", "Territory: first warriors", { territory: 1, swarmling: 1, stinger: 0.3 }],
  ["territory", "Territory: the full war band", { ...all(ARMY, 12), territory: 20 }],
  ["energy", "Energy: one nexus", { energy: 1, nexus: 0 }],
  ["energy", "Energy: five nexus", { energy: 4, nexus: Math.log10(5), crystal: 10, nightbug: 6, moth: 4, bat: 3 }],
  ["mutagen", "Mutagen: before ascending", { premutagen: 2, mutagen: -1 }],
  ["mutagen", "Mutagen: ascended", { ...all(MUTANTS, 6), mutagen: 9, premutagen: 3, ascension: 0.5 }],
];

const CSS = `
.art-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin: 8px 0 20px; }
.art-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; text-align: center; background: var(--burrow); border: 2px solid var(--edge); }
.art-cell b { font-size: 12px; line-height: 1.2; }
.art-cell code { font-size: 10px; color: var(--dust); word-break: break-all; }
.art-frames { display: flex; gap: 4px; align-items: center; }
.art-native { image-rendering: pixelated; }
.art-scenes { display: grid; gap: 12px; margin: 8px 0 20px; }
.art-page h2 { margin-top: 18px; }
`;

function Frames({ name }: { name: string }) {
  const frames = framesFor(name);
  return (
    <div className="art-frames">
      <SpriteIcon name={name} size={48} />
      {frames.length > 1 && <img className="px-icon art-native" src={spriteDataUrl(frames[1], 48 * 2)} alt="" width={48} height={48} />}
    </div>
  );
}

export function ArtGalleryScreen() {
  const units = data.unittypes.elements.filter((u) => u.name && u.label && !u.disabled);
  const upgrades = data.upgrades.elements.filter((u) => u.name && u.label && !u.disabled);
  return (
    <section className="page art-page" aria-labelledby="page-title">
      <style>{CSS}</style>
      <h1 id="page-title">Art gallery</h1>
      <p>Every unit sprite (with its second idle frame), every upgrade and ability icon, and each tab's scene.</p>

      {TABS.map((tab) => {
        const list = units.filter((u) => u.tab === tab);
        return (
          <div key={tab}>
            <h2>
              {tab} units ({list.length})
            </h2>
            <div className="art-grid">
              {list.map((u) => (
                <div className="art-cell" key={u.name} data-unit={u.name}>
                  <Frames name={u.name} />
                  <b>{u.label}</b>
                  <code>{u.name}</code>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <h2>Generic icons ({Object.keys(ICONS).length})</h2>
      <div className="art-grid">
        {Object.entries(ICONS).map(([name, s]) => (
          <div className="art-cell" key={name}>
            <img className="px-icon" src={spriteDataUrl(s, 96)} alt="" width={48} height={48} />
            <code>{name}</code>
          </div>
        ))}
      </div>

      <h2>Upgrades and abilities ({upgrades.length})</h2>
      <div className="art-grid">
        {upgrades.map((u) => (
          <div className="art-cell" key={u.name} data-upgrade={u.name}>
            <SpriteIcon name={u.name} kind="upgrade" size={48} />
            <b>{u.label}</b>
            <code>
              {u.name} → {u.class === "ability" ? "ability " : ""}
              {/^mutate/.test(u.name) && u.name !== "mutatehidden" ? "mutant" : iconNameForUpgrade(u.name)}
            </code>
          </div>
        ))}
      </div>

      <h2>Scenes</h2>
      <div className="art-scenes">
        {SCENES.map(([tab, label, pop]) => (
          <SceneView key={label} tab={tab} pop={pop} label={label} />
        ))}
      </div>
    </section>
  );
}
