// lz-string 1.4.4 ships only a global-namespace typing; declare the module form.
declare module "lz-string" {
  const LZString: {
    compressToBase64(input: string): string;
    decompressFromBase64(input: string): string | null;
    compressToUTF16(input: string): string;
    decompressFromUTF16(compressed: string): string | null;
    compress(input: string): string;
    decompress(compressed: string): string | null;
  };
  export = LZString;
}
