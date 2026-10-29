// The fast compressToBase64 must write exactly what lz-string 1.4.4 writes,
// so saves stay byte-identical with the old game.
import * as fs from "fs";
import * as path from "path";
import LZString from "lz-string";
import { compressToBase64 } from "../src/lzbase64";
import { createGame } from "../src";
import seedrandom from "seedrandom";

function same(input: string): void {
  expect(compressToBase64(input)).toBe(LZString.compressToBase64(input));
}

describe("compressToBase64", () => {
  it("matches lz-string on edge cases", () => {
    expect(compressToBase64(null)).toBe("");
    expect(compressToBase64(undefined)).toBe("");
    for (const s of ["", "a", "aa", "ab", "aaaaaaaaaaaaaaaaaaaa", "é", "€€€", "😀😀x", "ÿĀ", "__proto__", "x__proto____proto__y", "__proto_"]) {
      same(s);
    }
  });

  it("matches lz-string on random text", () => {
    const rand = seedrandom("lzbase64");
    const alphabets = ["ab", "ab_c", "abc𝄞éĀxyz_proto", '{"a":1,"b":[2,3]}0123456789'];
    for (let i = 0; i < 2000; i++) {
      const alpha = alphabets[i % alphabets.length];
      const n = Math.floor(rand() * (i % 50 === 0 ? 5000 : 300));
      let s = "";
      for (let j = 0; j < n; j++) s += alpha[Math.floor(rand() * alpha.length)];
      same(s);
    }
  });

  it("matches lz-string on real save states", () => {
    const dir = path.join(__dirname, "golden");
    let saves = 0;
    for (const file of fs.readdirSync(dir)) {
      const golden = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const save: string | undefined = golden.start?.save;
      if (!save) continue;
      const { session } = createGame({ save, now: () => new Date(golden.start.now) });
      const json = JSON.stringify(session.state);
      same(json);
      same(json.repeat(4));
      saves++;
    }
    expect(saves).toBeGreaterThan(0);
  });
});
