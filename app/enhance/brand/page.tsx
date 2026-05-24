"use client";

// Step 2 of the Enhance flow — brand identity (palette + fonts +
// logo). Re-exports the /create/brand page component because its
// logic is identical for both flows; the only delta is the
// navigation paths, which the component derives at runtime via
// useFlowPrefix() based on the current URL.
//
// The seedFromExtraction helper (called by /enhance/content on
// successful extraction) already pre-fills the same sessionStorage
// keys this page reads: palette from Tier-1 theme XML or Tier-2
// histogram, font candidates from PPTX theme, slide format from
// detected aspect ratio. User edits / replaces / accepts.
//
// Why re-export vs fork: forking 2569 lines for ~6 hardcoded route
// strings is wasteful — see app/enhance/summary/page.tsx for the
// same pattern. The "URL shows enhance" guarantee comes from
// Next.js routing the request based on filesystem path, not the
// component's location.

import BrandPage from "@/app/create/brand/page";
export default BrandPage;
