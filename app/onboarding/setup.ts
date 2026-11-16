import { coded } from "../i18n";
// Opsætning: hvor langt butikken er, og om PREAURA-blokken er aktiv i det
// udgivne tema. Ren kode — ingen database, intet netværk — så det kan testes.

/** Mappen i extensions/ og blokkens filnavn i blocks/. */
export const THEME_EXTENSION_HANDLE = "preaura-preorder";
export const BLOCK_HANDLE = "preorder";
/** Kurvens app embed (blocks/cart.liquid). */
export const CART_EMBED_HANDLE = "cart";

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

/**
 * Status og en kort teknisk forklaring, når status ikke kan afgøres. Gælder
 * både produktsidens blok og kurvens app embed (handle = filnavnet i
 * blocks/).
 */
export function describeBlock(
  extensions: unknown,
  handle: string = BLOCK_HANDLE,
): {
  status: BlockStatus;
  reason: string | null;
} {
  if (!Array.isArray(extensions)) {
    return { status: "unknown", reason: coded("setupReason.noAnswer") };
  }
  const themeExtensions = (extensions as ExtensionInfoLike[]).filter(
    (e) => e && e.type === "theme_app_extension",
  );
  if (themeExtensions.length === 0) {
    return {
      status: "unknown",
      reason: coded("setupReason.noThemeExtension", {
        count: extensions.length,
      }),
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
      reason: coded("setupReason.otherName", {
        names: themeExtensions.map((e) => e.handle).join(", "),
      }),
    };
  }
  const block = (ours.activations ?? []).find((a) => a?.handle === handle);
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

/**
 * Dybt link til temaeditoren: åbner «App-integrationer» med kurvens app
 * embed slået til. Butikken skal kun trykke «Gem».
 */
export function cartEmbedUrl(apiKey: string) {
  const params = new URLSearchParams({
    context: "apps",
    activateAppId: `${apiKey}/${CART_EMBED_HANDLE}`,
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
  /** Kurvens app embed i det udgivne tema. */
  cart?: BlockStatus;
  /** Butikken har selv bekræftet kurvens app embed. */
  cartConfirmed?: boolean;
};

export type SetupStepId = "products" | "delivery" | "enable" | "block" | "cart";

/** Shopify har det sidste ord; butikkens bekræftelse tæller kun ved «ukendt». */
const isOn = (status: BlockStatus | undefined, confirmed?: boolean) =>
  status === "active" ||
  ((status ?? "unknown") === "unknown" && Boolean(confirmed));

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
      done: isOn(state.block, state.blockConfirmed),
    },
    { id: "cart", done: isOn(state.cart, state.cartConfirmed) },
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
