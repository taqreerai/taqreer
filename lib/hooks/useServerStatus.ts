"use client";

// Shared client hook for the upstream-provider status (GET /api/status).
//
// A module-level cache + single in-flight promise means the header chip,
// the pre-generate banner, and the in-deck slow caption share ONE fetch
// per ~60s window instead of issuing three. Re-polls every 2 min while
// any consumer is mounted (status changes are rare; the route is cached).

import { useEffect, useState } from "react";
import type { ServerStatus } from "@/lib/status/anthropic-status";

const TTL_MS = 60_000;
const POLL_MS = 120_000;

let cached: { at: number; value: ServerStatus } | null = null;
let inflight: Promise<ServerStatus> | null = null;

const UNKNOWN: ServerStatus = {
  level: "unknown",
  indicator: "",
  description: "",
};

function load(force = false): Promise<ServerStatus> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (inflight) return inflight;
  inflight = fetch("/api/status")
    .then((r) => (r.ok ? (r.json() as Promise<ServerStatus>) : Promise.reject()))
    .then((value) => {
      cached = { at: Date.now(), value };
      inflight = null;
      return value;
    })
    .catch(() => {
      inflight = null;
      return UNKNOWN;
    });
  return inflight;
}

export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(
    cached?.value ?? null,
  );

  useEffect(() => {
    let active = true;
    load().then((v) => active && setStatus(v));
    const id = window.setInterval(() => {
      load(true).then((v) => active && setStatus(v));
    }, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return status;
}
