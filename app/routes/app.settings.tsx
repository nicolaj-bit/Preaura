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

// Butiksindstillinger: om datoen vises som afsendelse eller levering, og de
// tekster, webshopejeren selv kan ændre.

const MAX_LENGTH = 200;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await forShop(session.shop).settings.get();
  return {
    dateMode: settings.dateMode as DateMode,
    buttonLabel: settings.buttonLabel,
    shippingDateText: settings.shippingDateText,
    deliveryDateText: settings.deliveryDateText,
    preorderNote: settings.preorderNote,
  };
};

const TEXT_FIELDS = [
  "buttonLabel",
  "shippingDateText",
  "deliveryDateText",
  "preorderNote",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const dateMode = String(form.get("dateMode")) as DateMode;
  const errors: Partial<Record<TextField | "dateMode", string>> = {};
  if (!DATE_MODES.includes(dateMode)) errors.dateMode = "Vælg en visning.";

  const texts = {} as Record<TextField, string>;
  for (const field of TEXT_FIELDS) {
    const value = String(form.get(field) ?? "").trim();
    if (!value) errors[field] = "Teksten må ikke være tom.";
    else if (value.length > MAX_LENGTH)
      errors[field] = `Højst ${MAX_LENGTH} tegn.`;
    texts[field] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const data = forShop(session.shop);
  const before = await data.settings.get();
  await data.settings.update({ dateMode, ...texts });

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
  const [values, setValues] = useState(saved);
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Indstillinger gemt");
  }, [fetcher.data, shopify]);

  const set = (field: keyof typeof values) => (event: Event) =>
    setValues((current) => ({
      ...current,
      [field]: (event.currentTarget as HTMLInputElement).value,
    }));

  return (
    <s-page heading="Indstillinger">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fetcher.submit(values, { method: "POST" })}
        {...(busy ? { loading: true } : {})}
      >
        Gem
      </s-button>

      <s-section heading="Dato i webshoppen">
        <s-choice-list
          label="Vis leverancens dato som"
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
          <s-choice value="SHIPPING">Forventet afsendelse</s-choice>
          <s-choice value="DELIVERY">Forventet levering</s-choice>
        </s-choice-list>
      </s-section>

      <s-section heading="Tekster">
        <s-stack gap="base">
          <s-text-field
            label="Knaptekst"
            value={values.buttonLabel}
            maxLength={MAX_LENGTH}
            error={errors.buttonLabel}
            onChange={set("buttonLabel")}
          />
          <s-text-field
            label="Tekst ved forventet afsendelse"
            details="{dato} erstattes af leverancens dato."
            value={values.shippingDateText}
            maxLength={MAX_LENGTH}
            error={errors.shippingDateText}
            onChange={set("shippingDateText")}
          />
          <s-text-field
            label="Tekst ved forventet levering"
            details="{dato} erstattes af leverancens dato."
            value={values.deliveryDateText}
            maxLength={MAX_LENGTH}
            error={errors.deliveryDateText}
            onChange={set("deliveryDateText")}
          />
          <s-text-area
            label="Besked om forudbestilling"
            value={values.preorderNote}
            maxLength={MAX_LENGTH}
            error={errors.preorderNote}
            onChange={set("preorderNote")}
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
