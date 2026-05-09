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
          style={{ marginRight: '260px', marginLeft: 0 }}
        >
          <Header isCollapsed={false} />
          <div className="pt-28 px-8 pb-8 space-y-16">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-bg min-h-screen relative">
      {/* Glow orbs */}
      <div
        className="pointer-events-none fixed"
        style={{
          top: '-120px',
          left: '20%',
          width: '600px',
          height: '600px',
          background: 'radial-gradient(circle, rgba(55, 11, 244, 0.07) 0%, transparent 70%)',
          filter: 'blur(40px)',
          zIndex: 0,
        }}
      />
      <div
        className="pointer-events-none fixed"
        style={{
          bottom: '-150px',
          left: '40%',
          width: '500px',
          height: '500px',
          background: 'radial-gradient(circle, rgba(125, 45, 255, 0.06) 0%, transparent 70%)',
          filter: 'blur(60px)',
          zIndex: 0,
        }}
      />
      <div
        className="pointer-events-none fixed"
        style={{
          top: '30%',
          left: '10%',
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, rgba(224, 54, 184, 0.04) 0%, transparent 70%)',
          filter: 'blur(50px)',
          zIndex: 0,
        }}
      />

      <Sidebar isCollapsed={isCollapsed} toggleSidebar={toggleSidebar} />

      {/* Main Content — no flex, just margin-right to offset sidebar */}
      <main
        className="min-h-screen text-on-background relative transition-all duration-300 ease-in-out"
        style={{
          marginRight: `${sidebarWidth}px`,
          marginLeft: 0,
          zIndex: 1,
        }}
      >
        <Header isCollapsed={isCollapsed} />
        <div className="pt-28 px-8 pb-8 space-y-16">
          {children}
        </div>
      </main>
    </div>
  );
}