import { useGameValue } from "../game/GameContext";
import { useFormat } from "../format";
import { tabHref, unitHref } from "../router";
import { SpriteIcon } from "./Icon";

function Resource({ name, label }: { name: string; label: string }) {
  const fmt = useFormat();
  const count = useGameValue((s) => fmt.num(s.game.unit(name).count()));
  const rate = useGameValue((s) => fmt.rate(s.game.unit(name).velocity(), { unit: name }));
  return (
    <a className="res frame" href={unitHref(name)} aria-label={`${label}: ${count}, ${rate}`}>
      <SpriteIcon name={name} size={26} />
      <b className="num">{count}</b>
      <span className="num">{rate}</span>
    </a>
  );
}

export function Header() {
  return (
    <header className="app-header">
      <a className="brand" href={tabHref("meat")}>
        SWARM<small>HIVE</small>
      </a>
      <Resource name="meat" label="Meat" />
      <Resource name="larva" label="Larvae" />
    </header>
  );
}
