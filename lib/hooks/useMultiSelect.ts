"use client";

// Multi-select-to-delete state shared by /projects, /templates,
// /brand-kits and /library (2026-06-12). Owns the mode flag + the
// selected-id set; the page wires it to SelectableTile overlays and
// the floating SelectionBar. Esc exits the mode (and clears).

import { useCallback, useEffect, useState } from "react";

export function useMultiSelect() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const exit = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, exit]);

  const toggleMode = useCallback(() => {
    setActive((v) => {
      if (v) setSelected(new Set());
      return !v;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Toggle-all against the caller's CURRENT selectable id list: if
  // everything is already selected, clears; otherwise selects all.
  const selectAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const all = ids.every((id) => prev.has(id)) && ids.length > 0;
      return all ? new Set() : new Set(ids);
    });
  }, []);

  // Drop ids that disappeared from the page (deleted / filtered out).
  const prune = useCallback((keep: ReadonlySet<string>) => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => keep.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  return { active, toggleMode, exit, selected, toggle, selectAll, prune };
}
