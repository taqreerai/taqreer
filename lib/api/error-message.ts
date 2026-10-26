// One place that turns a caught error into a message in the page's language.
// API routes answer `{ error, code? }` with English `error` text; the stable
// `code` is what the client translates. The browser's own network failure
// ("Failed to fetch" in Chrome, "Load failed" in Safari, "NetworkError ..." in
// Firefox) gets its own message. On an Arabic page an untranslated English
// message never shows: it falls back to the generic line.

import { useCallback } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { classifyExtractError } from "@/lib/extract/error-codes";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type ErrorStrings = Dictionary["common"]["errors"];

/** An error from one of our API routes, carrying its stable `code` and HTTP status. */
export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/** Build an ApiError from a failed response (reads `{ error, code }` when present). */
export async function apiError(res: Response, fallback: string): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  const message = typeof data?.error === "string" && data.error ? data.error : fallback;
  // rate-limit.ts answers `{ error: "rate_limited" }`: the message is the code.
  const code = typeof data?.code === "string" ? data.code : message === "rate_limited" ? "rate_limited" : undefined;
  return new ApiError(message, code, res.status);
}

const NETWORK_MESSAGE = /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed|the network connection was lost\.?)$/i;

/** True for the browser's "no response at all" fetch failure. */
export function isNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return NETWORK_MESSAGE.test(message.trim());
}

const CODE_KEYS: Record<string, keyof ErrorStrings> = {
  unauthorized: "unauthorized",
  suspended: "suspended",
  rate_limited: "rateLimited",
  file_too_large: "fileTooLarge",
  logo_type: "logoType",
  logo_too_large: "logoTooLarge",
  upload_failed: "uploadFailed",
};

const STATUS_KEYS: Record<number, keyof ErrorStrings> = {
  401: "unauthorized",
  413: "fileTooLarge",
  429: "rateLimited",
};

const ARABIC = /[؀-ۿ]/;

export function localizedError(
  err: unknown,
  opts: { locale: string; errors: ErrorStrings; extract?: Dictionary["flows"]["extractErrors"] },
): string {
  const { errors, extract, locale } = opts;
  if (isNetworkError(err)) return errors.network;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (err instanceof ApiError) {
    const key = (err.code && CODE_KEYS[err.code]) || (err.status && STATUS_KEYS[err.status]);
    if (key) return errors[key];
  }
  if (extract) {
    const code = classifyExtractError(message);
    if (code === "file_too_large") return extract.fileTooLarge;
    if (code === "pdf_encrypted") return extract.pdfEncrypted;
    if (code === "conversion_failed") return extract.conversionFailed;
    if (code === "upload_interrupted") return extract.uploadInterrupted;
    if (code === "start_failed") return extract.startFailed;
  }
  if (!message) return errors.generic;
  // A message the client or server already localized passes through.
  if (locale === "ar") return ARABIC.test(message) ? message : errors.generic;
  return message;
}

/** `localizedError` bound to the page's dictionary and locale. */
export function useErrorText(): (err: unknown, withExtract?: boolean) => string {
  const dict = useDict();
  const { locale } = useLocale();
  return useCallback(
    (err: unknown, withExtract = false) =>
      localizedError(err, {
        locale,
        errors: dict.common.errors,
        extract: withExtract ? dict.flows.extractErrors : undefined,
      }),
    [dict, locale],
  );
}
