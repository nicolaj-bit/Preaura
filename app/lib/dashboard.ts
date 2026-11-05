// Nøgletal til forsiden. Ren funktion, så tallene kan testes.

export type RecentAllocation = {
  orderId: string;
  quantity: number;
  orderCreatedAt: Date | null;
};

export type DashboardStats = {
  /** Ordrer med forudbestilling de seneste 30 dage. */
  orders30: number;
  /** Ændring i procent mod de 30 dage før. Null, når der intet er at sammenligne med. */
  ordersTrendPct: number | null;
  /** Forudbestilte stk. de seneste 30 dage. */
  units30: number;
};

const DAY = 24 * 60 * 60 * 1000;

export function dashboardStats(
  allocations: RecentAllocation[],
  now: Date,
): DashboardStats {
  const since30 = now.getTime() - 30 * DAY;
  const since60 = now.getTime() - 60 * DAY;
  const current = new Set<string>();
  const previous = new Set<string>();
  let units30 = 0;
  for (const a of allocations) {
    const t = a.orderCreatedAt?.getTime();
    if (t == null) continue;
    if (t >= since30 && t <= now.getTime()) {
      current.add(a.orderId);
      units30 += a.quantity;
    } else if (t >= since60 && t < since30) {
      previous.add(a.orderId);
    }
  }
  return {
    orders30: current.size,
    ordersTrendPct:
      previous.size === 0
        ? null
        : Math.round(((current.size - previous.size) / previous.size) * 100),
    units30,
  };
}

/** Andel solgt af en leverance i procent (0–100). */
export function progressPct(allocated: number, quantity: number) {
  if (quantity <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((allocated / quantity) * 100)));
}
