// Port of services/parsenumber.coffee
import Decimal from "decimal.js";
import { numberSuffixesShort, numberSuffixesLong } from "./numbersuffixes";

/** The slice of a Unit that parseNumber uses. */
export interface ParseNumberUnit {
  maxCostMet(percent: Decimal): Decimal;
  count(): Decimal;
  twinMult(): Decimal;
}

const DecCeil = Decimal.clone({ rounding: Decimal.ROUND_CEIL });

interface SuffixExp {
  index: number;
  exp: number;
  replace: string;
}
const suffixToExp: { [suffix: string]: SuffixExp } = {};
for (const suffixes of [numberSuffixesShort, numberSuffixesLong]) {
  suffixes.forEach((suffix, index) => {
    if (suffix) {
      // no dupe suffixes, #517
      if (suffixToExp[suffix.toLowerCase()] != null) {
        throw new Error(`duplicate parsenumber suffix: ${suffix}`);
      }
      suffixToExp[suffix.toLowerCase()] = {
        index: index,
        exp: index * 3,
        replace: `e${index * 3}`,
      };
    }
  });
}

export function parseNumber(value0: any, unit?: ParseNumberUnit): Decimal | undefined {
  // stringify
  let value: any = (value0 + "").replace(",", "");
  // percentage of max buyable
  if (/%$/.exec(value) != null) {
    let percent: Decimal;
    try {
      percent = Decimal.min(100, Decimal.max(0, value.replace("%", "")));
    } catch (e) {
      percent = new Decimal(0);
    }
    value = unit!.maxCostMet(percent.dividedBy(100));
  }
  // replace suffixes ('billion')
  const match = /\ ?[a-zA-Z]+/.exec(value);
  if (match != null) {
    const exp = match.length > 0 ? suffixToExp[match[0].toLowerCase()] : undefined;
    if (exp != null) {
      value = value.replace(match[0], exp.replace);
    }
  }
  // exact-value, accounting for twins
  let notwins: boolean = false;
  let target: boolean = false;
  if (/^\=/.exec(value) != null) {
    notwins = true;
    value = value.replace("=", "");
    // target-value, buy enough units to have this many afterward
  } else if (/^@/.exec(value) != null) {
    target = true;
    notwins = true;
    value = value.replace("@", "");
  }
  try {
    // DecCeil is a Decimal that rounds up, avoidiing precision errors like
    // #671. `.ceil()` isn't good enough for large numbers here.
    let ret = DecCeil.max(1, value);
    if (target) {
      ret = DecCeil.max(1, ret.minus(unit!.count()));
    }
    if (notwins) {
      // twins round up - buy at least as many as requested.
      // this means "=12.5"x2 buys 26 units, not 24; no big deal either way
      ret = ret.dividedBy(unit!.twinMult()).ceil();
    } else {
      // normally, decimal numbers round down
      ret = ret.floor();
    }
    // return to normal rounding.
    const out = new Decimal(ret as any);
    if (out.isFinite() && !out.isNaN()) {
      return out;
    }
  } catch (e) {
    // parse error, return undefined. this is user input, don't fuss with logging
  }
  return undefined;
}
