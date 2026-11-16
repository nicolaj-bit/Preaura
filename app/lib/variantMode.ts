import { coded } from "../i18n";
// Hvilken tilstand en variant skal være i. Ren funktion uden database og
// Shopify, så reglerne kan testes direkte.
//
// - STOCK (lagermode): der er rigtige varer. Appen rører hverken lagertal
//   eller selling plans; webshopejeren styrer lageret som altid.
// - PREORDER (forudbestillingsmode): ingen varer. Appen ejer lagertallet
//   (= det resterende i den aktive leverance) og tilbyder selling plan.

export type VariantMode = "STOCK" | "PREORDER";

export type ModeInput = {
  mode: VariantMode;
  forced: boolean;
  /** Shopifys tilgængelige antal lige nu. */
  available: number;
  /** Det antal, appen sidst selv skrev til Shopify. Null, hvis intet. */
  syncedAvailable: number | null;
  /** Findes der en åben leverance med plads tilbage? */
  hasSpace: boolean;
  /**
   * Enheder, der allerede er lovet kunder (aktive tildelinger). Kommer der
   * varer hjem, går de først til dem.
   */
  owed: number;
  /** Lageret, da tvangen blev slået til (gives tilbage, når den slås fra). */
  stockBeforeForce: number | null;
  /** Varer lagt på lager, mens varianten var tvunget. */
  receivedWhileForced: number;
};

export type ModeDecision = {
  mode: VariantMode;
  /** Sand, når tilstanden skifter nu. */
  changed: boolean;
  /** Kort forklaring til admin. Kun sat ved skift. */
  reason: string | null;
  /**
   * Ved skift til lagermode: det antal, Shopify skal stå på bagefter (de
   * rigtige varer, der er tilbage efter forudbestillingerne).
   */
  stockAvailable: number | null;
};

const stay = (mode: VariantMode): ModeDecision => ({
  mode,
  changed: false,
  reason: null,
  stockAvailable: null,
});

export function decideMode(input: ModeInput): ModeDecision {
  // Tvunget forudbestilling vinder altid.
  if (input.forced) {
    if (input.mode === "PREORDER") return stay("PREORDER");
    return {
      mode: "PREORDER",
      changed: true,
      reason: coded("stored.mode.forced"),
      stockAvailable: null,
    };
  }

  if (input.mode === "STOCK") {
    if (input.available <= 0 && input.hasSpace) {
      return {
        mode: "PREORDER",
        changed: true,
        reason: coded("stored.mode.empty"),
        stockAvailable: null,
      };
    }
    return stay("STOCK");
  }

  // Forudbestillingsmode, ikke tvunget.

  // Tvangen er netop slået fra: lageret fra før tvangen gives tilbage, plus
  // varer lagt på lager imens — dem dog først efter forudbestillingerne.
  if (input.stockBeforeForce != null) {
    const before = Math.max(0, input.stockBeforeForce);
    const extra = Math.max(0, input.receivedWhileForced - input.owed);
    const stock = before + extra;
    if (stock > 0) {
      return {
        mode: "STOCK",
        changed: true,
        reason: coded("stored.mode.unforced", { count: stock }),
        stockAvailable: stock,
      };
    }
  }

  // Rigtige varer kommet ind: Shopify står højere, end appen selv satte det.
  // (Salg kan kun trække tallet ned.) Varerne går først til de kunder, der
  // har forudbestilt; kun resten er almindeligt lager.
  if (input.syncedAvailable != null) {
    const received = input.available - input.syncedAvailable;
    if (received > 0) {
      const forSale = received - input.owed;
      if (forSale > 0) {
        return {
          mode: "STOCK",
          changed: true,
          reason:
            input.owed > 0
              ? coded("stored.mode.receivedSplit", {
                  count: received,
                  owed: input.owed,
                  forSale,
                })
              : coded("stored.mode.received", { count: received }),
          stockAvailable: forSale,
        };
      }
    }
  }

  return stay("PREORDER");
}
