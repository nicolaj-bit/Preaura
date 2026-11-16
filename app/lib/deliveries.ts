// Kernelogikken for leverancer. Rene funktioner uden database eller Shopify,
// så de kan testes direkte. Alt andet i appen hviler på disse.

export type DeliveryStatus = "OPEN" | "CANCELLED";
export type AllocationStatus = "ACTIVE" | "CANCELLED";

/** Det, admin-siden viser. Kun OPEN/CANCELLED gemmes; resten regnes ud. */
export type DeliveryState = "ACTIVE" | "UPCOMING" | "SOLD_OUT" | "CANCELLED";

export type AllocationLike = { quantity: number; status: string };

/** Summen af aktive tildelinger. Annullerede tildelinger tæller ikke. */
export function allocatedQuantity(allocations: AllocationLike[]): number {
  return allocations
    .filter((allocation) => allocation.status === "ACTIVE")
    .reduce((sum, allocation) => sum + allocation.quantity, 0);
}

/**
 * Resterende antal = leverancens antal minus summen af aktive tildelinger.
 *
 * Tallet gemmes aldrig. Det regnes ud hver gang ud fra tildelingerne, så det
 * ikke kan drive fra virkeligheden. Resultatet klippes ikke ved 0: er det
 * negativt, er der lovet for meget væk, og det skal kunne ses.
 */
export function remainingQuantity(
  quantity: number,
  allocations: AllocationLike[],
): number {
  return quantity - allocatedQuantity(allocations);
}

type ActiveCandidate = {
  id: string;
  position: number;
  status: string;
  remaining: number;
};

/**
 * Den aktive leverance er den første efter rækkefølgenummer, der hverken er
 * annulleret eller udsolgt. Er der ingen, returneres null.
 */
export function findActiveDelivery<T extends ActiveCandidate>(
  deliveries: T[],
): T | null {
  const sorted = [...deliveries].sort((a, b) => a.position - b.position);
  return (
    sorted.find(
      (delivery) => delivery.status === "OPEN" && delivery.remaining > 0,
    ) ?? null
  );
}

export function deliveryState(
  delivery: ActiveCandidate,
  activeId: string | null,
): DeliveryState {
  if (delivery.status === "CANCELLED") return "CANCELLED";
  if (delivery.remaining <= 0) return "SOLD_OUT";
  if (delivery.id === activeId) return "ACTIVE";
  return "UPCOMING";
}

// ---------------------------------------------------------------------------
// Validering
// ---------------------------------------------------------------------------

export type DeliveryInput = { date: unknown; quantity: unknown };

export type DeliveryErrors = { date?: string; quantity?: string };

export type ValidationResult =
  | { ok: true; value: { date: string; quantity: number } }
  | { ok: false; errors: DeliveryErrors };

export type ValidationContext = {
  /** Dagens dato i butikkens tidszone, "YYYY-MM-DD". */
  today: string;
  /** Allerede tildelt (aktive tildelinger). 0 for en ny leverance. */
  allocated: number;
  /**
   * Leverancens nuværende dato, når en eksisterende leverance rettes. En
   * uændret dato må gerne ligge i fortiden — ellers kunne man ikke rette
   * antallet på en leverance, hvis dato er passeret.
   */
  currentDate?: string;
  /**
   * Variantens andre åbne leverancer. Ingen to leverancer må have samme
   * dato, og en ny leverance (newDelivery) skal ligge efter dem alle, fordi
   * den sælges sidst.
   */
  others?: { position: number; date: string }[];
  newDelivery?: boolean;
};

// Fejlbeskeder siger, hvad der er galt, OG hvad butikken skal gøre.
export const MESSAGES = {
  dateMissing:
    "Vælg den dato, du forventer at sende varerne. Det er den dato, kunderne får lovet.",
  dateInvalid:
    "Datoen kan ikke læses. Vælg den i kalenderen, eller skriv den som ÅÅÅÅ-MM-DD, fx 2027-01-15.",
  dateNotFuture:
    "Datoen er i dag eller er passeret. Vælg en dato fra i morgen og frem — det er den dato, kunderne får lovet.",
  quantityInvalid:
    "Skriv antallet som et helt tal, fx 50 — uden komma, mellemrum eller «stk.».",
  quantityNotPositive:
    "Antallet skal være mindst 1: det er, hvor mange du kan sælge på forudbestilling i leverancen. Vil du stoppe salget, så annullér leverancen i stedet.",
  quantityBelowAllocated: (allocated: number) =>
    `${allocated} stk. er allerede solgt i leverancen, så antallet skal være mindst ${allocated}. Vil du sælge færre, må du annullere ordrer i Shopify først.`,
  dateOverlaps: (position: number, date: string) =>
    `Leverance ${position} har allerede datoen ${formatDanish(date)}. Ret antallet på leverance ${position} i stedet, eller vælg en anden dato.`,
  dateBeforeExisting: (position: number, date: string) =>
    `Nye leverancer sælges efter de eksisterende, så datoen skal ligge efter ${formatDanish(date)} (leverance ${position}). Kommer der varer før, så ret datoen på leverance ${position} i stedet.`,
} as const;

const danish = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "long",
  timeZone: "UTC",
});
function formatDanish(date: string) {
  return isValidDateString(date)
    ? danish.format(new Date(`${date}T12:00:00Z`))
    : date;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Sand, hvis strengen er en rigtig kalenderdato på formen YYYY-MM-DD. */
export function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseQuantity(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * De tre regler for en leverance:
 * 1. Datoen skal ligge i fremtiden (efter i dag).
 * 2. Antal skal være større end nul.
 * 3. Antal må ikke være lavere end det, der allerede er tildelt.
 *
 * Alle fejl returneres samlet, så brugeren ser dem på én gang.
 */
export function validateDelivery(
  input: DeliveryInput,
  context: ValidationContext,
): ValidationResult {
  const errors: DeliveryErrors = {};

  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!date) {
    errors.date = MESSAGES.dateMissing;
  } else if (!isValidDateString(date)) {
    errors.date = MESSAGES.dateInvalid;
  } else if (date !== context.currentDate && date <= context.today) {
    // Datoerne er YYYY-MM-DD, så tekst-sammenligning er dato-sammenligning.
    errors.date = MESSAGES.dateNotFuture;
  } else if (context.others?.length) {
    const same = context.others.find((o) => o.date === date);
    if (same) {
      errors.date = MESSAGES.dateOverlaps(same.position, same.date);
    } else if (context.newDelivery) {
      const latest = [...context.others].sort((a, b) =>
        b.date.localeCompare(a.date),
      )[0];
      if (latest && latest.date > date) {
        errors.date = MESSAGES.dateBeforeExisting(latest.position, latest.date);
      }
    }
  }

  const quantity = parseQuantity(input.quantity);
  if (quantity === null) {
    errors.quantity = MESSAGES.quantityInvalid;
  } else if (quantity <= 0) {
    errors.quantity = MESSAGES.quantityNotPositive;
  } else if (quantity < context.allocated) {
    errors.quantity = MESSAGES.quantityBelowAllocated(context.allocated);
  }

  if (errors.date || errors.quantity) return { ok: false, errors };
  return { ok: true, value: { date, quantity: quantity as number } };
}

/** Dagens dato som "YYYY-MM-DD" i den angivne tidszone (fx "Europe/Copenhagen"). */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  // en-CA formaterer som YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Lægger dage til en dato på formen "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
