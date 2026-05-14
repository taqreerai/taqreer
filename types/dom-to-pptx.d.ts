declare module "dom-to-pptx" {
  export interface ExportOptions {
    fileName?: string;
    fonts?: Array<{ family: string; url: string }>;
    /**
     * When true, the library does ALL its work (including font embedding)
     * and returns the final Blob without auto-downloading it. Lets us run
     * post-processing on the Blob (BiDi fix, gradient sentinel swap) before
     * triggering our own download. Undocumented upstream but supported in
     * the v1.1.8 build we ship.
     */
    skipDownload?: boolean;
    /**
     * When true, inline `<svg>` elements are emitted as native OOXML vector
     * shapes (editable in PowerPoint, recolourable, infinite zoom) rather
     * than rasterised to PNG.
     */
    svgAsVector?: boolean;
    [key: string]: unknown;
  }

  /**
   * Conditional return type: `skipDownload: true` makes the library hand
   * back the final `.pptx` Blob; otherwise it triggers a download and
   * resolves with `void`.
   */
  export function exportToPptx<T extends ExportOptions>(
    target: string | HTMLElement | Array<string | HTMLElement>,
    options?: T
  ): Promise<T extends { skipDownload: true } ? Blob : void>;
}
