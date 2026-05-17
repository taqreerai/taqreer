import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  // `ar-SA-u-nu-latn` keeps Arabic month names + word order but
  // forces Latin digits (0-9). The whole dashboard standardises on
  // Latin numerals for readability across mixed Arabic / English UI.
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    dateStyle: "long",
  }).format(new Date(date));
}

export function truncate(str: string, length: number) {
  return str.length > length ? `${str.substring(0, length)}...` : str;
}

export function getStartOfMonthUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
