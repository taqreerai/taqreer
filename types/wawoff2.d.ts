declare module "wawoff2" {
  /** Decompress a WOFF2 buffer to a raw TTF/OTF byte array. */
  export function decompress(input: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  /** Compress a TTF/OTF byte array to a WOFF2 buffer. */
  export function compress(input: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  const _default: {
    decompress: typeof decompress;
    compress: typeof compress;
  };
  export default _default;
}
