// LZString.compressToBase64 from lz-string 1.4.4, rewritten for speed.
//
// Same algorithm and the same output, character for character (see
// test/lzbase64.test.ts): saves stay byte-compatible with the old game. The
// original keeps its dictionary in plain objects keyed by string and pushes
// one output character at a time through a callback; this numbers phrases
// instead of keying them by text, which is about twice as fast. Decompression still
// uses lz-string itself.

import LZString from "lz-string";

const KEY_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

// lz-string's dictionaries are plain objects: assigning their "__proto__" key
// does nothing and hasOwnProperty never finds it. Text containing it goes to
// lz-string itself, so it compresses the same too.
const PROTO = "__proto__";

export function compressToBase64(input: string | null | undefined): string {
  if (input == null) return "";
  // see PROTO; never the case for a save the game wrote
  if (input.includes(PROTO)) return LZString.compressToBase64(input);
  const res = compress6(input);
  switch (res.length % 4) {
    default:
    case 0:
      return res;
    case 1:
      return res + "===";
    case 2:
      return res + "==";
    case 3:
      return res + "=";
  }
}

function compress6(uncompressed: string): string {
  // Phrases are numbered as in lz-string: single characters and longer
  // phrases share one counter. A longer phrase is always a known phrase plus
  // one character, so it is looked up by (phrase number, char code) instead of
  // by its text.
  const chars = new Map<number, number>();
  const phrases = new Map<number, number>();
  // single characters seen but not yet written out literally
  const toCreate = new Set<number>();
  let wCode = -1; // phrase number of w; -1 while w is ""
  let wChar = -1; // char code of w when w is one character, else -1
  let enlargeIn = 2; // Compensate for the first entry which should not count
  let dictSize = 3;
  let numBits = 2;
  const out: string[] = [];
  let dataVal = 0;
  let dataPosition = 0;

  // write `bits` bits of `value`, lowest bit first, 6 bits per output character
  const write = (value: number, bits: number) => {
    for (let i = 0; i < bits; i++) {
      dataVal = (dataVal << 1) | (value & 1);
      if (dataPosition === 5) {
        dataPosition = 0;
        out.push(KEY_BASE64.charAt(dataVal));
        dataVal = 0;
      } else {
        dataPosition++;
      }
      value = value >> 1;
    }
  };
  const countDown = () => {
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  };
  // output the code for w
  const emit = () => {
    if (wChar >= 0 && toCreate.has(wChar)) {
      if (wChar < 256) {
        write(0, numBits);
        write(wChar, 8);
      } else {
        write(1, numBits);
        write(wChar, 16);
      }
      countDown();
      toCreate.delete(wChar);
    } else {
      write(wCode, numBits);
    }
    countDown();
  };

  for (let ii = 0; ii < uncompressed.length; ii++) {
    const c = uncompressed.charCodeAt(ii);
    let cCode = chars.get(c);
    if (cCode === undefined) {
      cCode = dictSize++;
      chars.set(c, cCode);
      toCreate.add(c);
    }
    if (wCode < 0) {
      // w + c is just c
      wCode = cCode;
      wChar = c;
      continue;
    }
    const key = wCode * 65536 + c;
    const wcCode = phrases.get(key);
    if (wcCode !== undefined) {
      wCode = wcCode;
      wChar = -1;
    } else {
      emit();
      // Add wc to the dictionary.
      phrases.set(key, dictSize++);
      wCode = cCode;
      wChar = c;
    }
  }
  if (wCode >= 0) emit();
  // Mark the end of the stream
  write(2, numBits);
  // Flush the last char
  for (;;) {
    dataVal = dataVal << 1;
    if (dataPosition === 5) {
      out.push(KEY_BASE64.charAt(dataVal));
      break;
    }
    dataPosition++;
  }
  return out.join("");
}
