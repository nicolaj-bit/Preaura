import type { OrderSnapshot } from "../models/preorder.server";
import type { LineTarget, ReleaseSettings } from "../models/release.server";

// Hvad kunden må annullere lige nu, og hvad der sker, når kunden gør det.
// Ren kode — ingen database, intet netværk — så reglerne kan testes.
//
// - Kun forudbestilte enheder, der stadig er reserveret og ikke sendt.
// - Butikkens frist: indtil varen er sendt, eller N dage efter bestilling
//   (mindst 1 dag). Annullering kan ikke slås helt fra.
// - Godkendelse: automatisk, hvis butikken har valgt det, og kunden
//   annullerer inden for butikkens tidsrum; ellers manuelt.

const DAY = 24 * 60 * 60 * 1000;

export type CancelLine = {
  lineId: string;
  title: string;
  variantTitle: string | null;
  /** Hvor mange kunden kan annullere på linjen. */
  cancellable: number;
  /** Linjens nuværende antal i Shopify. */
  quantity: number;
  /** Den dato, kunden fik lovet (seneste, hvis linjen er delt). */
  promisedDate: string | null;
};

export type CancelState =
  | { ok: false; reason: "cancelled" | "window_closed" | "nothing" }
  | { ok: true; lines: CancelLine[]; autoApprove: boolean };

export function cancelState(
  order: OrderSnapshot,
  active: Map<string, { quantity: number; dates: string[] }>,
  settings: ReleaseSettings,
  now = new Date(),
): CancelState {
  if (order.cancelled) return { ok: false, reason: "cancelled" };
  const created = new Date(order.createdAt).getTime();
  if (
    settings.cancelWindow === "DAYS" &&
    now.getTime() > created + Math.max(1, settings.cancelDays) * DAY
  ) {
    return { ok: false, reason: "window_closed" };
  }
  const lines: CancelLine[] = [];
  for (const line of order.lines) {
    const reserved = active.get(line.id);
    if (!reserved || reserved.quantity <= 0) continue;
    const unsent = line.unfulfilled ?? line.quantity;
    const cancellable = Math.min(reserved.quantity, unsent, line.quantity);
    if (cancellable <= 0) continue;
    lines.push({
      lineId: line.id,
      title: line.title ?? "Vare",
      variantTitle: line.variantTitle ?? null,
      cancellable,
      quantity: line.quantity,
      promisedDate: [...reserved.dates].sort().pop() ?? null,
    });
  }
  if (lines.length === 0) {
    // Under «indtil varen er sendt» er fristen netop, at intet er sendt.
    return {
      ok: false,
      reason:
        settings.cancelWindow === "UNTIL_FULFILLED"
          ? "window_closed"
          : "nothing",
    };
  }
  const autoApprove =
    settings.cancelApproval === "AUTO" &&
    now.getTime() <= created + Math.max(1, settings.cancelAutoDays) * DAY;
  return { ok: true, lines, autoApprove };
}

/**
 * Kundens valg (antal at annullere pr. linje) → mål pr. linje: det antal,
 * linjen skal ende på. Ugyldige og for store valg klippes til det lovlige.
 */
export function targetsFromSelection(
  lines: CancelLine[],
  selection: Record<string, unknown>,
): LineTarget[] {
  const targets: LineTarget[] = [];
  for (const line of lines) {
    const raw = Number(selection[line.lineId] ?? 0);
    const cancel = Number.isInteger(raw)
      ? Math.max(0, Math.min(line.cancellable, raw))
      : 0;
    if (cancel > 0) {
      targets.push({
        lineId: line.lineId,
        quantity: line.quantity - cancel,
        from: line.quantity,
      });
    }
  }
  return targets;
}

/**
 * HTML-escaping OG Liquid-escaping: siden renderes som Liquid af Shopify, så
 * { og } i fx et produktnavn må aldrig kunne blive til Liquid-kode.
 */
export function escape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}
