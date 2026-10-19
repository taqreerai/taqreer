"use client";

// The shared creation wizard (2026-10-06, owner direction: every creation
// tool - /create, /enhance, then /mimic, /social, /datasheet - should feel
// like ONE process). Extracted from /create's 4-step redesign:
//   - WizardHead: title + subtitle, the step rail, the step's one-line hint
//     and an optional slot under it (e.g. the "Or try" row);
//   - BrandStep: the Brand step (colours + named colour templates on one
//     side; font, logo, "save as default" on the other; saved kits on top);
//   - WizardBar: the sticky Back / Next bar whose last step holds Generate.
// Each tool keeps its own state and puts its own content into the steps;
// tools skip the steps they have no use for (owner answer 2026-10-06).

import { useState, type ReactNode } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { WizardStepRail } from "@/components/create/WizardChrome";
import { FlowSwitcher } from "@/components/create/FlowSwitcher";
import type { GuestFlow } from "@/lib/create/guest-draft";
import { PillButton } from "@/components/create/PillButton";
import { InlinePaletteSwatch, Toggle } from "@/components/create/controls";
import { PalettePresetPicker } from "@/components/brand/PalettePresetPicker";
import { PickerExpandButton } from "@/components/create/PickerExpandModal";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { LogoRow } from "@/components/brand/LogoRow";
import {
  BrandKitDropdown,
  type BrandKitOption,
} from "@/components/brand/BrandKitDropdown";
import type { BrandFontState } from "@/lib/brand/fonts";
import {
  TemplatePickerGrid,
  type PickedTemplate,
  type TemplateUploadControl,
} from "@/components/create/TemplatePickerGrid";
import { DesignStyleGrid } from "@/components/create/DesignStylePicker";
import type { PickerTemplate } from "@/app/api/templates/route";

/** Scroll the page back to the top on a step change (page scroll lives on
 *  <body> in the app shell, on the window elsewhere, so both). */
export function scrollWizardTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  document.body.scrollTo({ top: 0, behavior: "smooth" });
}

export function WizardHead({
  title,
  subtitle,
  steps,
  hints,
  step,
  onStep,
  reachable,
  rail = true,
  tool,
  children,
}: {
  // The tool this page is: shows the tool switcher above the title with it
  // marked (2026-10-07). Omit for no switcher.
  tool?: GuestFlow;
  title: string;
  subtitle: string;
  steps: string[];
  // One line per step under the rail; omit for none (/create, 2026-10-07).
  hints?: string[];
  step: number;
  onStep: (next: number) => void;
  // Highest step the rail may jump to (the tool's own gate).
  reachable: number;
  // false = no step rail (/create's 2-step wizard, 2026-10-07: the bar's
  // "Next: ..." label carries the orientation instead).
  rail?: boolean;
  // Shown under the hint.
  children?: ReactNode;
}) {
  return (
    <>
      <header className="text-center">
        <h1 className="tq-h1">{title}</h1>
        {/* No rail = the viewport-fit wizard: the gap below already
            separates the title block, so the subhead's own margin goes. */}
        {/* The shortest stages (under 720px tall) drop the one-line
            subhead: with the switcher row the cards need the height. */}
        <p className={`tq-subhead mt-2 ${rail ? "" : "stage:mb-0"} ${tool ? "stage-tight:hidden" : ""}`}>
          {subtitle}
        </p>
      </header>
      {/* Tool switcher: under the title, right above the cards (owner
          direction 2026-10-07). */}
      {tool ? <FlowSwitcher current={tool} /> : null}
      {rail ? (
        <WizardStepRail steps={steps} active={step} onJump={onStep} reachable={reachable} />
      ) : null}
      {hints?.[step] ? (
        <p className="-mt-2 max-w-xl text-center text-sm text-[var(--tq-text-muted)]">
          {hints[step]}
        </p>
      ) : null}
      {children}
    </>
  );
}

/**
 * Back on the start side, Next (or the tool's Generate button on the last
 * step) on the end side. Sticky so it stays in reach on the long Design grid
 * (`.tq-wizard-bar` switches the content panel to `overflow: clip` so sticky
 * works, globals.css); logical flex only, so RTL mirrors free.
 */
export function WizardBar({
  step,
  lastStep,
  onStep,
  nextDisabled,
  busy,
  status,
  generate,
  nextLabel,
  wide = false,
}: {
  step: number;
  lastStep: number;
  onStep: (next: number) => void;
  nextDisabled: boolean;
  // Overrides the plain "Next" (e.g. "Next: Look" when there is no rail).
  nextLabel?: string;
  // As wide as the two-card stage (WizardStage's max-w-6xl) instead of 3xl.
  wide?: boolean;
  // Submitting: Back is disabled too.
  busy: boolean;
  // A short status in the middle (e.g. "extracting your file..."), shown
  // after step 1 so a disabled Generate explains itself.
  status?: string | null;
  generate: ReactNode;
}) {
  const t = useDict().flows;
  return (
    <div className={`tq-wizard-bar sticky bottom-4 z-40 flex w-full ${wide ? "max-w-6xl" : "max-w-3xl"} items-center justify-between gap-3 rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] p-2 shadow-lg`}
    >
      {step > 0 ? (
        <PillButton variant="secondary" onClick={() => onStep(step - 1)} disabled={busy}>
          {t.wizard.back}
        </PillButton>
      ) : (
        <span />
      )}
      {status && step > 0 ? (
        <span className="hidden items-center gap-2 text-xs text-[var(--tq-text-muted)] sm:flex">
          <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-foreground/30 border-t-foreground" />
          {status}
        </span>
      ) : null}
      {step < lastStep ? (
        <PillButton
          variant="primary"
          onClick={() => onStep(step + 1)}
          disabled={busy || nextDisabled}
        >
          {nextLabel ?? t.wizard.next}
        </PillButton>
      ) : (
        generate
      )}
    </div>
  );
}

/**
 * The Design step: a ready-made template OR a design style, full width, in
 * two tabs. Picking one clears the other (the caller's handlers do that).
 * Both grids stay mounted so the template list isn't refetched per tab flip.
 */
export function DesignStep({
  visible,
  tab,
  onTab,
  templateId,
  onPickTemplate,
  onGuestPickTemplate,
  onClearTemplate,
  designStyle,
  onDesignStyle,
  templateNote,
  disabled = false,
}: {
  visible: boolean;
  tab: "templates" | "styles";
  onTab: (next: "templates" | "styles") => void;
  templateId: string | null;
  onPickTemplate: (picked: PickedTemplate) => void;
  // Visitor: remember the pick only (set up after sign-in).
  onGuestPickTemplate?: (tpl: PickerTemplate) => void;
  onClearTemplate: () => void;
  designStyle: string | null;
  onDesignStyle: (style: string | null) => void;
  // What a picked template does in this tool (shown while one is picked).
  templateNote: string;
  disabled?: boolean;
}) {
  const t = useDict().flows;
  return (
    <section className={`${visible ? "flex" : "hidden"} w-full max-w-[1400px] flex-col gap-4`}>
      <div className="flex flex-col items-center gap-2">
        <div role="tablist" aria-label={t.design.card} className="design-tabs w-full max-w-sm">
          {(["templates", "styles"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => onTab(k)}
              className={`design-tab ${tab === k ? "is-active" : ""}`}
            >
              {k === "templates" ? t.design.tabTemplates : t.design.tabStyles}
            </button>
          ))}
        </div>
        {templateId ? (
          <p className="max-w-xl text-center text-xs leading-5 text-foreground/55">{templateNote}</p>
        ) : null}
      </div>
      <div className={tab === "templates" ? "" : "hidden"}>
        <TemplatePickerGrid
          wide
          onGuestSelect={onGuestPickTemplate}
          selectedId={templateId}
          onSelect={onPickTemplate}
          onClear={onClearTemplate}
          disabled={disabled}
        />
      </div>
      <div className={tab === "styles" ? "" : "hidden"}>
        {/* A picked template outranks the style grid: no tile reads as
            active (not even Auto) while one is set. */}
        <DesignStyleGrid
          wide
          value={templateId ? "__template__" : designStyle}
          onChange={onDesignStyle}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

/** The Brand step: all optional. */
export function BrandStep({
  visible,
  kitOptions,
  onPickKit,
  colors,
  minPalette,
  maxPalette,
  onAutoColors,
  onUpdateColor,
  onRemoveColor,
  onAddColor,
  onPickPreset,
  brandFont,
  onBrandFont,
  sampleText,
  logoFile,
  logoPreviewUrl,
  onLogoSelect,
  onLogoRemove,
  saveBrandKit,
  onSaveBrandKit,
  disabled = false,
  autoLabel,
  autoHint,
}: {
  visible: boolean;
  kitOptions: BrandKitOption[];
  onPickKit: (id: string) => void;
  colors: string[];
  minPalette: number;
  maxPalette: number;
  // "Auto": no palette, the AI picks one for the content.
  onAutoColors: () => void;
  onUpdateColor: (index: number, next: string) => void;
  onRemoveColor: (index: number) => void;
  onAddColor: () => void;
  onPickPreset: (colors: string[]) => void;
  brandFont: BrandFontState;
  onBrandFont: (next: BrandFontState) => void;
  sampleText: string;
  logoFile: File | null;
  logoPreviewUrl: string | null;
  onLogoSelect: (file: File) => void;
  onLogoRemove: () => void;
  saveBrandKit: boolean;
  onSaveBrandKit: (next: boolean) => void;
  disabled?: boolean;
  // The "no palette" pill's label + tooltip (default "Auto"; mimic reads
  // its colours off the reference deck instead).
  autoLabel?: string;
  autoHint?: string;
}) {
  const t = useDict().flows;
  return (
    <section className={`${visible ? "flex" : "hidden"} w-full max-w-5xl flex-col gap-4`}>
      {kitOptions.length > 0 ? (
        // z-30 keeps the saved-kit menu above the cards below it.
        <div className="relative z-30 flex justify-end">
          <BrandKitDropdown kits={kitOptions} onSelect={onPickKit} />
        </div>
      ) : null}
      <div className="grid w-full gap-4 desk:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Colours: Auto / custom swatches, then the named colour templates. */}
        <div className="surface-card flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
          <PaletteRow
            colors={colors}
            minPalette={minPalette}
            maxPalette={maxPalette}
            onAutoColors={onAutoColors}
            onUpdateColor={onUpdateColor}
            onRemoveColor={onRemoveColor}
            onAddColor={onAddColor}
            autoLabel={autoLabel}
            autoHint={autoHint}
          />
          <span className="text-xs font-medium text-foreground/55">{t.design.colorTemplates}</span>
          <PalettePresetPicker wide colors={colors} onPick={onPickPreset} disabled={disabled} />
        </div>

        <div className="flex flex-col gap-4">
          {/* One brand font: a Google family (Claude varies weights) OR up to
              5 uploaded families (Claude pairs). */}
          <div className="surface-card rounded-2xl p-4 sm:p-5">
            <BrandFontPicker value={brandFont} onChange={onBrandFont} sampleText={sampleText} allowAuto />
          </div>
          <div className="surface-card flex flex-col gap-2 rounded-2xl p-4 sm:p-5">
            <span className="text-sm font-semibold text-foreground/80">{t.logo}</span>
            <LogoRow
              file={logoFile}
              previewUrl={logoPreviewUrl}
              onSelect={onLogoSelect}
              onRemove={onLogoRemove}
            />
          </div>
          <div className="surface-card flex items-center justify-between gap-2 rounded-2xl px-4 py-3 sm:px-5">
            <span className="text-sm font-semibold text-foreground/80">{t.saveAsDefault}</span>
            <Toggle ariaLabel={t.saveAsDefault} value={saveBrandKit} onChange={onSaveBrandKit} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The colours row: Auto (no palette, the AI picks) + the custom swatches. */
export function PaletteRow({
  colors,
  minPalette,
  maxPalette,
  onAutoColors,
  onUpdateColor,
  onRemoveColor,
  onAddColor,
  autoLabel,
  autoHint,
  end,
}: {
  colors: string[];
  minPalette: number;
  maxPalette: number;
  onAutoColors: () => void;
  onUpdateColor: (index: number, next: string) => void;
  onRemoveColor: (index: number) => void;
  onAddColor: () => void;
  autoLabel?: string;
  autoHint?: string;
  // Appended after the swatches (the Brand card's colour-template "Show all").
  end?: ReactNode;
}) {
  const t = useDict().flows;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-semibold text-foreground/80">{t.colors}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Auto pill: active when no colours are picked; in manual mode it is
            the way back to Auto. */}
        <button
          type="button"
          onClick={onAutoColors}
          disabled={colors.length === 0}
          aria-pressed={colors.length === 0}
          title={autoHint ?? t.autoColorsHint}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
            colors.length === 0
              ? "border-foreground/40 text-foreground"
              : "border-dashed border-foreground/20 text-foreground/60 hover:border-foreground/40 hover:text-foreground"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
            auto_awesome
          </span>
          {autoLabel ?? t.autoColors}
        </button>
        {colors.map((color, index) => (
          <InlinePaletteSwatch
            key={index}
            value={color}
            index={index}
            removable={colors.length > minPalette}
            onChange={(next) => onUpdateColor(index, next)}
            onRemove={() => onRemoveColor(index)}
          />
        ))}
        {colors.length < maxPalette ? (
          <button
            type="button"
            onClick={onAddColor}
            aria-label={t.addColor}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-foreground/20 text-foreground/60 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              add
            </span>
          </button>
        ) : null}
        {end}
      </div>
    </div>
  );
}

// ─── Two-card wizard (/create, 2026-10-07 owner direction) ──────────────────
// Two steps, no rail: each step is ONE wide card at the reading start and ONE
// narrow card at the end. On a desktop viewport (`stage:` variant) the page is
// exactly one viewport tall (`.tq-wizard-fit`, globals.css) and both steps
// fill the same leftover height between the title and the bar: nothing moves
// between steps, the page never scrolls; the template / style grids scroll
// inside their card, the colour templates show the rows that fit + "Show all". Phones and short viewports stack
// at natural height and the page scrolls.

/** The box both steps render into: the viewport's leftover height, capped
 *  on tall screens so the narrow cards don't stretch into empty panels. */
export function WizardStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-6xl stage:min-h-0 stage:max-h-176 stage:flex-1">{children}</div>
  );
}

/** One step: wide card first (reading start), narrow card second. */
export function SplitStep({
  visible,
  label,
  children,
}: {
  visible: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={`${visible ? "grid" : "hidden"} w-full gap-4 desk:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] stage:h-full stage:grid-rows-[minmax(0,1fr)]`}
    >
      {children}
    </section>
  );
}

/** A stage card: title row (+ an optional end slot), then the body. */
export function WizardCard({
  title,
  end,
  children,
}: {
  title: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="surface-card flex min-h-0 min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5 stage:gap-3 stage:p-4 stage-tight:gap-2">
      {/* One title-row height for every card (the tallest end slot, the
          design tabs), so the titles line up across steps and cards. z-30
          keeps a menu dropping out of the end slot (saved kits) above the
          rows below it. */}
      <div className="relative z-30 flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {end}
      </div>
      {children}
    </div>
  );
}

/**
 * The Design card: Templates | Styles tabs in the title row, the picked
 * grid below (scrolls inside the card on a viewport-fit stage). Same
 * handlers as DesignStep.
 */
export function DesignCard({
  tab,
  onTab,
  templateId,
  onPickTemplate,
  onGuestPickTemplate,
  onClearTemplate,
  designStyle,
  onDesignStyle,
  templateNote,
  upload,
  disabled = false,
  stylesFirst = false,
  suggestedStyles,
}: {
  tab: "templates" | "styles";
  onTab: (next: "templates" | "styles") => void;
  templateId: string | null;
  onPickTemplate: (picked: PickedTemplate) => void;
  onGuestPickTemplate?: (tpl: PickerTemplate) => void;
  onClearTemplate: () => void;
  designStyle: string | null;
  onDesignStyle: (style: string | null) => void;
  templateNote: string;
  // /create only: the "Upload your own" tile in the Templates tab.
  upload?: TemplateUploadControl;
  disabled?: boolean;
  // /create (2026-10-19): the Styles tab comes first, and its grid leads with
  // the styles suggested for the content.
  stylesFirst?: boolean;
  suggestedStyles?: readonly string[];
}) {
  const t = useDict().flows;
  return (
    <WizardCard
      title={t.design.card}
      end={
        <div role="tablist" aria-label={t.design.card} className="design-tabs w-full max-w-xs">
          {(stylesFirst ? (["styles", "templates"] as const) : (["templates", "styles"] as const)).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => onTab(k)}
              className={`design-tab ${tab === k ? "is-active" : ""}`}
            >
              {k === "templates" ? t.design.tabTemplates : t.design.tabStyles}
            </button>
          ))}
        </div>
      }
    >
      {templateId ? (
        <p className="-mt-1 text-xs leading-5 text-foreground/55">{templateNote}</p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={tab === "templates" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TemplatePickerGrid
            wide
            fit
            onGuestSelect={onGuestPickTemplate}
            selectedId={templateId}
            onSelect={onPickTemplate}
            onClear={onClearTemplate}
            upload={upload}
            disabled={disabled}
          />
        </div>
        <div className={tab === "styles" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          {/* A picked template outranks the style grid: no tile reads as
              active (not even Auto) while one is set. */}
          <DesignStyleGrid
            wide
            fit
            value={templateId ? "__template__" : designStyle}
            onChange={onDesignStyle}
            disabled={disabled}
            suggested={suggestedStyles}
          />
        </div>
      </div>
    </WizardCard>
  );
}

/**
 * The Brand card, fitting the stage without scrolling: saved kits in the
 * title row, the one-row font picker and the compact logo slot first, then
 * colours (Auto / custom + as many colour-template rows as fit, the rest in
 * "Show all"), and "save as default" pinned to the bottom. All optional.
 */
export function BrandCard({
  kitOptions,
  onPickKit,
  colors,
  minPalette,
  maxPalette,
  onAutoColors,
  onUpdateColor,
  onRemoveColor,
  onAddColor,
  onPickPreset,
  brandFont,
  onBrandFont,
  sampleText,
  logoFile,
  logoPreviewUrl,
  onLogoSelect,
  onLogoRemove,
  saveBrandKit,
  onSaveBrandKit,
  disabled = false,
  autoLabel,
  autoHint,
  fontAuto = true,
}: {
  kitOptions: BrandKitOption[];
  onPickKit: (id: string) => void;
  colors: string[];
  minPalette: number;
  maxPalette: number;
  onAutoColors: () => void;
  onUpdateColor: (index: number, next: string) => void;
  onRemoveColor: (index: number) => void;
  onAddColor: () => void;
  onPickPreset: (colors: string[]) => void;
  brandFont: BrandFontState;
  onBrandFont: (next: BrandFontState) => void;
  sampleText: string;
  logoFile: File | null;
  logoPreviewUrl: string | null;
  onLogoSelect: (file: File) => void;
  onLogoRemove: () => void;
  saveBrandKit: boolean;
  onSaveBrandKit: (next: boolean) => void;
  disabled?: boolean;
  // What "Auto" means in this tool (mimic: the reference deck's colours).
  autoLabel?: string;
  autoHint?: string;
  // Offer the font "Auto" (off for mimic, which copies a reference design).
  fontAuto?: boolean;
}) {
  const t = useDict().flows;
  const [palettesOpen, setPalettesOpen] = useState(false);
  return (
    <WizardCard
      title={t.brandCard}
      end={
        kitOptions.length > 0 ? <BrandKitDropdown kits={kitOptions} onSelect={onPickKit} /> : null
      }
    >
      {/* Font and logo first: the font dropdown opens downward with the
          card's height below it (at the bottom it was cut off). */}
      <div>
        <BrandFontPicker
          value={brandFont}
          onChange={onBrandFont}
          sampleText={sampleText}
          compact
          tall
          allowAuto={fontAuto}
        />
      </div>
      {/* Label and the compact slot share one row (saves a line). */}
      <div className="flex items-center gap-3 border-t border-[var(--tq-border-hairline)] pt-4 stage:pt-3 stage-tight:pt-2">
        <span className="shrink-0 text-sm font-semibold text-foreground/80">{t.logo}</span>
        <div className="min-w-0 flex-1">
          <LogoRow
            compact
            file={logoFile}
            previewUrl={logoPreviewUrl}
            onSelect={onLogoSelect}
            onRemove={onLogoRemove}
          />
        </div>
      </div>
      {/* Colours take the card's leftover height: as many colour-template
          rows as fit (no scroll), the rest in "Show all". */}
      <div className="flex flex-col gap-2 border-t border-[var(--tq-border-hairline)] pt-4 stage:min-h-0 stage:flex-1 stage:pt-3 stage-tight:pt-2">
        <PaletteRow
          colors={colors}
          minPalette={minPalette}
          maxPalette={maxPalette}
          onAutoColors={onAutoColors}
          onUpdateColor={onUpdateColor}
          onRemoveColor={onRemoveColor}
          onAddColor={onAddColor}
          autoLabel={autoLabel}
          autoHint={autoHint}
          end={
            // Wrapper: the button's own `self-end` is made for columns.
            <span className="flex">
              <PickerExpandButton onClick={() => setPalettesOpen(true)} disabled={disabled} />
            </span>
          }
        />
        <PalettePresetPicker
          colors={colors}
          onPick={onPickPreset}
          disabled={disabled}
          fill
          expanded={palettesOpen}
          onExpandedChange={setPalettesOpen}
        />
      </div>
      {/* Pinned to the card's bottom edge. */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-4 stage:pt-3 stage-tight:pt-2">
        <span className="text-sm font-semibold text-foreground/80">{t.saveAsDefault}</span>
        <Toggle ariaLabel={t.saveAsDefault} value={saveBrandKit} onChange={onSaveBrandKit} />
      </div>
    </WizardCard>
  );
}
