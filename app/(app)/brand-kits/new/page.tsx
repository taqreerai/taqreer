"use client";

// /brand-kits/new — standalone "create brand kit" page.
//
// Mirrors /create's two brand cards (palette+fonts on one, logo on
// the other) but without the content/output cards — this is a pure
// brand-saving form. On submit we:
//   1. Upload any logo + uploaded fonts to the brand-assets bucket
//      via `uploadAsset` (same path /create uses).
//   2. POST the resolved brand state to /api/brand-kits.
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
import { LogoUploadSlot } from "@/components/brand/LogoUploadSlot";
import { FontUploadSlot } from "@/components/brand/FontUploadSlot";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import {
  CardHeader,
  ExclusionDropdown,
  InlinePaletteSwatch,
  PositionDropdown,
  SegmentedToggle,
  type CornerPosition,
} from "@/components/create/controls";
import {
  emptyFontSlot,
  googleFontUrl,
  isLatinOnlyGoogleFont,
  HEADING_SAMPLE_AR,
  HEADING_SAMPLE_LATIN,
  BODY_SAMPLE_AR,
  BODY_SAMPLE_LATIN,
  type FontSlotState,
} from "@/lib/brand/fonts";
import { uploadAsset } from "@/lib/brand/upload";

// Same palette bounds /create uses — 2 to 6 swatches.
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

const FONT_MODE_OPTIONS = [
  { value: "upload" as const, label: "ملف" },
  { value: "google" as const, label: "Google" },
];

// Card sizing — pinned to /mimic's recipe: fixed 360 px width per
// card (so the row reads as a centered, deliberate cluster, not a
// stretched grid) and 387 px min-height to keep the two cards
// shoulder-aligned regardless of content length.
const CARD_W_CLASS = "w-[360px]";
const CARD_MIN_H_CLASS = "min-h-[387px]";

// Mirrors /create's resolveFontSlot: turns the per-slot UI state +
// (optionally) the uploaded font's storageUrl into the canonical
// fonts.{heading|body} shape /api/brand-kits persists.
type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

function resolveFontSlot(
  slot: FontSlotState,
  uploadedStorageUrl: string | null,
): ResolvedFontField {
  if (slot.mode === "google") {
    if (!slot.googleFamily) return null;
    return {
      name: slot.googleFamily,
      url: googleFontUrl(slot.googleFamily),
      storageUrl: null,
      family: slot.googleFamily,
    };
  }
  if (!slot.uploadFile || !uploadedStorageUrl) return null;
  return {
    name: slot.uploadName ?? slot.uploadFile.name,
    url: null,
    storageUrl: uploadedStorageUrl,
    family: slot.uploadFamily || slot.uploadFile.name.replace(/\.[^.]+$/, ""),
  };
}

// FontSlotPicker — the heading and body slots render identical JSX
// (mode toggle + upload-or-google sub-slot) against the same
// FontSlotState shape. Extracted locally so the two call sites in
// the card below stay declarative; nothing here is reused outside
// this page (the four landing flows have their own resolveFontSlot
// copies, all scheduled for consolidation).
function FontSlotPicker({
  label,
  ariaLabel,
  uploadLabel,
  sampleAr,
  sampleLatin,
  sampleSizeClass,
  slot,
  setSlot,
}: {
  label: string;
  ariaLabel: string;
  uploadLabel: string;
  sampleAr: string;
  sampleLatin: string;
  sampleSizeClass: string;
  slot: FontSlotState;
  setSlot: React.Dispatch<React.SetStateAction<FontSlotState>>;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">{label}</span>
        <SegmentedToggle
          options={FONT_MODE_OPTIONS}
          value={slot.mode}
          onChange={(mode) => setSlot((s) => ({ ...s, mode }))}
          ariaLabel={ariaLabel}
        />
      </div>
      {slot.mode === "upload" ? (
        <FontUploadSlot
          label={uploadLabel}
          file={slot.uploadFile}
          family=""
          sampleText={sampleAr}
          sampleSizeClass={sampleSizeClass}
          alignStart
          compact
          hideSample
          onSelect={(f) =>
            setSlot((s) => ({ ...s, uploadFile: f, uploadName: f.name }))
          }
          onRemove={() =>
            setSlot((s) => ({ ...s, uploadFile: null, uploadName: null }))
          }
        />
      ) : (
        <GoogleFontSlot
          selected={slot.googleFamily}
          sampleText={
            isLatinOnlyGoogleFont(slot.googleFamily) ? sampleLatin : sampleAr
          }
          sampleSizeClass={sampleSizeClass}
          alignStart
          compact
          hideSample
          onSelect={(family) =>
            setSlot((s) => ({ ...s, googleFamily: family }))
          }
        />
      )}
    </div>
  );
}

export default function NewBrandKitPage() {
  const router = useRouter();

  // ─── Form state ────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  const [headingFontSlot, setHeadingFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [bodyFontSlot, setBodyFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPosition, setLogoPosition] = useState<CornerPosition>("top-right");
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(false);

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
      // Upload binary assets first so the JSON body carries
      // bucket-relative paths only (the API authorises those before
      // persisting). Same shape /create uses on saveBrandKit.
      const [logoUploaded, headingUploaded, bodyUploaded] = await Promise.all([
        logoFile ? uploadAsset("brand-assets", "logos", logoFile) : null,
        headingFontSlot.mode === "upload" && headingFontSlot.uploadFile
          ? uploadAsset("brand-assets", "fonts", headingFontSlot.uploadFile)
          : null,
        bodyFontSlot.mode === "upload" && bodyFontSlot.uploadFile
          ? uploadAsset("brand-assets", "fonts", bodyFontSlot.uploadFile)
          : null,
      ]);

      const headingFont = resolveFontSlot(
        headingFontSlot,
        headingUploaded?.storageUrl ?? null,
      );
      const bodyFont = resolveFontSlot(
        bodyFontSlot,
        bodyUploaded?.storageUrl ?? null,
      );

      const logoExclude = [
        logoExcludeCover ? "cover" : null,
        logoExcludeClosing ? "closing" : null,
      ].filter((v): v is "cover" | "closing" => v !== null);

      const response = await fetch("/api/brand-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          colors,
          fonts: { heading: headingFont, body: bodyFont },
          logo: logoUploaded
            ? {
                name: logoUploaded.name,
                storageUrl: logoUploaded.storageUrl,
                position: logoPosition,
                exclude: logoExclude,
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
            احفظ شعارك وألوانك وخطوطك مرة واحدة ثم استخدمها بضغطة زر في أي
            تدفق إنشاء.
          </p>
        </header>

        {/* Name field — pinned above the cards but pinned to the
            same 360 + 360 + gap-4 = 736 px row width so it reads as
            the cards' shared "header" rather than a stretched
            full-width input. */}
        <div className="w-full max-w-[736px]">
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

        <div className="flex flex-wrap items-stretch justify-center gap-4">
        {/* ═══════════════════════════════════════════════════════
            PALETTE + FONTS CARD
            ═══════════════════════════════════════════════════════ */}
        <div
          className={`glass-card flex ${CARD_W_CLASS} ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
        >
          <CardHeader icon="palette" title="الألوان والخطوط" />

          {/* Palette row — inline swatches + add button, same shape
              as /create's branding card. */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-white/70">
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

          {/* Heading font — same toggle + slot pattern /create uses. */}
          <div className="border-t border-[var(--tq-border-glass)] pt-3">
            <FontSlotPicker
              label="خط العناوين"
              ariaLabel="مصدر خط العناوين"
              uploadLabel="ارفع خط العناوين"
              sampleAr={HEADING_SAMPLE_AR}
              sampleLatin={HEADING_SAMPLE_LATIN}
              sampleSizeClass="text-base"
              slot={headingFontSlot}
              setSlot={setHeadingFontSlot}
            />
          </div>

          {/* Body font — mirrors heading shape. */}
          <FontSlotPicker
            label="خط النص"
            ariaLabel="مصدر خط النص"
            uploadLabel="ارفع خط النص"
            sampleAr={BODY_SAMPLE_AR}
            sampleLatin={BODY_SAMPLE_LATIN}
            sampleSizeClass="text-sm"
            slot={bodyFontSlot}
            setSlot={setBodyFontSlot}
          />
        </div>

        {/* ═══════════════════════════════════════════════════════
            LOGO CARD
            ═══════════════════════════════════════════════════════ */}
        <div
          className={`glass-card flex ${CARD_W_CLASS} ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
        >
          <CardHeader icon="image" title="الشعار" />

          <LogoUploadSlot
            file={logoFile}
            onSelect={setLogoFile}
            onRemove={() => setLogoFile(null)}
          />

          <div className="space-y-1.5 border-t border-[var(--tq-border-glass)] pt-3">
            <span className="block text-xs font-semibold text-white/70">
              موضع الشعار
            </span>
            <div className="flex items-center gap-1.5">
              <ExclusionDropdown
                excludeCover={logoExcludeCover}
                excludeClosing={logoExcludeClosing}
                onCoverChange={setLogoExcludeCover}
                onClosingChange={setLogoExcludeClosing}
                disabled={!logoFile}
              />
              <PositionDropdown
                value={logoPosition}
                onChange={setLogoPosition}
                disabled={!logoFile}
              />
            </div>
          </div>
        </div>
        </div>

        {/* Submit row — pinned to the same 736 px the name input +
            cards row use so the cancel/save controls stay aligned
            with the rest of the form. Error sits inline on the
            start edge; cancel + save group on the end edge. */}
        <div className="flex w-full max-w-[736px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
