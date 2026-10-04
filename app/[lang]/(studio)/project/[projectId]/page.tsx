// /project/[projectId] — the deck studio / viewer route.
//
// Canonical URL for a deck in ANY state (queued, generating, mid-regen,
// completed). Owns the post-generation chrome: slide pill (regen / history /
// lock), comments, save, exports, lightbox. Bookmarks, share links, the "Copy
// link" 3-dots action, bell notifications, and dashboard tile clicks all point
// here; legacy /preview links now just redirect here.
//
// Lives in the (studio) route group, deliberately OUTSIDE the auth-gated (app)
// group, so an anonymous "anyone with the link" public viewer can reach it;
// access is enforced below by resolveProjectAccess() + notFound().
//
// Re-uses the existing `<DeckView />` component, which internally branches on
// the deck's status (a disabled "generating" editor that flips to the live
// editor in place, with no route hop / remount on completion).

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notFound } from "next/navigation";
import { DeckView } from "@/components/preview/DeckView";
import { SharedDeckCta } from "@/components/preview/SharedDeckCta";
import { loadProject } from "@/lib/project/load-project";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { prisma } from "@/lib/prisma";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/ui-cookies";

export const dynamic = "force-dynamic";

// Link previews for PUBLIC decks (2026-10-02): a deck shared "anyone with the
// link" previews as itself in WhatsApp / X / Slack (deck title + its cover
// thumbnail) instead of the generic dashboard title, so every share reads as
// real content that advertises the product. Private decks reveal nothing
// (layout defaults). Never indexed: /project stays disallowed in robots.txt.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; projectId: string }>;
}): Promise<Metadata> {
  const { lang, projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true, thumbnailUrls: true, publicAccessLevel: true },
  });
  if (!project?.publicAccessLevel) return { robots: { index: false } };
  const dict = await getDictionary(isLocale(lang) ? lang : "ar");
  const description = dict.meta.sharedDeckDescription;
  const image = project.thumbnailUrls[0];
  return {
    title: `${project.title} | taqreer.ai`,
    description,
    robots: { index: false },
    openGraph: {
      title: project.title,
      description,
      type: "website",
      siteName: "taqreer.ai",
      ...(image ? { images: [{ url: image, alt: project.title }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: project.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Role-aware gate (Phase 15.A). Owner, accepted invitee (any role),
  // or public-view link viewer pass. Anyone else gets the same 404
  // the layout serves for non-existent projects — never leaks the
  // existence of a private deck. The resolved `role` is threaded
  // into DeckView so the editor can hide save / regen / lock / etc.
  // affordances for non-edit viewers (Phase 15.B).
  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) notFound();
  // Single-URL Studio (2026-06-07): /project serves EVERY deck state —
  // generating, completed, mid-regen. DeckView renders one shell that flips from
  // a disabled "generating" editor to the live editor in place, so there's no
  // route hop / remount on completion. No redirect-when-not-ready anymore.
  //
  // These three reads only depend on `access`, not on each other, so run them in
  // parallel. Phase 16.B presence: the profile fetch is null for anonymous
  // public-view callers (skips presence tracking entirely).
  const [data, cookieStore, profile] = await Promise.all([
    loadProject(projectId),
    cookies(),
    access.user.prismaId
      ? prisma.user.findUnique({
          where: { id: access.user.prismaId },
          select: { name: true, image: true },
        })
      : Promise.resolve(null),
  ]);
  if (!data) notFound();

  const isCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  const initialMainSidebarWidth = isCollapsed ? 80 : 260;

  // Viewer CTA (2026-10-02): view / comment viewers (not owners, editors or
  // the admin observer) see "create your own", unless the deck is
  // white-labelled.
  const showSharedCta =
    (access.role === "view" || access.role === "comment") &&
    access.isAdminObserver !== true &&
    !(
      await prisma.project.findUnique({
        where: { id: projectId },
        select: { hideBrandingBadge: true },
      })
    )?.hideBrandingBadge;
  const deckKey = `${data.initialVersionId ?? "none"}:${data.initialVersionStatus ?? "pending"}:${data.initialManifest ? "1" : "0"}`;
  return (
    <>
    {showSharedCta ? <SharedDeckCta anonymous={!access.user?.prismaId} /> : null}
    <DeckView
      key={deckKey}
      projectId={projectId}
      role={access.role}
      isAdminObserver={access.isAdminObserver === true}
      // Optional chain — anonymous public-view callers may have a
      // ProjectAccessContext where access.user is { id: null, prismaId: null }.
      currentUserId={access.user?.prismaId ?? null}
      currentUserName={profile?.name ?? null}
      currentUserImage={profile?.image ?? null}
      initialMainSidebarWidth={initialMainSidebarWidth}
      {...data}
      // Shared-link viewers see the deck WITHOUT the free watermark: the
      // SharedDeckCta card carries the brand there, and a clean link is the
      // reason free users share links instead of files (owner, 2026-10-04).
      brandingWatermark={data.brandingWatermark && !showSharedCta}
    />
    </>
  );
}
