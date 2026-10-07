"use client";

// True when the page renders for a signed-out visitor (the (open) layout's
// server-verified guest branch, 2026-10-06). Lets /create defer everything
// that needs an account (uploads, extraction, template setup, generation)
// until after sign-in.

import { createContext, useContext } from "react";

const GuestContext = createContext(false);

export const GuestProvider = GuestContext.Provider;

export function useIsGuest(): boolean {
  return useContext(GuestContext);
}
