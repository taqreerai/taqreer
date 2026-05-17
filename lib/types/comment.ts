// Shared comment types — used by the comments API routes (server) and
// the canvas drag-box editor (client). Mirrors the Prisma `Comment`
// model minus internal columns we don't render. `boundsJson` lives in
// slide-space (0..1920 × 0..1080) so it survives viewport changes.

export type CommentBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
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
};
