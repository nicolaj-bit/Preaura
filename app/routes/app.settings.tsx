import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DATE_MODES, forShop, type DateMode } from "../models/preorder.server";
import { shopifySync } from "../sync/index.server";
import { PLAN_LANGUAGES, isStandardDateText } from "../sync/plans";
import { translate, useT, type Locale } from "../i18n";
import { localeFor } from "../i18n/locale.server";

// Butiksindstillinger: om datoen vises som afsendelse eller levering, og
// teksten med datoen, som Shopify viser ved planen i kurv og checkout.
//
// Tekster på produktsiden og i kurven (knap, forklaring …) står på blokken
// i temaeditoren, ikke her.

const MAX_LENGTH = 200;

/** Standardteksten vises på butiksejerens sprog; en egen tekst som den er. */
function shown(value: string, kind: "shipping" | "delivery", locale: Locale) {
  return isStandardDateText(value) ? PLAN_LANGUAGES[locale][kind] : value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);
  const settings = await forShop(session.shop).settings.get();
  return {
    dateMode: settings.dateMode as DateMode,
    shippingDateText: shown(settings.shippingDateText, "shipping", locale),
    deliveryDateText: shown(settings.deliveryDateText, "delivery", locale),
  };
};

const TEXT_FIELDS = ["shippingDateText", "deliveryDateText"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);
  const form = await request.formData();

  const dateMode = String(form.get("dateMode")) as DateMode;
  const errors: Partial<Record<TextField | "dateMode", string>> = {};
  if (!DATE_MODES.includes(dateMode)) {
    errors.dateMode = translate(locale, "settings.error.mode");
  }

  const texts = {} as Record<TextField, string>;
  for (const field of TEXT_FIELDS) {
    const value = String(form.get(field) ?? "").trim();
    if (!value) errors[field] = translate(locale, "settings.error.empty");
    else if (value.length > MAX_LENGTH) {
      errors[field] = translate(locale, "settings.error.tooLong", {
        max: MAX_LENGTH,
      });
    }
    texts[field] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const data = forShop(session.shop);
  const before = await data.settings.get();
  // Knaptekst og besked bruges ikke længere (de står på blokken i temaet);
  // de gemte værdier bevares uændret.
  await data.settings.update({
    dateMode,
    ...texts,
    buttonLabel: before.buttonLabel,
    preorderNote: before.preorderNote,
  });

  // Visningen (afsendelse/levering) står i variantens metafelt, som
  // produktsiden læser. Er den ændret, synkroniseres varianterne.
  if (before.dateMode !== dateMode) {
    const sync = shopifySync(admin.graphql, session.shop);
    const products = await data.variantPlans.listProducts();
    for (const { productId } of products) {
      for (const plan of await data.variantPlans.listForProduct(productId)) {
        if (plan.preorderEnabled) await sync.sync(plan.variantId);
      }
    }
  }
  return { ok: true as const };
};

export default function Settings() {
  const saved = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useT();
  const [values, setValues] = useState(saved);
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(t("settings.saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  // Værdien læses med det samme: når React kører opdateringen, er
  // event.currentTarget allerede nulstillet.
  const set = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <s-page heading={t("settings.heading")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fetcher.submit(values, { method: "POST" })}
        {...(busy ? { loading: true } : {})}
      >
        {t("product.save")}
      </s-button>

      <s-section heading={t("settings.date.heading")}>
        <s-choice-list
          label={t("settings.date.label")}
          name="dateMode"
          values={[values.dateMode]}
          error={errors.dateMode}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              dateMode: (event.currentTarget.values[0] ??
                "SHIPPING") as DateMode,
            }))
          }
        >
          <s-choice value="SHIPPING">{t("settings.date.shipping")}</s-choice>
          <s-choice value="DELIVERY">{t("settings.date.delivery")}</s-choice>
        </s-choice-list>
      </s-section>

      <s-section heading={t("settings.texts.heading")}>
        <s-stack gap="base">
          <s-paragraph>{t("settings.texts.intro")}</s-paragraph>
          <s-text-field
            label={t("settings.texts.shipping")}
            details={t("settings.texts.dateHint")}
            value={values.shippingDateText}
            maxLength={MAX_LENGTH}
            error={errors.shippingDateText}
            onChange={set("shippingDateText")}
          />
          <s-text-field
            label={t("settings.texts.delivery")}
            details={t("settings.texts.dateHint")}
            value={values.deliveryDateText}
            maxLength={MAX_LENGTH}
            error={errors.deliveryDateText}
            onChange={set("deliveryDateText")}
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
