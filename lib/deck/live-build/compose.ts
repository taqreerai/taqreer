// The live build's server half (2026-11-10): the slide the model is still
// writing, framed the way its finished version will be (ground, panel and
// well layers, canvas class), so the studio can play it while it streams.
//
// The text only ever GROWS between calls for the same slide: the frame
// layers come from the section's opening tag (fixed once written), then the
// model's well HTML verbatim. A complete section adds the closing layers.
// That is what lets the client's player keep its place between updates.
// What the finished slide adds later (the deck stylesheet inside the section,
// Latin-run isolation in Arabic decks, product photo refs) is not here: the
// stylesheet rides once per update as `liveCss`, and the finished slide
// replaces the live one when it lands.

import {
  assembleFramedSlide,
  latinizeDigits,
  normalizeWellRoot,
  parseFrameSlide,
  type FrameCanvas,
  type FrameDeckCtx,
  type FrameSlideDecl,
} from "@/lib/deck/frame";
import { withCanvasClass } from "@/lib/deck/scaffold";

export type LiveSlide = { index: number; html: string };

// The empty chrome layer closes every framed slide (frame.ts assembly).
const CHROME = '<div class="tq-chrome"';

/**
 * The live text for one slide, or null until its opening tag is complete.
 * `section` is the model's `<section ...>` so far (complete when `complete`).
 * `fixDecl` applies the same background fixes the finished slide gets.
 */
export function liveSlideText(opts: {
  section: string;
  complete: boolean;
  index: number;
  ctx: FrameDeckCtx;
  canvas: FrameCanvas;
  fixDecl?: (decl: FrameSlideDecl) => FrameSlideDecl;
}): string | null {
  const open = /^<section\b[^>]*>/i.exec(opts.section);
  if (!open) return null;
  const openTag = open[0];
  let decl = parseFrameSlide(`${openTag}</section>`);
  if (opts.fixDecl) decl = opts.fixDecl(decl);
  const assembled = assembleFramedSlide({ ...decl, wellHtml: "" }, opts.ctx, opts.index, opts.canvas);
  const chromeAt = assembled.indexOf(CHROME);
  if (chromeAt < 0) return null;
  // Up to and including the well's opening tag (the empty well's `</div>`
  // sits right before the chrome layer).
  const head = assembled.slice(0, chromeAt - "</div>".length);
  const tail = assembled.slice(chromeAt - "</div>".length);

  let well = opts.section.slice(openTag.length);
  if (opts.complete) well = well.replace(/<\/section>\s*$/i, "");
  // Only once the well's root tag is whole: normalising half a tag would
  // change text the player has already passed.
  if (/^\s*<div\b[^>]*>/i.test(well)) well = normalizeWellRoot(well);

  const text = latinizeDigits(head + well) + (opts.complete ? tail : "");
  return withCanvasClass(text);
}
