"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/app/Sidebar";
import { Header } from "@/components/app/Header";

const sidebarStorageKey = "taqreer_sidebar_collapsed";
const sidebarStorageEvent = "taqreer_sidebar_collapsed_changed";
// Same key as the cookie the server layout reads. Mirroring the
// state into a cookie lets SSR pick the right `initialIsCollapsed`
// value — without it we'd render the sidebar expanded on the server,
// then snap to collapsed once the client read localStorage, giving
// the user a brief expand-then-collapse flash on every navigation.
const sidebarCookieKey = "tq_sidebar_collapsed";

function getStoredSidebarState(fallback: boolean) {
  if (typeof window === "undefined") return fallback;

  try {
    return parseSidebarState(
      window.localStorage.getItem(sidebarStorageKey),
      fallback
    );
  } catch {
    return fallback;
  }
}

function parseSidebarState(value: string | null | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function setSidebarCollapsed(isCollapsed: boolean) {
  try {
    window.localStorage.setItem(sidebarStorageKey, JSON.stringify(isCollapsed));
  } catch {
    // If storage is blocked, keep the in-memory state for this session.
  }
  // Cookie persists across requests so the next SSR render starts
  // with the right value. 1-year max-age keeps it sticky;
  // SameSite=Lax is fine — sidebar state is not security-sensitive.
  try {
    const oneYearSeconds = 60 * 60 * 24 * 365;
    document.cookie = `${sidebarCookieKey}=${isCollapsed ? "1" : "0"}; path=/; max-age=${oneYearSeconds}; samesite=lax`;
  } catch {
    /* cookies disabled — fall back to localStorage-only sync */
  }
  window.dispatchEvent(new CustomEvent(sidebarStorageEvent, { detail: isCollapsed }));
}

export function DashboardShell({
  children,
  initialIsCollapsed,
}: {
  children: React.ReactNode;
  initialIsCollapsed: boolean;
}) {
  // Initial state comes from the server (cookie-derived) so the SSR
  // render already matches the user's preference — no expand-then-
  // collapse flash on navigation or refresh.
  const [isCollapsed, setIsCollapsed] = useState(initialIsCollapsed);
  // `isReady` gates the transition class: false on first paint so
  // the sidebar doesn't animate into its initial position; flipped
  // true after mount so subsequent toggles animate normally.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsReady(true);
  }, []);

  useEffect(() => {
    function handleSidebarChange(event: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "boolean") {
        setIsCollapsed(event.detail);
        return;
      }

      setIsCollapsed(getStoredSidebarState(initialIsCollapsed));
    }

    window.addEventListener("storage", handleSidebarChange);
    window.addEventListener(sidebarStorageEvent, handleSidebarChange);

    return () => {
      window.removeEventListener("storage", handleSidebarChange);
      window.removeEventListener(sidebarStorageEvent, handleSidebarChange);
    };
  }, [initialIsCollapsed]);

  const toggleSidebar = () => {
    const nextIsCollapsed = !isCollapsed;
    setIsCollapsed(nextIsCollapsed);
    setSidebarCollapsed(nextIsCollapsed);
  };

  const sidebarWidth = isCollapsed ? 80 : 260;
  const transitionClass = isReady ? "transition-all duration-300 ease-in-out" : "transition-none";

  // Preview routes use a full-width canvas layout (hero + side panels
  // must fit a 16:9 slide at viewport height — ~1850 px wide — which
  // doesn't survive the dashboard's 1280 max-width clamp). Wrapper
  // paddings here reserve breathing room around the canvas:
  //   • pt-[120px] = Header (80) + 40 px above the hero
  //   • pb-[40px]  = 40 px below the hero
  //   • pl-[120px] = clears the fixed toolbar (16 + ~80 + 24 gap)
  //   • pr-[40px]  = 40 px gap to the slide-nav's left edge
  // Must match DeckView's HERO_VERTICAL_PADDING_PX (160 total).
  const pathname = usePathname() ?? "";
  const router = useRouter();
  // Post route-split: both /preview (generation) and /project
  // (working session) use the same full-width chrome — the
  // generating placeholder grid and the live DeckView need the
  // same horizontal real estate.
  const isFullWidthRoute =
    pathname.startsWith("/preview/") || pathname.startsWith("/project/");

  // Share-revoked listener — `notificationStore` dispatches
  // `taqreer:share-revoked` on its window when the user channel
  // delivers the broadcast. If we're currently looking at the
  // revoked project (either `/project/{id}` or `/preview/{id}`),
  // hard-redirect to /dashboard so the user isn't left staring at
  // a page they no longer have access to. Mounted in the shell so
  // it covers BOTH route shapes without duplicating handlers per
  // page.
  useEffect(() => {
    const onRevoked = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      const revokedId = detail?.projectId;
      if (!revokedId) return;
      const onProject = pathname.startsWith(`/project/${revokedId}`);
      const onPreview = pathname.startsWith(`/preview/${revokedId}`);
      if (onProject || onPreview) {
        // `replace` (not `push`) so the back button doesn't return
        // them to the now-forbidden URL.
        router.replace("/dashboard");
      }
    };
    window.addEventListener("taqreer:share-revoked", onRevoked);
    return () =>
      window.removeEventListener("taqreer:share-revoked", onRevoked);
  }, [pathname, router]);

  // The dashboard runs EDGE-TO-EDGE (no max-w cap) so the stat cards +
  // widgets + points graph can spread across wide monitors — but with
  // the same symmetric padding the capped pages use (NOT the preview
  // route's left-heavy `pl-[120px]`, which reserves room for the slide
  // nav). Every other app page stays capped at 1280px.
  const isDashboard = pathname === "/dashboard";
  const contentClasses = isFullWidthRoute
    ? "pt-[120px] pb-[40px] pl-[120px] pr-[40px]"
    : isDashboard
      ? "pt-28 px-8 pb-8 space-y-16"
      : "mx-auto max-w-[1280px] pt-28 px-8 pb-8 space-y-16";

  return (
    <div className="dashboard-bg min-h-screen relative opacity-100">
      <Sidebar isCollapsed={isCollapsed} transitionClass={transitionClass} />

      <main
        className={`min-h-screen text-on-background relative ${transitionClass}`}
        style={{ marginRight: `${sidebarWidth}px`, marginLeft: 0, zIndex: 1 }}
      >
        <Header
          isCollapsed={isCollapsed}
          onToggleSidebar={toggleSidebar}
        />
        <div className={contentClasses}>{children}</div>
      </main>
    </div>
  );
}
