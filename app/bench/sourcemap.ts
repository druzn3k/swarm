// Names for minified functions: a function's position in the built bundle,
// looked up in the build's source map, gives its place in the original
// source, where the name it was declared with can be read.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface RawMap {
  sources: string[];
  sourcesContent?: (string | null)[];
  mappings: string;
}

/** segments per generated line: [column, source, line, column] (absolute) */
type Segment = [number, number, number, number];

export class SourceMap {
  private lines: Segment[][] = [];

  constructor(private map: RawMap) {
    let src = 0;
    let line = 0;
    let col = 0;
    for (const text of map.mappings.split(";")) {
      const segs: Segment[] = [];
      let gen = 0;
      for (const seg of text.split(",")) {
        if (!seg) continue;
        const v = decodeVLQ(seg);
        gen += v[0];
        if (v.length >= 4) {
          src += v[1];
          line += v[2];
          col += v[3];
          segs.push([gen, src, line, col]);
        }
      }
      this.lines.push(segs);
    }
  }

  /** the original position of a generated one (0-based line and column) */
  original(line: number, column: number): { source: number; line: number; column: number } | undefined {
    const segs = this.lines[line];
    if (!segs?.length) return undefined;
    let best: Segment | undefined;
    for (const s of segs) {
      if (s[0] > column) break;
      best = s;
    }
    best ??= segs[0];
    return { source: best[1], line: best[2], column: best[3] };
  }

  /** the name a function starting at this generated position was declared with: `function Name`, `const Name =` */
  functionName(line: number, column: number): string | undefined {
    const pos = this.original(line, column);
    if (!pos) return undefined;
    const text = this.map.sourcesContent?.[pos.source]?.split("\n")[pos.line];
    if (!text) return undefined;
    let name: string | undefined;
    for (const m of text.matchAll(/(?:function\s*\*?\s*|(?:const|let|var|class)\s+)([A-Za-z_$][\w$]*)/g)) {
      if ((m.index ?? 0) <= pos.column) name = m[1];
    }
    return name;
  }
}

function decodeVLQ(s: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of s) {
    const digit = B64.indexOf(ch);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}
