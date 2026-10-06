"use client";

import { GuestTopBar } from "@/components/app/GuestTopBar";
import { GuestProvider } from "@/components/app/GuestContext";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/app/Sidebar";
import { MobileNav } from "@/components/app/MobileNav";
import { MagneticGlow } from "@/components/app/MagneticGlow";
import { TopUtilityBar } from "@/components/app/TopUtilityBar";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { stripLocale, localizedHref } from "@/lib/i18n/navigation";

export function DashboardShell({
  children,
  isAdmin = false,
  guest = false,
}: {
  children: React.ReactNode;
  // §22: collapse/expand was removed (rail is always collapsed). The prop is
  // kept optional so the server layout can still pass its cookie value without
  // a type error; it's intentionally ignored.
  initialIsCollapsed?: boolean;
  // Server-resolved (User.role === "admin"); gates the Sidebar's Admin entry.
  isAdmin?: boolean;
  // Signed-out visitor on /create (2026-10-06): no rail, no account cluster;
  // a light top bar (logo, language, theme, log in) instead.
  guest?: boolean;
}) {
  // pathname is locale-prefixed (/ar/dashboard); every route check below compares
  // against unprefixed constants, so strip the locale first. Missing this is what
  // silently dropped the home aurora + flow layouts after the [lang] move.
  const { locale } = useLocale();
  const pathname = stripLocale(usePathname() ?? "");
  const router = useRouter();

  // The Studio (/project) is the full-screen surface: full-bleed dotted canvas,
  // no rounded content panel. Both deck generation and editing mount here (one
  // URL). §22: the app sidebar rail now renders here too (one chrome everywhere)
  // and DeckView offsets its own panels for it.
  const isStudioRoute = pathname.startsWith("/project/");

  // The deck-creation flows + the template "use" surface keep their centered
  // 1280 layout; every other dashboard page runs edge-to-edge.
  const isFlowRoute =
    pathname.startsWith("/create") ||
    pathname.startsWith("/enhance") ||
    pathname.startsWith("/mimic") ||
    pathname.startsWith("/datasheet") ||
    // /social was missing since the flow shipped (2026-07-20): it fell into
    // the list-page bucket, whose taller top padding pushed its headline
    // ~40px below the other flows (and skipped the flow dot-field panel).
    pathname.startsWith("/social") ||
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
  // /dashboard. Mounted in the shell so it covers the studio route.
  useEffect(() => {
    const onRevoked = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      const revokedId = detail?.projectId;
      if (!revokedId) return;
      if (pathname.startsWith(`/project/${revokedId}`)) {
        router.replace(localizedHref("/dashboard", locale));
      }
    };
    window.addEventListener("taqreer:share-revoked", onRevoked);
    return () =>
      window.removeEventListener("taqreer:share-revoked", onRevoked);
  }, [pathname, router, locale]);

  // Padding tightens on mobile (px-4) and relaxes on desktop (md:px-8); the
  // top padding clears the absolutely-positioned TopUtilityBar cluster.
  const contentClasses = isFlowRoute
    // Extra bottom padding on phones so the generate CTA at the end of the flow
    // clears the mobile browser's bottom toolbar (which overlaps the viewport).
    ? "mx-auto max-w-[1280px] pt-8 px-4 pb-28 space-y-16 md:pt-10 md:px-8 md:pb-8"
    : isGlowRoute
      // Home: content is vertically centered, so the top icons overlap empty
      // space above it — no extra top padding needed.
      ? "pt-8 px-4 pb-8 space-y-16 md:pt-10 md:px-8"
      // List pages (templates / projects / library / admin / …): the headline
      // sits at the top, so add enough top padding to clear the absolutely-
      // positioned TopUtilityBar icons (search / theme / language). Extra bottom
      // padding on phones so the last row clears the mobile browser's bottom
      // toolbar (which overlaps the viewport), same as the flows above.
      : "pt-16 px-4 pb-28 space-y-16 md:pt-20 md:px-8 md:pb-8";

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
      {guest ? null : <Sidebar isAdmin={isAdmin} />}

      {/* The bell now lives in the TopUtilityBar (user direction
          2026-06-11) - that instance boots the notification store and
          owns the toasts; no headless mount needed. */}

      <main
        // `.tq-shell-main` offsets the content past the desktop rail (md+) and
        // drops to 0 below md, where the MobileNav drawer replaces the rail.
        className={`${guest ? "" : "tq-shell-main "}min-h-screen text-on-background relative`}
        style={{ zIndex: 1 }}
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
              top-start corner. On mobile it also leads with the hamburger that
              opens the MobileNav drawer (the rail is hidden below md). */}
          {guest ? (
            <GuestTopBar />
          ) : (
            <TopUtilityBar leading={<MobileNav isAdmin={isAdmin} />} />
          )}
          <div className={contentClasses}>
            <GuestProvider value={guest}>{children}</GuestProvider>
          </div>
        </div>
      </main>
    </div>
  );
}
