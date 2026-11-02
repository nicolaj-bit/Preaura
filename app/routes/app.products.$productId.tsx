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
import {
  DeliveryValidationError,
  PreorderActionError,
  forShop,
  type DeliveryView,
} from "../models/preorder.server";
import {
  fetchProducts,
  fetchShopTimeZone,
} from "../lib/shopifyProducts.server";
import { numericId } from "../lib/ids";
import {
  addDays,
  todayInTimeZone,
  type DeliveryErrors,
} from "../lib/deliveries";

// Ét produkt: forudbestilling pr. variant og leverancer pr. variant.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);

  if (!/^\d+$/.test(params.productId ?? "")) {
    throw new Response("Produktet findes ikke.", { status: 404 });
  }
  const productId = `gid://shopify/Product/${params.productId}`;

  // Kun produkter, butikken selv har valgt, kan åbnes.
  let plans = await data.variantPlans.listForProduct(productId);
  if (plans.length === 0) {
    throw new Response("Produktet findes ikke i appen.", { status: 404 });
  }

  const [product] = await fetchProducts(admin.graphql, [productId]);

  // Er der kommet nye varianter til i Shopify, tilføjes de (slået fra).
  const missing = (product?.variants ?? []).filter(
    (variant) => !plans.some((plan) => plan.variantId === variant.id),
  );
  if (missing.length > 0) {
    await data.variantPlans.addVariants(
      missing.map((variant) => ({
        productId,
        variantId: variant.id,
        inventoryItemId: variant.inventoryItemId,
        locationId: variant.locationId,
      })),
    );
    plans = await data.variantPlans.listForProduct(productId);
  }

  const deliveries = await data.deliveries.listForVariants(
    plans.map((plan) => plan.variantId),
  );
  const timeZone = await fetchShopTimeZone(admin.graphql);

  return {
    today: todayInTimeZone(timeZone),
    product: {
      title: product?.title ?? "Produktet findes ikke længere i Shopify",
      imageUrl: product?.imageUrl ?? null,
    },
    variants: plans.map((plan) => {
      const variant = product?.variants.find((v) => v.id === plan.variantId);
      return {
        variantId: plan.variantId,
        title: variant?.title ?? "Varianten findes ikke længere i Shopify",
        sku: variant?.sku ?? null,
        enabled: plan.preorderEnabled,
        deliveries: deliveries.filter((d) => d.variantId === plan.variantId),
      };
    }),
  };
};

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message?: string; fieldErrors?: DeliveryErrors };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const today = () =>
    fetchShopTimeZone(admin.graphql).then((tz) => todayInTimeZone(tz));

  try {
    switch (intent) {
      case "toggle": {
        const enabled = form.get("enabled") === "true";
        await data.variantPlans.setEnabled(
          String(form.get("variantId")),
          enabled,
        );
        return {
          ok: true,
          message: enabled
            ? "Forudbestilling slået til"
            : "Forudbestilling slået fra",
        };
      }
      case "create":
        await data.deliveries.create(
          String(form.get("variantId")),
          { date: form.get("date"), quantity: form.get("quantity") },
          await today(),
        );
        return { ok: true, message: "Leverance oprettet" };
      case "update":
        await data.deliveries.update(
          String(form.get("deliveryId")),
          { date: form.get("date"), quantity: form.get("quantity") },
          await today(),
        );
        return { ok: true, message: "Leverance gemt" };
      case "delete":
        await data.deliveries.remove(String(form.get("deliveryId")));
        return { ok: true, message: "Leverance slettet" };
      case "cancel":
        await data.deliveries.cancel(String(form.get("deliveryId")));
        return { ok: true, message: "Leverance annulleret" };
      default:
        return { ok: false, message: "Ukendt handling." };
    }
  } catch (error) {
    if (error instanceof DeliveryValidationError) {
      return { ok: false, fieldErrors: error.errors };
    }
    if (error instanceof PreorderActionError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Visning
// ---------------------------------------------------------------------------

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type VariantData = LoaderData["variants"][number];

const dateFormat = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "long",
  timeZone: "UTC",
});
function formatDate(date: string) {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

/** Viser en toast, når en handling lykkes. */
function useSuccessToast(result: ActionResult | undefined) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
  }, [result, shopify]);
}

export default function ProductPage() {
  const { product, variants, today } = useLoaderData<typeof loader>();

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app">
        Produkter
      </s-link>
      {variants.map((variant) => (
        <VariantSection
          key={variant.variantId}
          variant={variant}
          today={today}
          showTitle={variants.length > 1}
        />
      ))}
    </s-page>
  );
}

function VariantSection({
  variant,
  today,
  showTitle,
}: {
  variant: VariantData;
  today: string;
  showTitle: boolean;
}) {
  const toggle = useFetcher<typeof action>();
  useSuccessToast(toggle.data);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Vis den nye værdi med det samme, mens den gemmes.
  const enabled =
    toggle.formData != null
      ? toggle.formData.get("enabled") === "true"
      : variant.enabled;
  const hasActive = variant.deliveries.some((d) => d.state === "ACTIVE");
  const editing = variant.deliveries.find((d) => d.id === editingId);

  const heading = showTitle
    ? `${variant.title}${variant.sku ? ` · ${variant.sku}` : ""}`
    : "Leverancer";

  return (
    <s-section heading={heading}>
      <s-stack gap="base">
        <s-switch
          label="Forudbestilling"
          details="Kunder kan bestille varianten, før den er på lager."
          checked={enabled}
          onChange={() =>
            toggle.submit(
              {
                intent: "toggle",
                variantId: variant.variantId,
                enabled: String(!enabled),
              },
              { method: "POST" },
            )
          }
        />
        {toggle.data && !toggle.data.ok && toggle.data.message && (
          <s-banner tone="critical">{toggle.data.message}</s-banner>
        )}
        {enabled && !hasActive && (
          <s-banner tone="warning">
            Forudbestilling er slået til, men der er ingen leverance med ledige
            pladser. Opret en leverance nedenfor.
          </s-banner>
        )}

        {variant.deliveries.length > 0 && (
          <DeliveryTable
            deliveries={variant.deliveries}
            onEdit={(id) => setEditingId(id)}
          />
        )}

        {editing ? (
          <DeliveryForm
            key={editing.id}
            heading={`Ret leverance ${editing.position}`}
            intent="update"
            target={{ deliveryId: editing.id }}
            initial={{ date: editing.date, quantity: String(editing.quantity) }}
            minimum={editing.allocated}
            today={today}
            submitLabel="Gem"
            onDone={() => setEditingId(null)}
          />
        ) : (
          <DeliveryForm
            heading="Ny leverance"
            intent="create"
            target={{ variantId: variant.variantId }}
            initial={{ date: "", quantity: "" }}
            minimum={0}
            today={today}
            submitLabel="Tilføj leverance"
          />
        )}
      </s-stack>
    </s-section>
  );
}

const STATE_BADGES: Record<
  DeliveryView["state"],
  { label: string; tone: "success" | "neutral" | "warning" | "critical" }
> = {
  ACTIVE: { label: "Aktiv", tone: "success" },
  UPCOMING: { label: "Kommende", tone: "neutral" },
  SOLD_OUT: { label: "Udsolgt", tone: "warning" },
  CANCELLED: { label: "Annulleret", tone: "critical" },
};

function DeliveryTable({
  deliveries,
  onEdit,
}: {
  deliveries: DeliveryView[];
  onEdit: (id: string) => void;
}) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header>Nr.</s-table-header>
        <s-table-header listSlot="primary">Dato</s-table-header>
        <s-table-header format="numeric">Antal</s-table-header>
        <s-table-header format="numeric">Tildelt</s-table-header>
        <s-table-header format="numeric">Resterende</s-table-header>
        <s-table-header listSlot="secondary">Status</s-table-header>
        <s-table-header>Handlinger</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {deliveries.map((delivery) => (
          <DeliveryRow key={delivery.id} delivery={delivery} onEdit={onEdit} />
        ))}
      </s-table-body>
    </s-table>
  );
}

function DeliveryRow({
  delivery,
  onEdit,
}: {
  delivery: DeliveryView;
  onEdit: (id: string) => void;
}) {
  const fetcher = useFetcher<typeof action>();
  useSuccessToast(fetcher.data);
  const busy = fetcher.state !== "idle";
  const badge = STATE_BADGES[delivery.state];
  const cancelled = delivery.state === "CANCELLED";
  const modalId = `cancel-${delivery.id}`;

  const submit = (intent: "delete" | "cancel") =>
    fetcher.submit({ intent, deliveryId: delivery.id }, { method: "POST" });

  return (
    <s-table-row>
      <s-table-cell>{delivery.position}</s-table-cell>
      <s-table-cell>{formatDate(delivery.date)}</s-table-cell>
      <s-table-cell>{delivery.quantity}</s-table-cell>
      <s-table-cell>{delivery.allocated}</s-table-cell>
      <s-table-cell>{cancelled ? "–" : delivery.remaining}</s-table-cell>
      <s-table-cell>
        <s-badge tone={badge.tone}>{badge.label}</s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small">
          {!cancelled && (
            <s-button-group>
              <s-button
                slot="secondary-actions"
                onClick={() => onEdit(delivery.id)}
              >
                Ret
              </s-button>
              <s-button
                slot="secondary-actions"
                commandFor={modalId}
                command="--show"
              >
                Annullér
              </s-button>
              <s-button
                slot="secondary-actions"
                tone="critical"
                onClick={() => submit("delete")}
                {...(busy ? { loading: true } : {})}
              >
                Slet
              </s-button>
            </s-button-group>
          )}

          {fetcher.data && !fetcher.data.ok && fetcher.data.message && (
            <s-banner tone="critical">{fetcher.data.message}</s-banner>
          )}

          {cancelled && delivery.orders.length > 0 && (
            <AffectedOrders orders={delivery.orders} />
          )}
        </s-stack>

        <s-modal
          id={modalId}
          heading={`Annullér leverance ${delivery.position}?`}
        >
          <s-stack gap="base">
            <s-paragraph>
              Leverancen den {formatDate(delivery.date)} markeres som
              annulleret. Det kan ikke fortrydes.
            </s-paragraph>
            {delivery.allocationCount > 0 ? (
              <s-paragraph>
                {delivery.allocationCount === 1
                  ? "1 ordrelinje"
                  : `${delivery.allocationCount} ordrelinjer`}{" "}
                er tildelt leverancen. Tildelingerne bliver stående, så du
                bagefter kan se, hvilke ordrer der er berørt.
              </s-paragraph>
            ) : (
              <s-paragraph>Ingen ordrer er tildelt leverancen.</s-paragraph>
            )}
          </s-stack>
          <s-button
            slot="primary-action"
            tone="critical"
            variant="primary"
            commandFor={modalId}
            command="--hide"
            onClick={() => submit("cancel")}
          >
            Annullér leverance
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor={modalId}
            command="--hide"
          >
            Behold
          </s-button>
        </s-modal>
      </s-table-cell>
    </s-table-row>
  );
}

function AffectedOrders({ orders }: { orders: DeliveryView["orders"] }) {
  // Samme ordre kan have flere linjer i leverancen; vis hver ordre én gang.
  const orderIds = [...new Set(orders.map((order) => order.orderId))];
  return (
    <s-stack gap="small-200">
      <s-text type="strong">Berørte ordrer</s-text>
      <s-unordered-list>
        {orderIds.map((orderId) => (
          <s-list-item key={orderId}>
            <s-link href={`shopify://admin/orders/${numericId(orderId)}`}>
              Ordre {numericId(orderId)}
            </s-link>
          </s-list-item>
        ))}
      </s-unordered-list>
    </s-stack>
  );
}

function DeliveryForm({
  heading,
  intent,
  target,
  initial,
  minimum,
  today,
  submitLabel,
  onDone,
}: {
  heading: string;
  intent: "create" | "update";
  target: { variantId: string } | { deliveryId: string };
  initial: { date: string; quantity: string };
  minimum: number;
  today: string;
  submitLabel: string;
  onDone?: () => void;
}) {
  const fetcher = useFetcher<typeof action>();
  useSuccessToast(fetcher.data);
  const [date, setDate] = useState(initial.date);
  const [quantity, setQuantity] = useState(initial.quantity);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;

  // Tøm felterne, når en ny leverance er oprettet. Gøres under render, når
  // resultatet skifter (Reacts anbefalede mønster), ikke i en effect.
  const [handledResult, setHandledResult] = useState(result);
  if (result !== handledResult) {
    setHandledResult(result);
    if (result?.ok && intent === "create") {
      setDate("");
      setQuantity("");
    }
  }

  // Luk redigeringen, når den er gemt.
  useEffect(() => {
    if (result?.ok) onDone?.();
    // onDone ændrer sig ved hver render; kun resultatet skal udløse dette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>{heading}</s-heading>
        {result && !result.ok && result.message && (
          <s-banner tone="critical">{result.message}</s-banner>
        )}
        <s-stack direction="inline" gap="base">
          <s-date-field
            label="Dato"
            value={date}
            // Ved oprettelse kan kun datoer efter i dag vælges. Ved rettelse
            // må en uændret, passeret dato stå — serveren validerer begge.
            {...(intent === "create"
              ? { allow: `${addDays(today, 1)}--` }
              : {})}
            error={fieldErrors?.date}
            onChange={(event) => setDate(event.currentTarget.value)}
          />
          <s-number-field
            label="Antal"
            value={quantity}
            min={Math.max(1, minimum)}
            step={1}
            details={
              minimum > 0 ? `${minimum} stk. er allerede tildelt.` : undefined
            }
            error={fieldErrors?.quantity}
            onChange={(event) => setQuantity(event.currentTarget.value)}
          />
        </s-stack>
        <s-stack direction="inline" gap="small">
          <s-button
            variant="primary"
            onClick={() =>
              fetcher.submit(
                { intent, ...target, date, quantity },
                { method: "POST" },
              )
            }
            {...(busy ? { loading: true } : {})}
          >
            {submitLabel}
          </s-button>
          {onDone && <s-button onClick={onDone}>Fortryd</s-button>}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
