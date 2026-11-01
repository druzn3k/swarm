// Regenerates format.tsv and prec.tsv from decimal.js 7.1.1 (the engine's version)
// and a copy of formatNumber from app/src/format.ts. Run from the repo root:
//   node rust/crates/num/tests/data/gen.js engine/node_modules/decimal.js
const Decimal = require(require("path").resolve(process.argv[2]));
const OUT = __dirname;
const short = [], long = [];
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../../../../engine/src/numbersuffixes.ts"), "utf8");
const S = JSON.parse(src.match(/numberSuffixesShort: string\[\] = (\[.*?\]);/)[1]);
const L = JSON.parse(src.match(/numberSuffixesLong: string\[\] = (\[.*?\]);/s)[1]);
const DecFloor = Decimal.clone({ rounding: Decimal.ROUND_FLOOR });
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
function suffixFor(notation, flavor, index) {
  if (index < 0) return "";
  switch (notation) {
    case "engineering": return index === 0 ? "" : `E${index * 3}`;
    case "scientific-e": return undefined;
    default: { const list = flavor === "full" ? L : S; const limit = notation === "hybrid" ? 12 : list.length; return index < limit ? list[index] || "" : undefined; }
  }
}
function trimZeros(s) { return s.replace(/(\.\d*?)0+(?=\D|$)/, "$1").replace(/\.(?=\D|$)/, ""); }
function formatNumber(value, opts = {}) {
  const flavor = opts.flavor ?? "short"; const notation = opts.notation ?? "standard-decimal";
  const sigfigs = opts.sigfigs ?? (flavor === "full" ? 5 : 3); const minSuffix = opts.minSuffix ?? 1e5; const maxSmall = opts.maxSmall ?? 0;
  const val = new DecFloor(value); const abs = val.abs();
  if (abs.lessThan(maxSmall)) return trimZeros(val.toPrecision(sigfigs, Decimal.ROUND_FLOOR));
  if (abs.lessThan(minSuffix)) return nf.format(Math.floor(val.toNumber()));
  const index = Math.floor(val.e / 3); const suffix = suffixFor(notation, flavor, index);
  if (suffix == null) return trimZeros(val.toExponential(sigfigs - 1, Decimal.ROUND_FLOOR).replace("e+", "e"));
  const prefix = val.dividedBy(new DecFloor(`1e${index * 3}`)).toPrecision(sigfigs, Decimal.ROUND_FLOOR);
  return trimZeros(prefix) + suffix;
}
const vals = ["0","1","-1","12.5","999","1000","12345","99999","99999.9","100000","123456","999999","1000000","1234567","-1234567","98765432","1e9","1.5e12","2.345678e15","1e21","1.23456789e30","7.77e100","1e272","1.5e273","1e274","1e300","1.5e303","1e100000","-3.2e500","0.5","0.0123","123.456"];
const notations = ["standard-decimal","scientific-e","hybrid","engineering"];
const out = [];
for (const v of vals) for (const n of notations) for (const fl of ["short","full"]) {
  out.push([v, n, fl, "", "", formatNumber(v, {notation:n, flavor:fl})]);
}
for (const v of ["0.5","0.0123","123.456","1.23456","-2.5", "1500.75"]) for (const ms of [1e3]) for (const sf of [3, 6]) out.push([v,"standard-decimal","short",String(sf),String(ms),formatNumber(v,{sigfigs:sf,maxSmall:ms})]);
for (const v of ["1234567","123456","8000000","1.23456789e15"]) out.push([v,"standard-decimal","full","6","",formatNumber(v,{flavor:"full",sigfigs:6})]);
fs.writeFileSync(OUT + "/format.tsv", out.map(r=>r.join("\t")).join("\n")+"\n");
// toPrecision / toFixed / toExponential / toString of decimal.js (half up)
const p = [];
const pv = ["0","1","-1","123.456","0.000123456","1e-7","1.5e-7","123456789","1e21","9.995","99.95","0.5","-0.0015","1234.5678","1.5e300","-2.5e-300","999999","0.000001"];
for (const v of pv) { const d = new Decimal(v);
  for (const k of [1,2,3,5,8]) p.push(["prec", v, String(k), d.toPrecision(k)]);
  for (const k of [0,1,2,4]) p.push(["fixed", v, String(k), d.toFixed(k)]);
  for (const k of [0,2,4]) p.push(["exp", v, String(k), d.toExponential(k)]);
}
fs.writeFileSync(OUT + "/prec.tsv", p.map(r=>r.join("\t")).join("\n")+"\n");
