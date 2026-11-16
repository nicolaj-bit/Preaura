import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  BLOCK_HANDLE,
  describeBlock,
  type BlockStatus,
} from "../onboarding/setup";

// Er PREAURA-blokken aktiv i butikkens udgivne tema? Spørger Shopify via App
// Bridge (app.extensions()) — kræver ingen ekstra adgangsret og læses frisk,
// hver gang siden vises.

export function useBlockStatus(): BlockStatus {
  return useBlockInfo().status;
}

/**
 * Status og — når den ikke kan afgøres — en kort teknisk forklaring.
 * handle: produktsidens blok (standard) eller kurvens app embed.
 */
export function useBlockInfo(handle: string = BLOCK_HANDLE): {
  status: BlockStatus;
  reason: string | null;
} {
  const shopify = useAppBridge();
  const [info, setInfo] = useState<{
    status: BlockStatus;
    reason: string | null;
  }>({ status: "unknown", reason: null });
  useEffect(() => {
    let cancelled = false;
    const app = (
      shopify as unknown as {
        app?: { extensions?: () => Promise<unknown> };
      }
    ).app;
    // Altid asynkront, så tilstanden aldrig sættes direkte i effekten.
    Promise.resolve()
      .then(() => {
        if (!app?.extensions) {
          throw new Error("Shopify Admin tilbyder ikke app.extensions()");
        }
        return app.extensions();
      })
      .then((extensions) => {
        if (!cancelled) setInfo(describeBlock(extensions, handle));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInfo({
            status: "unknown",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shopify, handle]);
  return info;
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
  const { t } = useT();
  if (status !== "inactive") return null;
  return (
    <s-banner
      tone={preorderOn ? "critical" : "warning"}
      heading={
        preorderOn
          ? t("themeBlock.headingPreorderOn")
          : t("themeBlock.headingPreorderOff")
      }
    >
      <s-paragraph>{t("themeBlock.consequence")}</s-paragraph>
      <s-paragraph>{t("themeBlock.howTo")}</s-paragraph>
      <s-button slot="secondary-actions" href={url} target="_top">
        {t("themeBlock.button")}
      </s-button>
    </s-banner>
  );
}
