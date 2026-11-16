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
 * den aktiv. Kan status ikke læses (fx ældre Shopify Admin), er den
 * «unknown» — så siger appen ikke noget forkert.
 */
export function blockStatus(
  extensions: ExtensionInfoLike[] | null,
): BlockStatus {
  if (!extensions) return "unknown";
  const extension = extensions.find(
    (e) =>
      e.type === "theme_app_extension" && e.handle === THEME_EXTENSION_HANDLE,
  );
  if (!extension) return "unknown";
  const block = extension.activations.find((a) => a.handle === BLOCK_HANDLE);
  if (!block) return "inactive";
  return block.status === "active" ? "active" : "inactive";
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
};

export type SetupStepId = "products" | "delivery" | "enable" | "block";

/** Trinnene i rækkefølge, og om hvert er gjort. */
export function setupSteps(state: SetupState) {
  const steps: { id: SetupStepId; done: boolean }[] = [
    { id: "products", done: state.hasProducts },
    { id: "delivery", done: state.hasDelivery },
    { id: "enable", done: state.hasEnabled },
    { id: "block", done: state.block === "active" },
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
