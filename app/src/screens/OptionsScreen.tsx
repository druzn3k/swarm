// The options screen (old views/options.html): number, velocity and duration
// formats with live examples, advanced unit data, and save import/export/reset.
// Options live in the save (game/options.ts), so they travel with exports.
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useGame } from "../game/GameContext";
import { useFormat, createFormatter } from "../format";
import type { DurationFormat, Notation } from "../format";
import { useOptions, VELOCITY_UNITS, velocityUnitFor } from "../game/options";
import { ExportSave, ImportSave, ResetGame } from "../components/meta/SaveTools";
import { fromNow } from "../components/meta/time";
import "../styles/meta.css";

const NOTATION_LABELS: { value: Notation; label: string }[] = [
  { value: "standard-decimal", label: "Standard decimal" },
  { value: "scientific-e", label: "Scientific-E" },
  { value: "hybrid", label: "Hybrid" },
  { value: "engineering", label: "Engineering" },
];

const DURATION_LABELS: { value: DurationFormat; label: string }[] = [
  { value: "abbreviated", label: "Exact" },
  { value: "human", label: "Approximate" },
];

// the old screen's examples: 16s, 163s, 2.5h, 3.33 weeks, 2.22 months, 1.2 years
const DURATION_EXAMPLES = [16, 163, 2.5 * 3600, 3.33333333 * 7 * 86400, 2.222222222222 * 30 * 86400, 1.2 * 365 * 86400];

function Choice({ name, checked, onChange, label, example }: { name: string; checked: boolean; onChange: () => void; label: string; example?: ReactNode }) {
  return (
    <label className={"choice" + (checked ? " on" : "")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="choice-label">{label}</span>
      {example != null && <span className="choice-example num">{example}</span>}
    </label>
  );
}

function OptionGroup({ title, children, example }: { title: string; children: ReactNode; example?: ReactNode }) {
  const id = useId();
  return (
    <fieldset className="section card option-group" aria-describedby={example ? id + "ex" : undefined}>
      <legend className="option-title">{title}</legend>
      <div className="choices">{children}</div>
      {example && (
        <p className="option-example num" id={id + "ex"}>
          {example}
        </p>
      )}
    </fieldset>
  );
}

export function OptionsScreen() {
  const store = useGame();
  const fmt = useFormat();
  const [options, setOption] = useOptions();
  const [exportKey, setExportKey] = useState(0);
  const nameNotation = useId();
  const nameVelocity = useId();
  const nameDuration = useId();
  const advId = useId();
  const { game } = store;
  const durationChoices = DURATION_LABELS.some((d) => d.value === options.durationFormat)
    ? DURATION_LABELS
    : [...DURATION_LABELS, { value: options.durationFormat, label: "Full" }];
  const big = 123456789e30;

  return (
    <section className="page options" aria-labelledby="page-title">
      <h1 id="page-title">Options</h1>

      <OptionGroup
        title="Number format"
        example={
          <>
            Examples: {fmt.long(123456789)}, {fmt.num(123456789)}, {fmt.long(big)}, {fmt.num(big)}
          </>
        }
      >
        {NOTATION_LABELS.map((n) => (
          <Choice
            key={n.value}
            name={nameNotation}
            label={n.label}
            checked={options.notation === n.value}
            onChange={() => setOption("notation", n.value)}
            example={createFormatter({ notation: n.value }).num(big)}
          />
        ))}
      </OptionGroup>

      <OptionGroup
        title="Rates per"
        example={
          <>
            Example: {fmt.long(fmt.velocityUnit().mult * 10)} meat/{fmt.velocityUnit().name}
          </>
        }
      >
        {VELOCITY_UNITS.map((v) => (
          <Choice
            key={v.name}
            name={nameVelocity}
            label={v.plural}
            checked={options.velocityUnit === v.name}
            onChange={() => setOption("velocityUnit", v.name)}
            example={`${fmt.long(velocityUnitFor(game, v.name).mult * 10)}/${v.name}`}
          />
        ))}
      </OptionGroup>
      {options.velocityUnit === "warp" && (
        <p className="muted small note">Energy is always shown per second: Swarmwarps don't produce energy.</p>
      )}

      <OptionGroup
        title="Durations"
        example={<>Examples: {DURATION_EXAMPLES.map((s) => fmt.duration(s)).join(", ")}</>}
      >
        {durationChoices.map((d) => (
          <Choice
            key={d.value}
            name={nameDuration}
            label={d.label}
            checked={options.durationFormat === d.value}
            onChange={() => setOption("durationFormat", d.value)}
            example={createFormatter({ durationFormat: d.value }).duration(163)}
          />
        ))}
      </OptionGroup>

      <div className="section card option-group">
        <label className="choice switch" htmlFor={advId}>
          <input
            id={advId}
            type="checkbox"
            checked={options.showAdvancedUnitData}
            onChange={(e) => setOption("showAdvancedUnitData", e.target.checked)}
          />
          <span className="choice-label">Show advanced unit data</span>
        </label>
        <p className="muted small">Show more detailed numbers on each unit's screen: what your maximum costs as a share of your stock, and how fast your income could buy it.</p>
      </div>

      <section className="section card" aria-labelledby="save-title">
        <h2 id="save-title">Saved game</h2>
        <ExportSave key={exportKey} />
        <ImportSave onImported={() => setExportKey((k) => k + 1)} />
        <p className="muted small">
          It's normal for imported saves to have more units than you exported with: your swarm keeps working after you export. Your progress
          saves in this browser.
        </p>
      </section>

      <section className="section card danger-zone" aria-labelledby="reset-title">
        <h2 id="reset-title">Start over</h2>
        <ResetGame />
        <p className="muted small">You started playing {fromNow(game.dateStarted(), game.now)}.</p>
      </section>
    </section>
  );
}
