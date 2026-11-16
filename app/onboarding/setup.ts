// Opsætning: hvor langt butikken er, og om PREAURA-blokken er aktiv i det
// udgivne tema. Ren kode — ingen database, intet netværk — så det kan testes.

/** Mappen i extensions/ og blokkens filnavn i blocks/. */
export const THEME_EXTENSION_HANDLE = "preaura-preorder";
export const BLOCK_HANDLE = "preorder";

/** Det, App Bridge's app.extensions() returnerer (kun det, vi bruger). */
export type ExtensionInfoLike = {
  handle: string;
  type: string;
  activations: {
    handle?: string;
    status?: string;
    activations?: unknown[];
  }[];
};

export type BlockStatus = "active" | "inactive" | "unknown";

/**
 * Er blokken lagt ind i det udgivne tema? «active» betyder, at Shopify melder
 * den aktiv. Kan status ikke læses, er den «unknown» — så siger appen ikke
 * noget forkert, og butikken kan selv bekræfte trinnet.
 *
 * Blokken genkendes på sit filnavn (preorder) i en temaudvidelse — helst
 * vores (preaura-preorder), men også hvis Shopify melder udvidelsen under et
 * andet navn.
 */
export function blockStatus(
  extensions: ExtensionInfoLike[] | null,
): BlockStatus {
  return describeBlock(extensions).status;
}

/** Status og en kort teknisk forklaring, når status ikke kan afgøres. */
export function describeBlock(extensions: unknown): {
  status: BlockStatus;
  reason: string | null;
} {
  if (!Array.isArray(extensions)) {
    return { status: "unknown", reason: "intet svar fra Shopify" };
  }
  const themeExtensions = (extensions as ExtensionInfoLike[]).filter(
    (e) => e && e.type === "theme_app_extension",
  );
  if (themeExtensions.length === 0) {
    return {
      status: "unknown",
      reason: `ingen temaudvidelse i svaret (${extensions.length} udvidelser)`,
    };
  }
  const ours =
    themeExtensions.find((e) => e.handle === THEME_EXTENSION_HANDLE) ??
    themeExtensions.find((e) =>
      (e.activations ?? []).some((a) => a?.handle === BLOCK_HANDLE),
    );
  if (!ours) {
    return {
      status: "unknown",
      reason: `temaudvidelsen hedder ${themeExtensions.map((e) => e.handle).join(", ")}`,
    };
  }
  const block = (ours.activations ?? []).find(
    (a) => a?.handle === BLOCK_HANDLE,
  );
  if (!block) return { status: "inactive", reason: null };
  return {
    status: block.status === "active" ? "active" : "inactive",
    reason: null,
  };
}

/**
 * Dybt link til temaeditoren: åbner produktskabelonen i det udgivne tema
 * med PREAURA-blokken klar til at blive sat ind i produktsektionen. Butikken
 * skal kun trykke «Gem».
 */
export function themeBlockUrl(apiKey: string) {
  const params = new URLSearchParams({
    template: "product",
    addAppBlockId: `${apiKey}/${BLOCK_HANDLE}`,
    target: "mainSection",
  });
  return `shopify://admin/themes/current/editor?${params}`;
}

export type SetupState = {
  hasProducts: boolean;
  hasDelivery: boolean;
  hasEnabled: boolean;
  block: BlockStatus;
  /** Butikken har selv bekræftet blokken (bruges, når status er ukendt). */
  blockConfirmed?: boolean;
};

export type SetupStepId = "products" | "delivery" | "enable" | "block";

/** Trinnene i rækkefølge, og om hvert er gjort. */
export function setupSteps(state: SetupState) {
  const steps: { id: SetupStepId; done: boolean }[] = [
    { id: "products", done: state.hasProducts },
    { id: "delivery", done: state.hasDelivery },
    { id: "enable", done: state.hasEnabled },
    {
      id: "block",
      // Shopify har det sidste ord: melder Shopify blokken inaktiv, tæller
      // butikkens egen bekræftelse ikke.
      done:
        state.block === "active" ||
        (state.block === "unknown" && Boolean(state.blockConfirmed)),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    /** Det næste trin, der mangler — det, guiden fremhæver. */
    next: steps.find((s) => !s.done)?.id ?? null,
  };
}
