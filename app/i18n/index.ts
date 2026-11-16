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

/**
 * Et beløb i butikkens valuta, skrevet som på sproget: «1.234,50 kr.» på
 * dansk, «DKK 1,234.50» på engelsk. Beløbet omregnes aldrig.
 */
export function formatMoney(locale: Locale, value: number, currency: string) {
  try {
    return new Intl.NumberFormat(locale === "da" ? "da-DK" : "en-US", {
      style: "currency",
      currency,
      currencyDisplay: locale === "da" ? "symbol" : "code",
    }).format(value);
  } catch {
    // Ukendt valutakode: vis tallet med koden efter.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Tidspunkt med dato og klokkeslæt, fx «16. nov. 2026 14.05». */
export function formatDateTime(
  locale: Locale,
  date: Date | string,
  timeZone = "UTC",
) {
  return new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(typeof date === "string" ? new Date(date) : date);
}

// --- Beskeder, der gemmes og vises senere ---------------------------------
//
// En fejl, som serveren gemmer (fx på en variant eller en hændelse), skal
// vises på sproget hos den, der ser den. Den gemmes derfor som en nøgle med
// variabler («i18n:nøgle|{...}») og oversættes først, når den vises. En
// variabel, der starter med «@», er selv en nøgle. Ældre beskeder uden
// nøgle (dansk tekst, Shopifys egne fejl) vises, som de er.

const CODED = "i18n:";

/** En besked, der gemmes nu og oversættes, når den vises. */
export function coded(key: MessageKey, vars?: Vars) {
  return vars ? `${CODED}${key}|${JSON.stringify(vars)}` : `${CODED}${key}`;
}

function isKey(key: string): key is MessageKey {
  return key in MESSAGES.en;
}

/** En gemt besked på sproget. Tekst uden nøgle vises uændret. */
export function localizeStored(
  locale: Locale,
  text: string | null | undefined,
): string {
  if (text == null) return "";
  // En besked kan være pakket ind i en anden (fx «Fejl: i18n:…»).
  const start = text.indexOf(CODED);
  if (start < 0) return text;
  const body = text.slice(start + CODED.length);
  const bar = body.indexOf("|");
  const key = bar < 0 ? body : body.slice(0, bar);
  if (!isKey(key)) return text;
  let vars: Vars | undefined;
  if (bar >= 0) {
    try {
      vars = JSON.parse(body.slice(bar + 1)) as Vars;
    } catch {
      return text;
    }
  }
  const resolved: Vars = {};
  for (const [name, value] of Object.entries(vars ?? {})) {
    const nested = String(value);
    resolved[name] = nested.startsWith("@")
      ? isKey(nested.slice(1))
        ? translate(locale, nested.slice(1) as MessageKey)
        : nested.slice(1)
      : localizeStored(locale, nested);
  }
  return text.slice(0, start) + translate(locale, key, resolved);
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
    money: (value: number, currency: string) =>
      formatMoney(locale, value, currency),
    /** En gemt besked (eller en teknisk forklaring) på sproget. */
    stored: (text: string | null | undefined) => localizeStored(locale, text),
  };
}
