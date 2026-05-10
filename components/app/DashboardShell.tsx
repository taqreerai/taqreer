"use client";

import { useSyncExternalStore } from "react";
import { Sidebar } from "@/components/app/Sidebar";
import { Header } from "@/components/app/Header";

const sidebarStorageKey = "taqreer_sidebar_collapsed";
const sidebarStorageEvent = "taqreer_sidebar_collapsed_changed";

function getSidebarSnapshot(initialIsCollapsed: boolean) {
  try {
    return parseSidebarState(
      localStorage.getItem(sidebarStorageKey),
      initialIsCollapsed
    );
  } catch {
    const cookieValue = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${sidebarStorageKey}=`))
      ?.split("=")[1];

    return parseSidebarState(cookieValue, initialIsCollapsed);
  }
}

function parseSidebarState(value: string | null | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function subscribeToSidebarChanges(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(sidebarStorageEvent, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(sidebarStorageEvent, onStoreChange);
  };
}

function setSidebarCollapsed(isCollapsed: boolean) {
  try {
    localStorage.setItem(sidebarStorageKey, JSON.stringify(isCollapsed));
  } catch {
    // Cookie fallback below keeps the preference available when storage is blocked.
  }
  document.cookie = `${sidebarStorageKey}=${isCollapsed}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(sidebarStorageEvent));
}

export function DashboardShell({
  children,
  initialIsCollapsed,
}: {
  children: React.ReactNode;
  initialIsCollapsed: boolean;
}) {
  const isCollapsed = useSyncExternalStore(
    subscribeToSidebarChanges,
    () => getSidebarSnapshot(initialIsCollapsed),
    () => initialIsCollapsed
  );

  const toggleSidebar = () => {
    setSidebarCollapsed(!isCollapsed);
  };

  const sidebarWidth = isCollapsed ? 80 : 260;

  return (
    <div className="dashboard-bg min-h-screen relative">
      <div className="glow-orb glow-orb-blue" />
      <div className="glow-orb glow-orb-violet" />
      <div className="glow-orb glow-orb-magenta" />

      <Sidebar isCollapsed={isCollapsed} toggleSidebar={toggleSidebar} />

      <main
        className="min-h-screen text-on-background relative transition-all duration-300 ease-in-out"
        style={{ marginRight: `${sidebarWidth}px`, marginLeft: 0, zIndex: 1 }}
      >
        <Header isCollapsed={isCollapsed} />
        <div className="pt-28 px-8 pb-8 space-y-16">{children}</div>
      </main>
    </div>
  );
}
