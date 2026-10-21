// POST /api/projects/[id]/regenerate-partial
//
// Apply the user's draft AI comments (lib/api/partial-regen.ts). Body: empty,
// the server reads the draft comments from the DB.

import { applyAiComments } from "@/lib/api/partial-regen";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return applyAiComments(id);
}
