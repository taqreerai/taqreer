declare module "dom-to-pptx" {
  export interface ExportOptions {
    fileName?: string;
    fonts?: Array<{ family: string; url: string }>;
    [key: string]: unknown;
  }
  export function exportToPptx(
    target: string | HTMLElement | Array<string | HTMLElement>,
    options?: ExportOptions
  ): Promise<void>;
}
