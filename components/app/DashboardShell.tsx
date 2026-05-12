"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/app/Sidebar";
import { Header } from "@/components/app/Header";

const sidebarStorageKey = "taqreer_sidebar_collapsed";
const sidebarStorageEvent = "taqreer_sidebar_collapsed_changed";

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
  window.dispatchEvent(new CustomEvent(sidebarStorageEvent, { detail: isCollapsed }));
}

export function DashboardShell({
  children,
  initialIsCollapsed,
}: {
  children: React.ReactNode;
  initialIsCollapsed: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialIsCollapsed);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let readyFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      setIsCollapsed(getStoredSidebarState(initialIsCollapsed));
      readyFrame = window.requestAnimationFrame(() => {
        setIsReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(readyFrame);
    };
  }, [initialIsCollapsed]);

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

  return (
    <div className="dashboard-bg min-h-screen relative opacity-100">
      <Sidebar isCollapsed={isCollapsed} toggleSidebar={toggleSidebar} transitionClass={transitionClass} />

      <main
        className={`min-h-screen text-on-background relative ${transitionClass}`}
        style={{ marginRight: `${sidebarWidth}px`, marginLeft: 0, zIndex: 1 }}
      >
        <Header isCollapsed={isCollapsed} />
        {/* Wrap content in a max-width container so the dashboard doesn't
            stretch edge-to-edge on 24"+ monitors. 1280 is comfortable for
            wide cards (slide grid is 3×640 = 1920 + gaps, so the slide
            cascade still breaks past this — but it overflows centered). */}
        <div className="mx-auto max-w-[1280px] pt-28 px-8 pb-8 space-y-16">{children}</div>
      </main>
    </div>
  );
}
