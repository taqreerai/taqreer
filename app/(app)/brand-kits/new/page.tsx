"use client";

// /brand-kits/new — standalone "create brand kit" page.
//
// Mirrors /create's consolidated brand card (palette + single font +
// logo on ONE card) without the content/output cards — this is a pure
// brand-saving form. No saved-kit dropdown or save toggle: this page
// IS the save. On submit we:
//   1. Upload any logo + uploaded font to the brand-assets bucket
//      via `uploadAsset` (same path /create uses).
//   2. POST the resolved brand state to /api/brand-kits (the single
//      brand font is reused for heading + body, like /create).
//   3. Navigate back to /brand-kits.
//
// Why a dedicated route (user direction 2026-05-27): the empty
// state on /brand-kits asked "create your first kit" and routing
// the user to /create would force them to set up an unrelated deck
// to save a kit. This page lets them set up a kit without ever
// touching the deck-generation flow.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { LogoRow } from "@/components/brand/LogoRow";
import {
  CardHeader,
  InlinePaletteSwatch,
  type CornerPosition,
} from "@/components/create/controls";
import {
  emptyBrandFont,
  googleFontUrl,
  HEADING_SAMPLE_AR,
  type BrandFontState,
} from "@/lib/brand/fonts";
import { uploadAsset } from "@/lib/brand/upload";

// Same palette bounds /create uses — 2 to 6 swatches.
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

// Card sizing — fixed 360 px width (matches the brand card across all
// flows) so the single centered card reads as a deliberate cluster.
// No min-height: with one card there's nothing to shoulder-align, so
// the card sizes to its content.
const CARD_W_CLASS = "w-[360px]";

// Resolved font field shape /api/brand-kits persists. The single
// brandFont resolves to ONE field reused for heading + body (one
// family, Claude varies weights / pairs uploads) — mirrors /create.
type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

export default function NewBrandKitPage() {
  const router = useRouter();

  // ─── Form state ────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  // Single brand font — one Google family (Claude varies weights) OR up
  // to 5 uploaded families (Claude pairs). Mirrors /create's picker.
  const [brandFont, setBrandFont] = useState<BrandFontState>(emptyBrandFont());
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPosition, setLogoPosition] = useState<CornerPosition>("top-right");

  // ─── Submit state ──────────────────────────────────────────────
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const updateColor = (index: number, next: string) =>
    setColors((prev) => prev.map((c, i) => (i === index ? next : c)));
  const addColor = () =>
    setColors((prev) =>
      prev.length >= MAX_PALETTE ? prev : [...prev, "#888888"],
    );
  const removeColor = (index: number) =>
    setColors((prev) =>
      prev.length <= MIN_PALETTE ? prev : prev.filter((_, i) => i !== index),
    );

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Upload the optional logo first so the JSON body carries a
      // bucket-relative path only (the API authorises it before
      // persisting). Same shape /create uses on saveBrandKit.
      const logoUploaded = logoFile
        ? await uploadAsset("brand-assets", "logos", logoFile)
        : null;

      // Resolve the single brand font → ONE field reused for heading +
      // body (one family, Claude varies weights / pairs uploads). Upload
      // mode uploads every picked family; the kit keeps the first family
      // that resolved a storageUrl. Mirrors /create.
      let fontField: ResolvedFontField = null;
      if (brandFont.mode === "google" && brandFont.googleFamily) {
        fontField = {
          name: brandFont.googleFamily,
          url: googleFontUrl(brandFont.googleFamily),
          storageUrl: null,
          family: brandFont.googleFamily,
        };
      } else if (brandFont.mode === "upload" && brandFont.uploaded.length > 0) {
        const storageUrls = await Promise.all(
          brandFont.uploaded.map(async (u) =>
            u.file
              ? (await uploadAsset("brand-assets", "fonts", u.file))
                  ?.storageUrl ??
                u.storageUrl ??
                null
              : u.storageUrl ?? null,
          ),
        );
        const firstIdx = storageUrls.findIndex((s) => !!s);
        if (firstIdx >= 0) {
          const fam = brandFont.uploaded[firstIdx].name;
          fontField = {
            name: fam,
            url: null,
            storageUrl: storageUrls[firstIdx] as string,
            family: fam,
          };
        }
      }

      const response = await fetch("/api/brand-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          colors,
          fonts: { heading: fontField, body: fontField },
          logo: logoUploaded
            ? {
                name: logoUploaded.name,
                storageUrl: logoUploaded.storageUrl,
                position: logoPosition,
                // Logo cover/closing excludes dropped — Claude decides
                // logo presence per slide (matches /create).
                exclude: [] as ("cover" | "closing")[],
              }
            : null,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "تعذر حفظ هوية الشركة");
      }

      router.push("/brand-kits");
      router.refresh();
    } catch (caughtError) {
      console.error("[brand-kits/new] save failed:", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "تعذر حفظ هوية الشركة. حاول مرة أخرى.",
      );
      setSubmitting(false);
    }
  };

  // Wrap in a semantic `<form>` so Enter submits from any input + the
  // save button is `type="submit"` instead of an `onClick` `<button
  // type="button">` (CR #41 finding, 2026-05-28). `handleSubmit`
  // itself is async + sequenced (uploads, etc.), so we wrap it in a
  // sync `onSubmit` that calls `preventDefault()` then awaits the
  // existing logic — no behavioural change beyond enabling keyboard
  // submission.
  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleSubmit();
  };

  return (
    <div className="page-container flex w-full justify-center" dir="rtl">
      <form
        onSubmit={handleFormSubmit}
        className="flex w-full flex-col items-center gap-6"
      >
        <header className="text-center">
          <h1 className="tq-h1">هوية جديدة</h1>
          <p className="tq-subhead mt-2">
            احفظ شعارك وألوانك وخطوطك مرة واحدة
            <br />
            ثم استخدمها بضغطة زر في أي تدفق إنشاء.
          </p>
        </header>

        {/* Name field — capped to the brand card's width so the form
            reads as one tidy 360 px column. mt-6 adds breathing room
            below the header so the input + card sit a touch lower. */}
        <div className="mt-6 w-full max-w-[360px]">
          <label
            htmlFor="brand-kit-name"
            className="mb-1.5 block text-xs font-semibold text-white/70"
          >
            اسم الهوية
          </label>
          <input
            id="brand-kit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: شركة المستقبل"
            maxLength={120}
            className="input-dark w-full"
            style={{ height: 44, padding: "0 16px" }}
          />
        </div>

        {/* ═══════════════════════════════════════════════════════
            BRAND CARD — palette + single font + logo merged into one
            card (matches /create's الهوية البصرية). No saved-kit
            dropdown or save toggle: this page IS the save.
            ═══════════════════════════════════════════════════════ */}
        <div className="flex justify-center">
          <div
            className={`glass-card flex ${CARD_W_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="palette" title="الهوية البصرية" />

            {/* Palette row — label on the visual right, swatches + add
                tile on the visual left (matches /create). */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white/70">
                الألوان
              </span>
              <div className="flex items-center gap-1.5">
                {colors.map((color, index) => (
                  <InlinePaletteSwatch
                    key={index}
                    value={color}
                    index={index}
                    removable={colors.length > MIN_PALETTE}
                    onChange={(next) => updateColor(index, next)}
                    onRemove={() => removeColor(index)}
                  />
                ))}
                {colors.length < MAX_PALETTE ? (
                  <button
                    type="button"
                    onClick={addColor}
                    aria-label="إضافة لون"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-white/20 text-white/60 transition-colors hover:border-white/40 hover:text-white"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      add
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            {/* Single brand font — one Google family (Claude varies
                weights) OR up to 5 uploaded families (Claude pairs). */}
            <div className="border-t border-[var(--tq-border-glass)] pt-3">
              <BrandFontPicker
                value={brandFont}
                onChange={setBrandFont}
                sampleText={HEADING_SAMPLE_AR}
              />
            </div>

            {/* Logo — compact zone + position pill on one row. */}
            <div className="space-y-2 border-t border-[var(--tq-border-glass)] pt-3">
              <span className="block text-xs font-semibold text-white/70">
                الشعار
              </span>
              <LogoRow
                file={logoFile}
                position={logoPosition}
                onSelect={setLogoFile}
                onRemove={() => setLogoFile(null)}
                onPosition={setLogoPosition}
              />
            </div>
          </div>
        </div>

        {/* Submit row — capped to the same 360 px the name input + card
            use so the cancel/save controls stay aligned with the rest
            of the form. Error sits inline on the start edge; cancel +
            save group on the end edge. */}
        <div className="flex w-full max-w-[360px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[20px] text-xs text-red-300/90">
            {error ?? null}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/brand-kits"
              className="rounded-full border border-white/15 px-5 py-2 text-sm text-white/70 transition-colors hover:border-white/30 hover:text-white"
            >
              إلغاء
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="btn-gradient flex items-center gap-2 px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <span
                    className="material-symbols-outlined animate-spin"
                    style={{ fontSize: 16 }}
                    aria-hidden
                  >
                    progress_activity
                  </span>
                  جارٍ الحفظ...
                </>
              ) : (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                    aria-hidden
                  >
                    save
                  </span>
                  حفظ الهوية
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
