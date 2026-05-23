// Shared comment types — used by the comments API routes (server) and
// the canvas drag-box editor (client). Mirrors the Prisma `Comment`
// model minus internal columns we don't render. `boundsJson` lives in
// slide-space — server validation accepts 0..1920 on BOTH x AND y so
// the same envelope covers 16:9 (1920×1080) and 9:16 (1080×1920); the
// renderer / lightbox clamps to the actual `canvasW`/`canvasH` of the
// active slide format before drawing.

export type CommentBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CommentAuthor = {
  id: string;
  name: string | null;
  // Email intentionally NOT in the wire shape — exposing it to
  // every commenter on the deck would turn the panel into a PII
  // directory. Name + image is all the UI renders; falls back to
  // `?` initial when name is null.
  image: string | null;
};

export type CommentRow = {
  id: string;
  presentationId: string;
  versionId: string;
  slideId: string;
  content: string;
  // Nullable in the DB so future scopes (e.g. _global) can omit a
  // bounding box. v1 always sends bounds; clients skip rendering
  // pins without bounds rather than failing on them.
  boundsJson: CommentBounds | null;
  status: string;
  createdAt: string;
  // Phase 15.D — author surfaces the commenter's name + avatar in
  // the CommentsPanel. Null for legacy rows authored before the
  // migration; UI shows "غير معروف" in that case.
  authorId: string | null;
  author: CommentAuthor | null;
};
