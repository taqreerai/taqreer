"use client";

import { useSyncExternalStore } from "react";
import { Sidebar } from "@/components/app/Sidebar";
import { Header } from "@/components/app/Header";

const sidebarStorageKey = "taqreer_sidebar_collapsed";
const sidebarStorageEvent = "taqreer_sidebar_collapsed_changed";

function getSidebarSnapshot(initialIsCollapsed: boolean) {
  const savedState = localStorage.getItem(sidebarStorageKey);
  return savedState !== null ? JSON.parse(savedState) : initialIsCollapsed;
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
  localStorage.setItem(sidebarStorageKey, JSON.stringify(isCollapsed));
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
