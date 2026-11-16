import { createContext, useContext } from "react";
import { da, type MessageKey } from "./da";
import { en } from "./en";

// Appens sprog i Shopify Admin: dansk eller engelsk, efter sproget i
// butiksejerens Shopify Admin (se locale.server.ts). Teksterne står i da.ts
// og en.ts; TypeScript sikrer, at hver tekst findes på begge sprog.
//
// Tekster med tal har to former: «nøgle.one» (1) og «nøgle.other» (alle
// andre). Variabler skrives {navn}.

export type Locale = "da" | "en";
export const LOCALES: Locale[] = ["da", "en"];
export const DEFAULT_LOCALE: Locale = "en";
export type { MessageKey };

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { da, en };

/** «da», «da-DK», «en-GB» … → appens sprog. Andre sprog: null. */
export function resolveLocale(value: string | null | undefined): Locale | null {
  const base = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return base === "da" || base === "en" ? base : null;
}

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars) {
  const text = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

type PluralBase = MessageKey extends infer K
  ? K extends `${infer B}.one`
    ? B
    : never
  : never;

/** Tekst med et antal: «1 ordre» / «3 ordrer». {count} er antallet. */
export function translateCount(
  locale: Locale,
  key: PluralBase,
  count: number,
  vars?: Vars,
) {
  const form = (count === 1 ? `${key}.one` : `${key}.other`) as MessageKey;
  return translate(locale, form, { count, ...vars });
}

/** «2026-12-02» → «2. december 2026» / «December 2, 2026». */
export function formatDate(locale: Locale, date: string, timeZone = "UTC") {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`)
    : new Date(date);
  return new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-US", {
    dateStyle: "long",
    timeZone,
  }).format(value);
}

export const LocaleContext = createContext<Locale>("da");

/** Til komponenter: t("nøgle"), tn("nøgle", antal) og sproget. */
export function useT() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key: MessageKey, vars?: Vars) => translate(locale, key, vars),
    tn: (key: PluralBase, count: number, vars?: Vars) =>
      translateCount(locale, key, count, vars),
    date: (date: string, timeZone?: string) =>
      formatDate(locale, date, timeZone),
  };
}
