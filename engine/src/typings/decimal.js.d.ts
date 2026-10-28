// decimal.js 7.1.1 ships no type definitions (and we can't add @types/decimal.js
// to package.json from this package). Minimal declarations for the API used by
// the engine; extend as needed.
declare module "decimal.js" {
  namespace Decimal {
    type Value = string | number | Decimal;
    type Rounding = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    interface Config {
      precision?: number;
      rounding?: Rounding;
      toExpNeg?: number;
      toExpPos?: number;
      minE?: number;
      maxE?: number;
      crypto?: boolean;
      modulo?: Rounding;
      [key: string]: any;
    }
  }
  class Decimal {
    constructor(n: Decimal.Value);
    readonly d: number[];
    readonly e: number;
    readonly s: number;

    absoluteValue(): Decimal;
    abs(): Decimal;
    ceil(): Decimal;
    comparedTo(n: Decimal.Value): number;
    cmp(n: Decimal.Value): number;
    cosine(): Decimal;
    cos(): Decimal;
    cubeRoot(): Decimal;
    cbrt(): Decimal;
    decimalPlaces(): number;
    dp(): number;
    dividedBy(n: Decimal.Value): Decimal;
    div(n: Decimal.Value): Decimal;
    dividedToIntegerBy(n: Decimal.Value): Decimal;
    divToInt(n: Decimal.Value): Decimal;
    equals(n: Decimal.Value): boolean;
    eq(n: Decimal.Value): boolean;
    floor(): Decimal;
    greaterThan(n: Decimal.Value): boolean;
    gt(n: Decimal.Value): boolean;
    greaterThanOrEqualTo(n: Decimal.Value): boolean;
    gte(n: Decimal.Value): boolean;
    isFinite(): boolean;
    isInteger(): boolean;
    isInt(): boolean;
    isNaN(): boolean;
    isNegative(): boolean;
    isNeg(): boolean;
    isPositive(): boolean;
    isPos(): boolean;
    isZero(): boolean;
    lessThan(n: Decimal.Value): boolean;
    lt(n: Decimal.Value): boolean;
    lessThanOrEqualTo(n: Decimal.Value): boolean;
    lte(n: Decimal.Value): boolean;
    logarithm(n?: Decimal.Value): Decimal;
    log(n?: Decimal.Value): Decimal;
    minus(n: Decimal.Value): Decimal;
    sub(n: Decimal.Value): Decimal;
    modulo(n: Decimal.Value): Decimal;
    mod(n: Decimal.Value): Decimal;
    naturalExponential(): Decimal;
    exp(): Decimal;
    naturalLogarithm(): Decimal;
    ln(): Decimal;
    negated(): Decimal;
    neg(): Decimal;
    plus(n: Decimal.Value): Decimal;
    add(n: Decimal.Value): Decimal;
    precision(z?: boolean | number): number;
    sd(z?: boolean | number): number;
    round(): Decimal;
    sine(): Decimal;
    sin(): Decimal;
    squareRoot(): Decimal;
    sqrt(): Decimal;
    tangent(): Decimal;
    tan(): Decimal;
    times(n: Decimal.Value): Decimal;
    mul(n: Decimal.Value): Decimal;
    toDecimalPlaces(dp?: number, rm?: number): Decimal;
    toDP(dp?: number, rm?: number): Decimal;
    toExponential(dp?: number, rm?: number): string;
    toFixed(dp?: number, rm?: number): string;
    toNumber(): number;
    toPower(n: Decimal.Value): Decimal;
    pow(n: Decimal.Value): Decimal;
    toPrecision(sd?: number, rm?: number): string;
    toSignificantDigits(sd?: number, rm?: number): Decimal;
    toSD(sd?: number, rm?: number): Decimal;
    toString(): string;
    toJSON(): string;
    truncated(): Decimal;
    trunc(): Decimal;
    valueOf(): string;

    static readonly ROUND_UP: 0;
    static readonly ROUND_DOWN: 1;
    static readonly ROUND_CEIL: 2;
    static readonly ROUND_FLOOR: 3;
    static readonly ROUND_HALF_UP: 4;
    static readonly ROUND_HALF_DOWN: 5;
    static readonly ROUND_HALF_EVEN: 6;
    static readonly ROUND_HALF_CEIL: 7;
    static readonly ROUND_HALF_FLOOR: 8;
    static readonly EUCLID: 9;

    static abs(n: Decimal.Value): Decimal;
    static ceil(n: Decimal.Value): Decimal;
    static clone(config?: Decimal.Config): typeof Decimal;
    static config(config: Decimal.Config): typeof Decimal;
    static set(config: Decimal.Config): typeof Decimal;
    static exp(n: Decimal.Value): Decimal;
    static floor(n: Decimal.Value): Decimal;
    static ln(n: Decimal.Value): Decimal;
    static log(n: Decimal.Value, base?: Decimal.Value): Decimal;
    static log10(n: Decimal.Value): Decimal;
    static log2(n: Decimal.Value): Decimal;
    static max(...n: Decimal.Value[]): Decimal;
    static min(...n: Decimal.Value[]): Decimal;
    static mod(x: Decimal.Value, y: Decimal.Value): Decimal;
    static pow(base: Decimal.Value, exponent: Decimal.Value): Decimal;
    static random(sd?: number): Decimal;
    static round(n: Decimal.Value): Decimal;
    static sqrt(n: Decimal.Value): Decimal;
    static sub(x: Decimal.Value, y: Decimal.Value): Decimal;
    static sum(...n: Decimal.Value[]): Decimal;
    static trunc(n: Decimal.Value): Decimal;
    static isDecimal(object: any): boolean;
  }
  export default Decimal;
  export { Decimal };
}
