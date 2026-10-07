"use client";

// Guest draft for the flows open to visitors (2026-10-06, owner direction:
// /create, then /enhance): a signed-out visitor sets the whole deck up, then
// signs up at the Create button. Each flow keeps its own draft + return path. Sign-up leaves
// the page (Google OAuth round trip, or the email confirmation link), so the
// setup is saved in THIS browser and restored on return:
//   - the settings as JSON in localStorage (small, synchronous), and
//   - the files (content document, logo, uploaded font faces) in IndexedDB,
//     which holds File/Blob values natively.
// The draft expires after DRAFT_TTL_MS and is cleared once consumed. Nothing
// here ever leaves the browser; uploads happen after sign-in, through the
// page's normal signed-in paths. Every storage call is wrapped: private
// windows / blocked storage just mean no draft.

import { localizedHref } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/config";
import type { BrandFontState } from "@/lib/brand/fonts";

export const GUEST_SAVE_EVENT = "taqreer:guest-save-draft";

// The flows a visitor can set up before signing up. The value is also the
// route segment ("/create", "/enhance").
export type GuestFlow = "create" | "enhance" | "mimic";
export const GUEST_FLOWS: readonly GuestFlow[] = ["create", "enhance", "mimic"];

const settingsKey = (flow: GuestFlow) => `tq.${flow}GuestDraft.v1`;
const dbName = (flow: GuestFlow) => `tq-${flow}-guest`;
const STORE = "files";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// "generate": came back from the Create-button sign-up, so restore and start
// generating. "restore": came back from the top bar's Log in, restore only.
export type ResumeMode = "generate" | "restore";

export type GuestDraftSettings = {
  step: number;
  contentText: string;
  language: string;
  persistentText: string;
  templateId: string | null;
  designStyle: string | null;
  lookTab: "templates" | "styles";
  colors: string[];
  fontMode: "google" | "upload";
  googleFamily: string | null;
  // Uploaded font families: names + weights; the File of each face is in
  // IndexedDB under `font:<family index>:<face index>`.
  uploadedFonts: { name: string; weights: number[] }[];
  slideSize: string;
  slideCountMode: string;
  slideCountValue: number;
  pagination: boolean;
  imagesMode: boolean;
  // Quality is NOT kept: the new account's own default applies.
};

// /enhance's setup (the source file itself travels as `content`).
export type EnhanceGuestSettings = {
  step: number;
  instructions: string;
  templateId: string | null;
  designStyle: string | null;
  lookTab: "templates" | "styles";
  colors: string[];
  colorsAuto: boolean;
  fontMode: "google" | "upload";
  googleFamily: string | null;
  uploadedFonts: { name: string; weights: number[] }[];
  imagesMode: boolean;
};

// /mimic's setup (content file -> `content`, reference deck -> `design`).
export type MimicGuestSettings = {
  step: number;
  contentText: string;
  colorSource: "reference" | "custom";
  colors: string[];
  fontMode: "google" | "upload";
  googleFamily: string | null;
  uploadedFonts: { name: string; weights: number[] }[];
  slideSize: string;
  slideCountMode: string;
  slideCountValue: number;
  imagesMode: boolean;
  instructions: string;
};

export type GuestDraftFiles = {
  content: File | null;
  // /mimic's reference deck.
  design?: File | null;
  logo: File | null;
  // keyed `<family>:<face>`
  fonts: Record<string, File>;
};

type Stored<T> = { savedAt: number; settings: T };

// ─── Return URLs ────────────────────────────────────────────────────
export function resumePath(flow: GuestFlow, locale: Locale, mode: ResumeMode): string {
  return localizedHref(`/${flow}?resume=${mode}`, locale);
}

export function guestLoginHref(flow: GuestFlow, locale: Locale, mode: ResumeMode): string {
  return `${localizedHref("/login", locale)}?next=${encodeURIComponent(resumePath(flow, locale, mode))}`;
}

export function guestSignupHref(flow: GuestFlow, locale: Locale, mode: ResumeMode): string {
  return `${localizedHref("/signup", locale)}?next=${encodeURIComponent(resumePath(flow, locale, mode))}`;
}

// The ?resume=<mode> a signed-in user lands on after a guest sign-up.
export function readResumeMode(): ResumeMode | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("resume");
  return v === "generate" || v === "restore" ? v : null;
}

// ─── Brand font <-> draft ───────────────────────────────────────────
// Uploaded font faces are Files: their names + weights go in the settings,
// the Files in IndexedDB under `<family>:<face>`.
export function fontToDraft(font: BrandFontState): {
  fontMode: "google" | "upload";
  googleFamily: string | null;
  uploadedFonts: { name: string; weights: number[] }[];
  fontFiles: Record<string, File>;
} {
  const fontFiles: Record<string, File> = {};
  font.uploaded.forEach((family, fi) =>
    family.faces.forEach((face, ci) => {
      if (face.file) fontFiles[`${fi}:${ci}`] = face.file;
    }),
  );
  return {
    fontMode: font.mode,
    googleFamily: font.googleFamily,
    uploadedFonts: font.uploaded.map((f) => ({
      name: f.name,
      weights: f.faces.map((face) => face.weight),
    })),
    fontFiles,
  };
}

export function fontFromDraft(
  d: Pick<EnhanceGuestSettings, "fontMode" | "googleFamily" | "uploadedFonts">,
  files: GuestDraftFiles,
): BrandFontState | null {
  if (d.fontMode === "upload" && d.uploadedFonts.length > 0) {
    const uploaded = d.uploadedFonts
      .map((family, fi) => ({
        name: family.name,
        faces: family.weights
          .map((weight, ci) => ({
            weight,
            file: files.fonts[`${fi}:${ci}`] ?? null,
            storageUrl: null,
          }))
          .filter((face) => face.file),
      }))
      .filter((family) => family.faces.length > 0);
    return uploaded.length > 0 ? { mode: "upload", googleFamily: null, uploaded } : null;
  }
  if (d.googleFamily) return { mode: "google", googleFamily: d.googleFamily, uploaded: [] };
  return null;
}

// ─── IndexedDB (files) ──────────────────────────────────────────────
function openDb(flow: GuestFlow): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(dbName(flow), 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeFiles(flow: GuestFlow, files: GuestDraftFiles): Promise<void> {
  const db = await openDb(flow);
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      if (files.content) store.put(files.content, "content");
      if (files.design) store.put(files.design, "design");
      if (files.logo) store.put(files.logo, "logo");
      for (const [key, file] of Object.entries(files.fonts)) {
        store.put(file, `font:${key}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve(); // e.g. quota: the settings still restore
    } catch {
      resolve();
    }
  });
  db.close();
}

async function readFiles(flow: GuestFlow): Promise<GuestDraftFiles> {
  const out: GuestDraftFiles = { content: null, design: null, logo: null, fonts: {} };
  const db = await openDb(flow);
  if (!db) return out;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String(cursor.key);
        const value = cursor.value;
        if (value instanceof File) {
          if (key === "content") out.content = value;
          else if (key === "design") out.design = value;
          else if (key === "logo") out.logo = value;
          else if (key.startsWith("font:")) out.fonts[key.slice(5)] = value;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
  return out;
}

async function clearFiles(flow: GuestFlow): Promise<void> {
  const db = await openDb(flow);
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

// ─── Public API ─────────────────────────────────────────────────────
export function saveGuestSettings<T>(flow: GuestFlow, settings: T): void {
  try {
    const stored: Stored<T> = { savedAt: Date.now(), settings };
    localStorage.setItem(settingsKey(flow), JSON.stringify(stored));
  } catch {
    /* storage blocked / full: no draft */
  }
}

export function saveGuestFiles(flow: GuestFlow, files: GuestDraftFiles): Promise<void> {
  return writeFiles(flow, files);
}

export async function loadGuestDraft<T>(flow: GuestFlow): Promise<{
  settings: T;
  files: GuestDraftFiles;
} | null> {
  let stored: Stored<T> | null = null;
  try {
    const raw = localStorage.getItem(settingsKey(flow));
    stored = raw ? (JSON.parse(raw) as Stored<T>) : null;
  } catch {
    stored = null;
  }
  if (!stored?.settings || typeof stored.savedAt !== "number") return null;
  if (Date.now() - stored.savedAt > DRAFT_TTL_MS) {
    await clearGuestDraft(flow);
    return null;
  }
  return { settings: stored.settings, files: await readFiles(flow) };
}

export async function clearGuestDraft(flow: GuestFlow): Promise<void> {
  try {
    localStorage.removeItem(settingsKey(flow));
  } catch {
    /* ignore */
  }
  await clearFiles(flow);
}
