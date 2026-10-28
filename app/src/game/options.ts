// Player options, stored where the old game kept them: inside the save, in
// `session.state.options` (services/options.coffee). So they travel with
// exported and imported saves. Only the options this app uses are read;
// unknown keys (themes, fps, ...) from old saves are left alone.
import { useCallback, useMemo } from "react";
import type { Game } from "@swarmsim/engine";

/** anything holding a save state: an engine Session, or game.session */
type HasState = { state: object };
import { createFormatter, VELOCITY_SECOND } from "../format";
import type { DurationFormat, Formatter, Notation, VelocityUnit } from "../format";
import { useGameValue, useStore } from "./GameContext";
import type { GameStore } from "./store";

export interface Options {
  notation: Notation;
  /** a VELOCITY_UNITS name */
  velocityUnit: string;
  durationFormat: DurationFormat;
  showAdvancedUnitData: boolean;
  /** the territory production chart (old options.showCharts, default on) */
  showCharts: boolean;
}

export const OPTION_DEFAULTS: Options = {
  notation: "standard-decimal",
  velocityUnit: "sec",
  durationFormat: "abbreviated",
  showAdvancedUnitData: false,
  showCharts: true,
};

export const NOTATIONS: Notation[] = ["standard-decimal", "scientific-e", "hybrid", "engineering"];
export const DURATION_FORMATS: DurationFormat[] = ["abbreviated", "human", "full"];

interface VelocityUnitDef {
  name: string;
  label: string;
  plural: string;
  /** a fixed multiplier, or one read from the game (swarmwarp) */
  mult: number | ((game: Game) => number);
}

/** Old Options.VELOCITY_UNITS, in order. */
export const VELOCITY_UNITS: VelocityUnitDef[] = [
  VELOCITY_SECOND,
  { name: "min", label: "minute", plural: "minutes", mult: 60 },
  { name: "hr", label: "hour", plural: "hours", mult: 60 * 60 },
  { name: "day", label: "day", plural: "days", mult: 60 * 60 * 24 },
  { name: "warp", label: "Swarmwarp", plural: "Swarmwarps", mult: (game) => warpSeconds(game) },
];

function warpSeconds(game: Game): number {
  try {
    return Number(game.upgrade("swarmwarp").effect[0].output()) || 1;
  } catch {
    return 1;
  }
}

function stored(session: HasState): Record<string, unknown> {
  return (session.state as { options?: Record<string, unknown> }).options ?? {};
}

/** The options in a session, with the old defaults for missing or invalid values. */
export function readOptions(session: HasState): Options {
  const o = stored(session);
  const pick = <T>(val: unknown, valid: readonly T[], def: T): T => (valid.includes(val as T) ? (val as T) : def);
  return {
    notation: pick(o.notation, NOTATIONS, OPTION_DEFAULTS.notation),
    velocityUnit: pick(
      o.velocityUnit,
      VELOCITY_UNITS.map((v) => v.name),
      OPTION_DEFAULTS.velocityUnit
    ),
    durationFormat: pick(o.durationFormat, DURATION_FORMATS, OPTION_DEFAULTS.durationFormat),
    showAdvancedUnitData: !!o.showAdvancedUnitData,
    showCharts: o.showCharts == null ? true : !!o.showCharts,
  };
}

/** Set one option and save, like the old Options#set. Throws on an invalid value. */
export function writeOption<K extends keyof Options>(game: Game, key: K, value: Options[K]): void {
  const valid: { [k in keyof Options]: (v: unknown) => boolean } = {
    notation: (v) => NOTATIONS.includes(v as Notation),
    velocityUnit: (v) => VELOCITY_UNITS.some((u) => u.name === v),
    durationFormat: (v) => DURATION_FORMATS.includes(v as DurationFormat),
    showAdvancedUnitData: (v) => typeof v === "boolean",
    showCharts: (v) => typeof v === "boolean",
  };
  if (!valid[key](value)) throw new Error(`invalid option for ${key}: ${String(value)}`);
  game.withUnreifiedSave(() => {
    game.session.state.options ??= {};
    game.session.state.options[key] = value;
  });
}

/**
 * The velocity unit rates are shown in (old Options#getVelocityUnit).
 * Swarmwarps produce no energy, so energy and nexus rates fall back to seconds.
 */
export function velocityUnitFor(game: Game, name: string, about: { unit?: string; prod?: string } = {}): VelocityUnit {
  let def = VELOCITY_UNITS.find((v) => v.name === name);
  if (!def || (def.name === "warp" && (about.unit === "energy" || about.prod === "nexus"))) def = VELOCITY_UNITS[0];
  const mult = typeof def.mult === "function" ? def.mult(game) : def.mult;
  return { name: def.name, label: def.label, plural: def.plural, mult };
}

/** A Formatter for these options; the warp multiplier is read from the game on each use. */
export function formatterFor(game: Game, options: Options): Formatter {
  return createFormatter({
    notation: options.notation,
    durationFormat: options.durationFormat,
    velocityUnit: velocityUnitFor(game, options.velocityUnit),
    resolveVelocityUnit: (about) => velocityUnitFor(game, options.velocityUnit, about),
  });
}

const optionsKey = (s: GameStore) => {
  const o = readOptions(s.engine.session);
  return `${o.notation}|${o.velocityUnit}|${o.durationFormat}|${o.showAdvancedUnitData ? 1 : 0}|${o.showCharts ? 1 : 0}`;
};

/** The current options (re-renders when they change, e.g. after an import) and a setter. */
export function useOptions(): [Options, <K extends keyof Options>(key: K, value: Options[K]) => void] {
  const store = useStore();
  const key = useGameValue(optionsKey);
  const options = useMemo(() => readOptions(store.engine.session), [store, key]);
  const set = useCallback(
    <K extends keyof Options>(k: K, v: Options[K]) => {
      store.act(({ game }) => writeOption(game, k, v));
    },
    [store]
  );
  return [options, set];
}

/** The Formatter for the player's options (main.tsx provides it). */
export function useOptionsFormatter(): Formatter {
  const store = useStore();
  const [options] = useOptions();
  return useMemo(() => formatterFor(store.game, options), [store, options]);
}
