"use client";

// Landing "Styles & templates" section body (owner 2026-10-30): two tabs on
// the shared `.design-tabs` control, Styles selected by default. Styles show a
// curated set of the deck looks with real sample slides (LookThumb, hover
// scrubs the slides), each opening Create with it preselected (?style=);
// Templates is the featured template grid. Both panels
// stay in the HTML (the inactive one `hidden`) so their content is crawlable.

import { useId, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { localizedHref } from "@/lib/i18n/navigation";
import { LookThumb } from "@/components/create/LookThumb";
import { LandingTemplatesGrid } from "@/components/marketing/LandingTemplatesGrid";
import type { LandingTemplate } from "@/lib/auth/marquee-projects";

// Hand-picked for variety (sector, palette, mood) from the looks that have
// captured sample slides. The sample slides exist in Arabic only for now
// (LookThumb LOOK_THUMBS), so both locales show the Arabic samples.
const LANDING_STYLES = [
  "heritage",
  "brutalist",
  "techglass",
  "middleschool",
  "retro",
  "corporate",
  "earlyyears",
  "startup",
] as const;
const SAMPLE_LOCALE = "ar";

type Tab = "styles" | "templates";
const TABS: Tab[] = ["styles", "templates"];

export function LandingStylesTemplates({ templates }: { templates: LandingTemplate[] }) {
  const dict = useDict();
  const { locale } = useLocale();
  const isAuthed = useIsAuthed();
  const [active, setActive] = useState<Tab>("styles");
  const baseId = useId();
  const copy = dict.landing.sections.templates;
  const picker = dict.flows.stylePicker;
  // No templates → Styles only (no dead tab).
  const tabs = templates.length > 0 ? TABS : (["styles"] as Tab[]);

  return (
    <div>
      {tabs.length > 1 ? (
        <div role="tablist" className="design-tabs mx-auto mb-10 max-w-xs">
          {tabs.map((tab) => (
            <button
              key={tab}
              id={`${baseId}-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={active === tab}
              aria-controls={`${baseId}-panel-${tab}`}
              onClick={() => setActive(tab)}
              className={`design-tab ${active === tab ? "is-active" : ""}`}
            >
              {copy.tabs[tab]}
            </button>
          ))}
        </div>
      ) : null}

      <div
        id={`${baseId}-panel-styles`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-styles`}
        hidden={active !== "styles"}
      >
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
          {LANDING_STYLES.map((key) => (
            <li key={key}>
              {/* Opens Create with this style preselected (open route, so
                  visitors can start before signing up). */}
              <a href={localizedHref(`/create?style=${key}`, locale)} className="group block">
                <LookThumb k={key} locale={SAMPLE_LOCALE} />
                <h3 className="mt-3 text-sm font-semibold transition-colors group-hover:text-[var(--tq-purple)]">
                  {picker.names[key]}
                </h3>
                <p className="mt-1 text-sm text-muted">{picker.descs[key]}</p>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-16 text-center">
          <a
            href={localizedHref(isAuthed ? "/create" : "/signup", locale)}
            className="btn-gradient inline-flex px-5 py-2 text-sm"
          >
            {copy.stylesCta}
          </a>
        </div>
      </div>

      {tabs.includes("templates") ? (
        <div
          id={`${baseId}-panel-templates`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-templates`}
          hidden={active !== "templates"}
        >
          <LandingTemplatesGrid templates={templates} />
          <div className="mt-16 text-center">
            <a
              href={localizedHref("/presentation-templates", locale)}
              className="btn-gradient inline-flex px-5 py-2 text-sm"
            >
              {copy.viewAll}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
