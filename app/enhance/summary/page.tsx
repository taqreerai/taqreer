"use client";

// Step 3 of the Enhance flow — review + submit. Re-exports the
// /create/summary page component (same rationale as
// /enhance/brand/page.tsx — see its header for the re-export-vs-
// fork decision).
//
// The summary page already:
//   • Reads SourceMeta from sessionStorage via readSource() and
//     forwards it on the /api/projects POST body
//   • Calls clearSource() after a successful POST so the next
//     /enhance visit starts clean
//   • Uses useFlowPrefix() for back-navigation so "السابق" lands
//     on /enhance/brand (not /create/brand) when mounted here
//
// The URL stays /enhance/summary throughout — Next.js routing
// drives the address bar based on this file's path.

import SummaryPage from "@/app/create/summary/page";
export default SummaryPage;
