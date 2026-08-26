// Private pitch deck: Taqreer to Tendem and Toloka. Not linked anywhere, not
// in the sitemap, noindex. Brand-mapped to the taqreer.ai design system
// (Cairo, dark tokens, brand blue) but pinned dark-only: the deck is a
// designed artifact, so it must not flip with the visitor's theme cookie.
import type { Metadata } from "next";
import { PitchDeck } from "./PitchDeck";

export const metadata: Metadata = {
  title: "Taqreer to Tendem and Toloka | GCC Opportunity",
  description:
    "A pitch for bringing Taqreer's GCC product insight and Arabic presentation technology into Tendem and Toloka.",
  robots: { index: false, follow: false },
};

export default function TendemPitchPage() {
  return <PitchDeck />;
}
