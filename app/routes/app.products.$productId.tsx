import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { themeBlockUrl } from "../onboarding/setup";
import { ThemeBlockBanner, useBlockStatus } from "../components/ThemeBlock";
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
  formatDateTime,
  localizeStored,
  translate,
  useT,
  type MessageKey,
} from "../i18n";
import { localeFor } from "../i18n/locale.server";
import { shopifySync } from "../sync/index.server";
import { scheduleQueue } from "../orders/scheduler.server";
import {
  addDays,
  todayInTimeZone,
  type DeliveryErrors,
} from "../lib/deliveries";

// Ét produkt: forudbestilling pr. variant og leverancer pr. variant.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);
  const locale = await localeFor(request, session.shop);

  if (!/^\d+$/.test(params.productId ?? "")) {
    throw new Response(translate(locale, "product.notFound"), { status: 404 });
  }
  const productId = `gid://shopify/Product/${params.productId}`;

  // Kun produkter, butikken selv har valgt, kan åbnes.
  let plans = await data.variantPlans.listForProduct(productId);
  if (plans.length === 0) {
    throw new Response(translate(locale, "product.notInApp"), { status: 404 });
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

  // Lagerantallet, som Shopify står med lige nu (kun læsning).
  const sync = shopifySync(admin.graphql, session.shop);
  const shopifyAvailable = await Promise.all(
    plans.map((plan) =>
      sync.readAvailable(plan.variantId, plan.locationId).catch(() => null),
    ),
  );

  const formatSyncTime = (date: Date | null) =>
    date ? formatDateTime(locale, date, timeZone) : null;

  return {
    today: todayInTimeZone(timeZone),
    themeBlockUrl: themeBlockUrl(process.env.SHOPIFY_API_KEY ?? ""),
    product: {
      title: product?.title ?? translate(locale, "product.goneInShopify"),
      imageUrl: product?.imageUrl ?? null,
      mode: productMode(plans, product?.variants.length ?? plans.length),
      requiresSellingPlan: product?.requiresSellingPlan ?? false,
    },
    variants: plans.map((plan, index) => {
      const variant = product?.variants.find((v) => v.id === plan.variantId);
      const variantDeliveries = deliveries.filter(
        (d) => d.variantId === plan.variantId,
      );
      const active = variantDeliveries.find((d) => d.state === "ACTIVE");
      return {
        variantId: plan.variantId,
        title: variant?.title ?? translate(locale, "product.variantGone"),
        sku: variant?.sku ?? null,
        enabled: plan.preorderEnabled,
        mode: {
          mode: plan.mode as "STOCK" | "PREORDER",
          forced: plan.modeForced,
          changedAt: formatSyncTime(plan.modeChangedAt),
          reason: plan.modeChangeReason
            ? localizeStored(locale, plan.modeChangeReason)
            : null,
        },
        deliveries: variantDeliveries,
        sync: {
          activeDelivery: active
            ? { position: active.position, date: active.date }
            : null,
          shopifyAvailable: shopifyAvailable[index],
          lastSyncedAt: formatSyncTime(plan.lastSyncedAt),
          lastSyncError: plan.lastSyncError
            ? localizeStored(locale, plan.lastSyncError)
            : null,
          lastSyncAttemptAt: formatSyncTime(plan.lastSyncAttemptAt),
        },
      };
    }),
  };
};

/**
 * Produktets tilstand:
 * - ALL: alle varianter er på forudbestilling → Shopify kræver en plan, og
 *   «Engangskøb» vises ikke.
 * - MIXED: kun nogle → Shopify kan ikke kræve plan for hele produktet.
 * - NONE: ingen er slået til.
 */
function productMode(
  plans: { preorderEnabled: boolean; mode: string }[],
  shopifyVariantCount: number,
): "ALL" | "MIXED" | "NONE" {
  // Kun varianter, der er i forudbestillingsmode nu, tæller.
  const enabled = plans.filter(
    (p) => p.preorderEnabled && p.mode === "PREORDER",
  ).length;
  if (enabled === 0) return "NONE";
  return enabled >= shopifyVariantCount ? "ALL" : "MIXED";
}

type ActionResult =
  | { ok: true; message: string; syncFailed?: boolean }
  | { ok: false; message?: string; fieldErrors?: DeliveryErrors };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);
  const locale = await localeFor(request, session.shop);
  const t = (key: MessageKey) => translate(locale, key);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const today = () =>
    fetchShopTimeZone(admin.graphql).then((tz) => todayInTimeZone(tz));
  const sync = shopifySync(admin.graphql, session.shop);

  // Efter hver ændring bringes Shopify i trit med appen. Fejler det, gemmes
  // fejlen på varianten og vises der; ændringen i appen står ved magt.
  async function done(
    variantId: string,
    message: string,
  ): Promise<ActionResult> {
    const result = await sync.sync(variantId);
    // Hændelser, ændringen har givet (fx «forsinket»), sendes med det samme.
    scheduleQueue(session.shop);
    if (result.ok) return { ok: true, message };
    // Ændringen er gemt i appen; kun Shopify mangler. Fejlen står fast ved
    // varianten, indtil en synkronisering lykkes.
    return {
      ok: true,
      syncFailed: true,
      message: translate(locale, "product.syncFailedSuffix", { message }),
    };
  }

  try {
    switch (intent) {
      case "toggle": {
        const variantId = String(form.get("variantId"));
        const enabled = form.get("enabled") === "true";
        await data.variantPlans.setEnabled(variantId, enabled);
        return done(
          variantId,
          enabled ? t("product.toast.enabled") : t("product.toast.disabled"),
        );
      }
      case "create": {
        const variantId = String(form.get("variantId"));
        await data.deliveries.create(
          variantId,
          { date: form.get("date"), quantity: form.get("quantity") },
          await today(),
          locale,
        );
        return done(variantId, t("product.toast.created"));
      }
      case "update": {
        const { variantId } = await data.deliveries.update(
          String(form.get("deliveryId")),
          { date: form.get("date"), quantity: form.get("quantity") },
          await today(),
          locale,
        );
        return done(variantId, t("product.toast.saved"));
      }
      case "delete": {
        const { variantId } = await data.deliveries.remove(
          String(form.get("deliveryId")),
        );
        return done(variantId, t("product.toast.deleted"));
      }
      case "cancel": {
        const { variantId } = await data.deliveries.cancel(
          String(form.get("deliveryId")),
        );
        return done(variantId, t("product.toast.cancelled"));
      }
      case "force": {
        const variantId = String(form.get("variantId"));
        const forced = form.get("forced") === "true";
        await data.variantPlans.setForced(variantId, forced);
        return done(
          variantId,
          forced ? t("product.toast.forced") : t("product.toast.unforced"),
        );
      }
      case "sync": {
        const variantId = String(form.get("variantId"));
        if (!(await data.syncState.getVariant(variantId))) {
          return { ok: false, message: t("product.variantNotInApp") };
        }
        return done(variantId, t("product.toast.synced"));
      }
      default:
        return { ok: false, message: t("common.unknownAction") };
    }
  } catch (error) {
    if (error instanceof DeliveryValidationError) {
      return { ok: false, fieldErrors: error.errors };
    }
    if (error instanceof PreorderActionError) {
      return { ok: false, message: localizeStored(locale, error.message) };
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Visning
// ---------------------------------------------------------------------------

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type VariantData = LoaderData["variants"][number];

/** Viser en toast, når en handling lykkes. */
function useSuccessToast(result: ActionResult | undefined) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (result?.ok) {
      shopify.toast.show(result.message, { isError: result.syncFailed });
    }
  }, [result, shopify]);
}

export default function ProductPage() {
  const { product, variants, today, themeBlockUrl } =
    useLoaderData<typeof loader>();
  const block = useBlockStatus();
  const { t } = useT();
  const anyEnabled = variants.some((v) => v.enabled);

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.products")}
      </s-link>
      <ThemeBlockBanner
        status={block}
        url={themeBlockUrl}
        preorderOn={anyEnabled}
      />
      {!anyEnabled && <PreorderLimitations />}
      <ProductModeBanner
        mode={product.mode}
        requiresSellingPlan={product.requiresSellingPlan}
      />
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

/**
 * Det, der ikke virker sammen med udskudt betaling på forudbestillinger
 * (Shopifys egne begrænsninger). Står der, hvor butikken opretter sin første
 * forudbestilling — ikke på en hjælpeside.
 */
function PreorderLimitations() {
  const { t } = useT();
  const items: MessageKey[] = [
    "product.limits.gateways",
    "product.limits.localMethods",
    "product.limits.channels",
    "product.limits.discounts",
    "product.limits.permalinks",
    "product.limits.declined",
  ];
  return (
    <s-banner tone="info" heading={t("product.limits.heading")}>
      <s-stack gap="small-200">
        <s-paragraph>{t("product.limits.intro")}</s-paragraph>
        <s-unordered-list>
          {items.map((key) => (
            <s-list-item key={key}>{t(key)}</s-list-item>
          ))}
        </s-unordered-list>
      </s-stack>
    </s-banner>
  );
}

function ProductModeBanner({
  mode,
  requiresSellingPlan,
}: {
  mode: "ALL" | "MIXED" | "NONE";
  requiresSellingPlan: boolean;
}) {
  const { t } = useT();
  if (mode === "NONE") return null;
  if (mode === "ALL") {
    return (
      <s-banner
        tone={requiresSellingPlan ? "success" : "warning"}
        heading={t("product.modeAll.heading")}
      >
        <s-paragraph>{t("product.modeAll.text")}</s-paragraph>
        {!requiresSellingPlan && (
          <s-paragraph>{t("product.modeAll.notSynced")}</s-paragraph>
        )}
      </s-banner>
    );
  }
  return (
    <s-banner tone="info" heading={t("product.modeMixed.heading")}>
      <s-paragraph>{t("product.modeMixed.text1")}</s-paragraph>
      <s-paragraph>{t("product.modeMixed.text2")}</s-paragraph>
    </s-banner>
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
  const { t } = useT();
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
    : t("product.deliveries");

  return (
    <s-section heading={heading}>
      <s-stack gap="base">
        <s-switch
          label={t("product.toggle.label")}
          details={t("product.toggle.details")}
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
        {(enabled || variant.sync.lastSyncError) && (
          <SyncStatus variantId={variant.variantId} sync={variant.sync} />
        )}
        {enabled && (
          <ModeStatus variantId={variant.variantId} mode={variant.mode} />
        )}
        {enabled && !hasActive && variant.mode.mode === "PREORDER" && (
          <s-banner tone="warning">{t("product.noActive")}</s-banner>
        )}

        {variant.deliveries.length === 0 && (
          <s-paragraph>{t("product.noDeliveries")}</s-paragraph>
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
            heading={t("product.editDelivery", { position: editing.position })}
            intent="update"
            target={{ deliveryId: editing.id }}
            initial={{ date: editing.date, quantity: String(editing.quantity) }}
            minimum={editing.allocated}
            today={today}
            submitLabel={t("product.save")}
            onDone={() => setEditingId(null)}
          />
        ) : (
          <DeliveryForm
            heading={t("product.newDelivery")}
            intent="create"
            target={{ variantId: variant.variantId }}
            initial={{ date: "", quantity: "" }}
            minimum={0}
            today={today}
            submitLabel={t("product.addDelivery")}
          />
        )}
      </s-stack>
    </s-section>
  );
}

function ModeStatus({
  variantId,
  mode,
}: {
  variantId: string;
  mode: VariantData["mode"];
}) {
  const fetcher = useFetcher<typeof action>();
  useSuccessToast(fetcher.data);
  const { t } = useT();
  const forced =
    fetcher.formData != null
      ? fetcher.formData.get("forced") === "true"
      : mode.forced;

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text type="strong">{t("product.mode.now")}</s-text>
          {mode.mode === "STOCK" ? (
            <s-badge>{t("product.mode.stock")}</s-badge>
          ) : mode.forced ? (
            <s-badge tone="warning">{t("product.mode.forced")}</s-badge>
          ) : (
            <s-badge tone="success">{t("product.mode.auto")}</s-badge>
          )}
        </s-stack>
        <s-paragraph>
          {mode.mode === "STOCK"
            ? t("product.mode.stockText")
            : mode.forced
              ? t("product.mode.forcedText")
              : t("product.mode.autoText")}
        </s-paragraph>
        <s-text color="subdued">
          {mode.changedAt
            ? t("product.mode.lastChanged", {
                date: mode.changedAt,
                reason: mode.reason ?? "",
              })
            : t("product.mode.neverChanged")}
        </s-text>
        <s-checkbox
          label={t("product.force.label")}
          details={t("product.force.details")}
          checked={forced}
          onChange={() =>
            fetcher.submit(
              { intent: "force", variantId, forced: String(!forced) },
              { method: "POST" },
            )
          }
        />
      </s-stack>
    </s-box>
  );
}

function SyncStatus({
  variantId,
  sync,
}: {
  variantId: string;
  sync: VariantData["sync"];
}) {
  const fetcher = useFetcher<typeof action>();
  useSuccessToast(fetcher.data);
  const { t, date } = useT();
  const busy = fetcher.state !== "idle";
  const syncNow = () =>
    fetcher.submit({ intent: "sync", variantId }, { method: "POST" });

  return (
    <s-stack gap="base">
      {sync.lastSyncError && (
        <s-banner tone="critical" heading={t("product.sync.errorHeading")}>
          <s-paragraph>{sync.lastSyncError}</s-paragraph>
          {sync.lastSyncAttemptAt && (
            <s-paragraph>
              {t("product.sync.lastAttempt", { date: sync.lastSyncAttemptAt })}
            </s-paragraph>
          )}
          <s-button
            slot="secondary-actions"
            onClick={syncNow}
            {...(busy ? { loading: true } : {})}
          >
            {t("product.sync.retry")}
          </s-button>
        </s-banner>
      )}
      <s-grid
        gridTemplateColumns="1fr 1fr 1fr auto"
        gap="base"
        alignItems="center"
      >
        <s-stack gap="small-500">
          <s-text color="subdued">{t("product.sync.active")}</s-text>
          <s-text>
            {sync.activeDelivery
              ? t("product.sync.activeValue", {
                  position: sync.activeDelivery.position,
                  date: date(sync.activeDelivery.date),
                })
              : t("common.none")}
          </s-text>
        </s-stack>
        <s-stack gap="small-500">
          <s-text color="subdued">{t("product.sync.stock")}</s-text>
          <s-text>
            {sync.shopifyAvailable == null
              ? t("product.sync.unknown")
              : t("common.units", { count: sync.shopifyAvailable })}
          </s-text>
        </s-stack>
        <s-stack gap="small-500">
          <s-text color="subdued">{t("product.sync.last")}</s-text>
          <s-text>{sync.lastSyncedAt ?? t("product.sync.never")}</s-text>
        </s-stack>
        <s-button onClick={syncNow} {...(busy ? { loading: true } : {})}>
          {t("product.sync.button")}
        </s-button>
      </s-grid>
    </s-stack>
  );
}

const STATE_TONES: Record<
  DeliveryView["state"],
  "success" | "neutral" | "warning" | "critical"
> = {
  ACTIVE: "success",
  UPCOMING: "neutral",
  SOLD_OUT: "warning",
  CANCELLED: "critical",
};

function DeliveryTable({
  deliveries,
  onEdit,
}: {
  deliveries: DeliveryView[];
  onEdit: (id: string) => void;
}) {
  const { t } = useT();
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header>{t("product.col.position")}</s-table-header>
        <s-table-header listSlot="primary">
          {t("product.col.date")}
        </s-table-header>
        <s-table-header format="numeric">
          {t("product.col.quantity")}
        </s-table-header>
        <s-table-header format="numeric">
          {t("product.col.allocated")}
        </s-table-header>
        <s-table-header format="numeric">
          {t("product.col.remaining")}
        </s-table-header>
        <s-table-header listSlot="secondary">
          {t("product.col.status")}
        </s-table-header>
        <s-table-header>{t("product.col.actions")}</s-table-header>
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
  const { t, tn, date } = useT();
  const tone = STATE_TONES[delivery.state];
  const cancelled = delivery.state === "CANCELLED";
  const modalId = `cancel-${delivery.id}`;

  const submit = (intent: "delete" | "cancel") =>
    fetcher.submit({ intent, deliveryId: delivery.id }, { method: "POST" });

  return (
    <s-table-row>
      <s-table-cell>{delivery.position}</s-table-cell>
      <s-table-cell>{date(delivery.date)}</s-table-cell>
      <s-table-cell>{delivery.quantity}</s-table-cell>
      <s-table-cell>{delivery.allocated}</s-table-cell>
      <s-table-cell>{cancelled ? "–" : delivery.remaining}</s-table-cell>
      <s-table-cell>
        <s-badge tone={tone}>
          {t(`product.state.${delivery.state}` as MessageKey)}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small">
          {!cancelled && (
            <s-button-group>
              <s-button
                slot="secondary-actions"
                href={`/app/deliveries/${delivery.id}`}
              >
                {t("product.action.orders")}
              </s-button>
              <s-button
                slot="secondary-actions"
                onClick={() => onEdit(delivery.id)}
              >
                {t("product.action.edit")}
              </s-button>
              <s-button
                slot="secondary-actions"
                commandFor={modalId}
                command="--show"
              >
                {t("product.action.cancel")}
              </s-button>
              <s-button
                slot="secondary-actions"
                tone="critical"
                onClick={() => submit("delete")}
                {...(busy ? { loading: true } : {})}
              >
                {t("product.action.delete")}
              </s-button>
            </s-button-group>
          )}

          {fetcher.data && !fetcher.data.ok && fetcher.data.message && (
            <s-banner tone="critical">{fetcher.data.message}</s-banner>
          )}

          {cancelled && delivery.orders.length > 0 && (
            <>
              <AffectedOrders orders={delivery.orders} />
              <s-link href={`/app/deliveries/${delivery.id}`}>
                {t("product.seeDeliveryOrders")}
              </s-link>
            </>
          )}
        </s-stack>

        <s-modal
          id={modalId}
          heading={t("product.cancelModal.heading", {
            position: delivery.position,
          })}
        >
          <s-stack gap="base">
            <s-paragraph>
              {t("product.cancelModal.text", { date: date(delivery.date) })}
            </s-paragraph>
            {delivery.allocationCount > 0 ? (
              <s-paragraph>
                {tn("product.cancelModal.allocated", delivery.allocationCount)}
              </s-paragraph>
            ) : (
              <s-paragraph>{t("product.cancelModal.none")}</s-paragraph>
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
            {t("product.cancelModal.confirm")}
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor={modalId}
            command="--hide"
          >
            {t("product.cancelModal.keep")}
          </s-button>
        </s-modal>
      </s-table-cell>
    </s-table-row>
  );
}

function AffectedOrders({ orders }: { orders: DeliveryView["orders"] }) {
  // Samme ordre kan have flere linjer i leverancen; vis hver ordre én gang.
  const orderIds = [...new Set(orders.map((order) => order.orderId))];
  const { t } = useT();
  return (
    <s-stack gap="small-200">
      <s-text type="strong">{t("product.affected")}</s-text>
      <s-unordered-list>
        {orderIds.map((orderId) => (
          <s-list-item key={orderId}>
            <s-link href={`shopify://admin/orders/${numericId(orderId)}`}>
              {t("product.order", { number: numericId(orderId) })}
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
  const { t } = useT();
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
            label={t("product.form.date")}
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
            label={t("product.form.quantity")}
            value={quantity}
            min={Math.max(1, minimum)}
            step={1}
            details={
              minimum > 0
                ? t("product.form.alreadyAllocated", { count: minimum })
                : undefined
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
          {onDone && (
            <s-button onClick={onDone}>{t("product.form.undo")}</s-button>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
