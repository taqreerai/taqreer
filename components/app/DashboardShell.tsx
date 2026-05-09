"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/app/Sidebar";
import { Header } from "@/components/app/Header";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedState = localStorage.getItem("taqreer_sidebar_collapsed");
    if (savedState !== null) {
      setIsCollapsed(JSON.parse(savedState));
    }
    setMounted(true);
  }, []);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("taqreer_sidebar_collapsed", JSON.stringify(newState));
  };

  const sidebarWidth = isCollapsed ? 80 : 260;

  if (!mounted) {
    return (
      <div className="dashboard-bg min-h-screen relative">
        <Sidebar isCollapsed={false} toggleSidebar={toggleSidebar} />
        <main
          className="min-h-screen text-on-background"
          style={{ marginRight: "260px", marginLeft: 0 }}
        >
          <Header isCollapsed={false} />
          <div className="pt-28 px-8 pb-8 space-y-16">{children}</div>
        </main>
      </div>
    );
  }

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
