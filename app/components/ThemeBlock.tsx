import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { blockStatus, type BlockStatus } from "../onboarding/setup";

// Er PREAURA-blokken aktiv i butikkens udgivne tema? Spørger Shopify via App
// Bridge (app.extensions()) — kræver ingen ekstra adgangsret og læses frisk,
// hver gang siden vises.

export function useBlockStatus(): BlockStatus {
  const shopify = useAppBridge();
  const [status, setStatus] = useState<BlockStatus>("unknown");
  useEffect(() => {
    let cancelled = false;
    const app = (
      shopify as unknown as {
        app?: { extensions?: () => Promise<unknown[]> };
      }
    ).app;
    if (!app?.extensions) return;
    app
      .extensions()
      .then((extensions) => {
        if (!cancelled) {
          setStatus(
            blockStatus(extensions as Parameters<typeof blockStatus>[0]),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [shopify]);
  return status;
}

/**
 * Vises, når blokken ikke er i temaet. Forklarer følgen — ikke bare
 * tilstanden — og har en knap, der åbner temaeditoren med blokken klar.
 */
export function ThemeBlockBanner({
  status,
  url,
  preorderOn,
}: {
  status: BlockStatus;
  url: string;
  /** Er forudbestilling slået til på mindst én variant? */
  preorderOn: boolean;
}) {
  if (status !== "inactive") return null;
  return (
    <s-banner
      tone={preorderOn ? "critical" : "warning"}
      heading={
        preorderOn
          ? "Dine kunder kan ikke se forudbestillingen endnu"
          : "PREAURA-blokken mangler i dit tema"
      }
    >
      <s-paragraph>
        Forudbestillinger bliver ikke vist for kunderne, før PREAURA-blokken er
        slået til på produktsiden i dit tema. Uden den ser kunderne hverken
        leveringsdatoen eller vilkårene, og datoen kommer ikke med i kurven og
        på ordren.
      </s-paragraph>
      <s-paragraph>
        Knappen åbner temaeditoren med blokken klar — tryk Gem. Åbner den ikke
        blokken, understøtter dit tema sandsynligvis ikke app-blokke (det kræver
        et Online Store 2.0-tema). Skriv til os, så hjælper vi.
      </s-paragraph>
      <s-button slot="secondary-actions" href={url} target="_top">
        Tilføj blokken i temaet
      </s-button>
    </s-banner>
  );
}
