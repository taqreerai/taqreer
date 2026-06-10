"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/app/Sidebar";
import { BellDropdown } from "@/components/app/BellDropdown";
import { MagneticGlow } from "@/components/app/MagneticGlow";
import { TopUtilityBar } from "@/components/app/TopUtilityBar";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { stripLocale, localizedHref } from "@/lib/i18n/navigation";

// §22: the sidebar is a fixed-width, always-collapsed thin rail (no expand) —
// one chrome across the whole app. Keep this in sync with the rail's `w-[60px]`
// in Sidebar.tsx.
const SIDEBAR_WIDTH = 60;

export function DashboardShell({
  children,
}: {
  children: React.ReactNode;
  // §22: collapse/expand was removed (rail is always collapsed). The prop is
  // kept optional so the server layout can still pass its cookie value without
  // a type error; it's intentionally ignored.
  initialIsCollapsed?: boolean;
}) {
  // pathname is locale-prefixed (/ar/dashboard); every route check below compares
  // against unprefixed constants, so strip the locale first. Missing this is what
  // silently dropped the home aurora + flow layouts after the [lang] move.
  const { locale } = useLocale();
  const pathname = stripLocale(usePathname() ?? "");
  const router = useRouter();

  // BOTH the working editor (/project) and the generation phase (/preview) are
  // the full-screen "Studio": full-bleed dotted canvas, no rounded content
  // panel. §22: the app sidebar rail now renders here too (one chrome
  // everywhere) and DeckView offsets its own panels for it.
  const isStudioRoute =
    pathname.startsWith("/project/") || pathname.startsWith("/preview/");

  // The deck-creation flows + the template "use" surface keep their centered
  // 1280 layout; every other dashboard page runs edge-to-edge.
  const isFlowRoute =
    pathname.startsWith("/create") ||
    pathname.startsWith("/enhance") ||
    pathname.startsWith("/mimic") ||
    pathname.startsWith("/datasheet") ||
    pathname.startsWith("/use-template");

  // §22: home + the 4 flows get the dot field; every other page is flat gray.
  const isGlowRoute = pathname === "/dashboard" || isFlowRoute;

  // §24: make BODY the scroll container ONLY while the dashboard shell is
  // mounted, so the page scrollbar lands on the left (RTL). Scoped via this
  // class so public pages (landing / auth) keep normal window scroll — the
  // landing's Lenis smooth-scroll needs <html>/window to scroll (it broke when
  // this was global). See `html.app-shell-scroll` in globals.css.
  useEffect(() => {
    document.documentElement.classList.add("app-shell-scroll");
    return () => document.documentElement.classList.remove("app-shell-scroll");
  }, []);

  // Share-revoked listener — `notificationStore` dispatches
  // `taqreer:share-revoked` on its window when the user channel delivers the
  // broadcast. If we're currently viewing the revoked project, hard-redirect to
  // /dashboard. Mounted in the shell so it covers BOTH route shapes.
  useEffect(() => {
    const onRevoked = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      const revokedId = detail?.projectId;
      if (!revokedId) return;
      const onProject = pathname.startsWith(`/project/${revokedId}`);
      const onPreview = pathname.startsWith(`/preview/${revokedId}`);
      if (onProject || onPreview) {
        router.replace(localizedHref("/dashboard", locale));
      }
    };
    window.addEventListener("taqreer:share-revoked", onRevoked);
    return () =>
      window.removeEventListener("taqreer:share-revoked", onRevoked);
  }, [pathname, router, locale]);

  const contentClasses = isFlowRoute
    ? "mx-auto max-w-[1280px] pt-10 px-8 pb-8 space-y-16"
    : isGlowRoute
      // Home: content is vertically centered, so the top icons overlap empty
      // space above it — no extra top padding needed.
      ? "pt-10 px-8 pb-8 space-y-16"
      // List pages (templates / projects / library / …): the headline sits at
      // the top, so add enough top padding to clear the absolutely-positioned
      // TopUtilityBar icons (search / theme / language).
      : "pt-20 px-8 pb-8 space-y-16";

  // Panel background variant: flows get the static bottom glow (dots only), home
  // (+ any other glow route) gets the animated aurora, everything else is flat gray.
  let panelVariant = "tq-panel-gray";
  if (isFlowRoute) {
    panelVariant = "tq-panel-flow";
  } else if (isGlowRoute) {
    panelVariant = "tq-panel-glow";
  }

  // Studio (editor / generation) is full-bleed and chrome-less — NO app rail
  // (user direction: keep the editor uncluttered). DeckView paints its own
  // dotted canvas + floating panels; getting back to the dashboard is the
  // home button in the bottom toolbox.
  if (isStudioRoute) {
    return (
      <div className="studio-canvas text-on-background min-h-screen">
        {children}
      </div>
    );
  }

  return (
    <div className="dashboard-bg min-h-screen relative opacity-100">
      <Sidebar />

      {/* Headless notification runtime (§20) — boots the store (setUser via
          /api/me) + renders the live toast stack on every page. */}
      <BellDropdown headless />

      <main
        className="min-h-screen text-on-background relative"
        // +8: the rail floats 8px off the right edge (Sidebar `right-2`), so the
        // content clears the rail AND that gap.
        style={{ marginInlineStart: `${SIDEBAR_WIDTH + 8}px`, marginInlineEnd: 0, zIndex: 1 }}
      >
        {/* §22/§24: rounded content panel floating on the dark gutter. Home gets
            the animated JS aurora + dots (tq-panel-glow); the flows get the dots
            only + a static editor-style bottom glow (tq-panel-flow); every other
            page is flat gray. */}
        <div className={`tq-content-panel ${panelVariant}`}>
          {isGlowRoute ? (
            <MagneticGlow glowYOffset={0.1} aurora={!isFlowRoute} />
          ) : null}
          {/* §24: search + theme + language cluster, pinned to the panel's
              top-start corner. */}
          <TopUtilityBar />
          <div className={contentClasses}>{children}</div>
        </div>
      </main>
    </div>
  );
}
