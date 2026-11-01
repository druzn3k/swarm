import { Num } from "@swarmsim/engine-wasm";
import { useView } from "../game/GameContext";
import { useFormat } from "../format";
import { tabHref, unitHref } from "../router";
import { SpriteIcon } from "./Icon";

function Resource({ name, label }: { name: string; label: string }) {
  const fmt = useFormat();
  const count = useView((g) => fmt.num(g.unit(name).count));
  const rate = useView((g) => {
    const v = g.unit(name).velocity;
    // fmt.rate keeps the old "1.00" style; a plain zero reads better than "+0.00" here
    return Num.isZero(v) ? `+0/${fmt.velocityUnit({ unit: name }).name}` : fmt.rate(v, { unit: name });
  });
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
