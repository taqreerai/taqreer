// Admin > Compare (server). Paste a deck link or id to open it next to the file
// it was made from. Recent decks link here from the Decks tab too.

import { requireAdminPage } from "@/lib/api/admin-context";
import { CompareLookup } from "@/components/admin/CompareClient";

export const dynamic = "force-dynamic";

export default async function AdminComparePage() {
  await requireAdminPage();
  return <CompareLookup />;
}
