import type { ReleaseSettings } from "../models/release.server";

// Kontrol af butikkens indstillinger for annullering og afvist betaling.
// Annullering kan ikke slås fra: fristen er «indtil varen er sendt» eller et
// antal dage (mindst 1). Appen lægger ingen bestemt lovgivning ind — butikken
// sætter sin politik inden for mekanismen.

export const LIMITS = {
  cancelDays: { min: 1, max: 365 },
  cancelAutoDays: { min: 1, max: 365 },
  paymentGraceDays: { min: 1, max: 60 },
} as const;

type Field = keyof typeof LIMITS;

export function parseReleaseSettings(input: Record<string, unknown>) {
  const errors: Partial<
    Record<Field | "cancelWindow" | "cancelApproval", string>
  > = {};
  const cancelWindow =
    input.cancelWindow === "DAYS"
      ? "DAYS"
      : input.cancelWindow === "UNTIL_FULFILLED"
        ? "UNTIL_FULFILLED"
        : null;
  if (!cancelWindow) errors.cancelWindow = "Vælg en frist.";
  const cancelApproval =
    input.cancelApproval === "AUTO"
      ? "AUTO"
      : input.cancelApproval === "MANUAL"
        ? "MANUAL"
        : null;
  if (!cancelApproval) errors.cancelApproval = "Vælg godkendelse.";
  const numbers = {} as Record<Field, number>;
  for (const field of Object.keys(LIMITS) as Field[]) {
    const { min, max } = LIMITS[field];
    const text = String(input[field] ?? "").trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || value < min || value > max) {
      errors[field] = `Skriv et helt tal fra ${min} til ${max}.`;
    } else {
      numbers[field] = value;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };
  const values: ReleaseSettings = {
    cancelWindow: cancelWindow!,
    cancelDays: numbers.cancelDays,
    cancelApproval: cancelApproval!,
    cancelAutoDays: numbers.cancelAutoDays,
    paymentGraceDays: numbers.paymentGraceDays,
  };
  return { ok: true as const, values };
}
