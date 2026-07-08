// Admin > Decks (server). Gates on admin and fetches the 50 most recent
// COMPLETED decks across all users so the operator can see what people are
// generating and spot-check quality. Filtering + pagination happen client-side
// over this fixed window (Users-tab pattern; no admin list API route).

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { DecksClient, type AdminDeck } from "@/components/admin/DecksClient";

export const dynamic = "force-dynamic";

export default async function AdminDecksPage() {
  await requireAdminPage();

  const rows = await prisma.project.findMany({
    where: { status: "completed" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      type: true,
      language: true,
      format: true,
      tone: true,
      slideCount: true,
      thumbnail: true,
      thumbnailUrls: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  const decks: AdminDeck[] = rows.map((p) => ({
    id: p.id,
    title: p.title,
    // Only "create" | "enhance" are ever written to Project.type (mimic is
    // derived from the source payload, not stored here) - narrow defensively.
    type: p.type === "enhance" ? "enhance" : "create",
    language: p.language === "en" ? "en" : "ar",
    format: p.format,
    tone: p.tone,
    slideCount: p.slideCount,
    // Per-slide thumbnails only exist after the user clicks Save; fall back
    // to the single cover, then let the client render a placeholder tile.
    thumbnail: p.thumbnailUrls[0] ?? p.thumbnail ?? null,
    createdAt: p.createdAt.toISOString(),
    userName: p.user.name?.trim() || p.user.email.split("@")[0] || "User",
    userEmail: p.user.email,
  }));

  return <DecksClient initialDecks={decks} />;
}
