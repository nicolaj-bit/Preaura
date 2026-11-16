// Nøgletal til forsidens oversigt. Ren funktion, så tallene kan testes.

export type RecentAllocation = {
  orderId: string;
  quantity: number;
  orderCreatedAt: Date | null;
  /** Pris pr. stk. (Prisma Decimal, tekst eller tal). Tom for ældre rækker. */
  unitPrice?: { toString(): string } | string | number | null;
  currency?: string | null;
};

/** Perioderne, oversigten kan vise. */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;

export function parsePeriod(value: string | null | undefined): Period {
  const days = Number(value);
  return (PERIODS as readonly number[]).includes(days)
    ? (days as Period)
    : DEFAULT_PERIOD;
}

export type DashboardStats = {
  /** Ordrer med forudbestilling i perioden. */
  orders: number;
  /** Ændring i procent mod perioden før. Null, når der intet er at sammenligne med. */
  ordersTrendPct: number | null;
  /** Forudbestilte stk. i perioden. */
  units: number;
  /**
   * Forudbestilt for i perioden, i butikkens valuta. Null, når ingen af
   * periodens tildelinger har en pris.
   */
  amount: { value: number; currency: string } | null;
  amountTrendPct: number | null;
  /** Gennemsnitlig værdi pr. ordre med pris. */
  averageOrder: { value: number; currency: string } | null;
  /** Nogle af periodens tildelinger er fra før prisen blev gemt. */
  amountPartial: boolean;
};

const DAY = 24 * 60 * 60 * 1000;

function trend(current: number, previous: number) {
  return previous === 0
    ? null
    : Math.round(((current - previous) / previous) * 100);
}

/** Afrundet til øre, så kommatal ikke ophobes. */
const round = (n: number) => Math.round(n * 100) / 100;

export function dashboardStats(
  allocations: RecentAllocation[],
  now: Date,
  days: number = DEFAULT_PERIOD,
): DashboardStats {
  const end = now.getTime();
  const start = end - days * DAY;
  const previousStart = end - 2 * days * DAY;

  // Valutaen er butikkens. Skulle butikken have skiftet valuta, tælles kun
  // den, der er brugt senest — beløb i to valutaer kan ikke lægges sammen.
  const latestCurrency = allocations
    .filter((a) => a.currency && a.unitPrice != null && a.orderCreatedAt)
    .sort(
      (a, b) =>
        (b.orderCreatedAt as Date).getTime() -
        (a.orderCreatedAt as Date).getTime(),
    )[0]?.currency;

  const current = new Set<string>();
  const previous = new Set<string>();
  const pricedOrders = new Set<string>();
  let units = 0;
  let amount = 0;
  let previousAmount = 0;
  let partial = false;

  for (const a of allocations) {
    const t = a.orderCreatedAt?.getTime();
    if (t == null) continue;
    const priced =
      a.unitPrice != null && latestCurrency != null && a.currency === latestCurrency;
    const value = priced ? Number(a.unitPrice!.toString()) * a.quantity : 0;
    if (t >= start && t <= end) {
      current.add(a.orderId);
      units += a.quantity;
      if (priced) {
        amount += value;
        pricedOrders.add(a.orderId);
      } else {
        partial = true;
      }
    } else if (t >= previousStart && t < start) {
      previous.add(a.orderId);
      if (priced) previousAmount += value;
    }
  }

  const hasAmount = latestCurrency != null && pricedOrders.size > 0;
  return {
    orders: current.size,
    ordersTrendPct: trend(current.size, previous.size),
    units,
    amount: hasAmount ? { value: round(amount), currency: latestCurrency } : null,
    amountTrendPct: hasAmount ? trend(amount, previousAmount) : null,
    averageOrder: hasAmount
      ? { value: round(amount / pricedOrders.size), currency: latestCurrency }
      : null,
    amountPartial: hasAmount && partial,
  };
}

/** Andel solgt af en leverance i procent (0–100). */
export function progressPct(allocated: number, quantity: number) {
  if (quantity <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((allocated / quantity) * 100)));
}
