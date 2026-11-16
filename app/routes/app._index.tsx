import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { forShop } from "../models/preorder.server";
import { fetchProducts, numericId } from "../lib/shopifyProducts.server";
import { queueFor } from "../models/queue.server";
import { complianceFor } from "../models/compliance.server";
import {
  PERIODS,
  dashboardStats,
  parsePeriod,
  progressPct,
} from "../lib/dashboard";
import { LanguageMenu } from "../components/LanguageMenu";
import {
  CART_EMBED_HANDLE,
  cartEmbedUrl,
  setupSteps,
  themeBlockUrl,
} from "../onboarding/setup";
import { ThemeBlockBanner, useBlockInfo } from "../components/ThemeBlock";
import { SUPPORT_EMAIL } from "../onboarding/support";
import { formatDate, translate, useT, type MessageKey } from "../i18n";
import { localeFor } from "../i18n/locale.server";

// Oversigt over produkter i appen. Produkter vælges med Shopifys egen
// produktvælger. Et produkt står som slået til, hvis mindst én variant er.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);
  const locale = await localeFor(request, session.shop);
  const period = parsePeriod(new URL(request.url).searchParams.get("period"));

  const [summaries, settings] = await Promise.all([
    data.variantPlans.listProducts(),
    data.settings.get(),
  ]);
  const products = await fetchProducts(
    admin.graphql,
    summaries.map((summary) => summary.productId),
  );
  const byId = new Map(products.map((product) => [product.id, product]));

  const [counts, unresolved, withoutPlan7, dataRequests, overview] =
    await Promise.all([
      queueFor(session.shop).countByStatus(),
      data.orders.unresolved(),
      data.orders.countWithoutPlanSince(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      ),
      complianceFor(session.shop).countUnansweredDataRequests(),
      data.dashboard.overview(new Date(), period),
    ]);

  // Leverancer på forsiden: åbne leverancer på varianter med forudbestilling,
  // sorteret efter dato.
  const enabledVariants = overview.plans
    .filter((plan) => plan.preorderEnabled)
    .map((plan) => plan.variantId);
  const allViews = await data.deliveries.listForVariants(
    overview.plans.map((plan) => plan.variantId),
  );
  const enabledSet = new Set(enabledVariants);
  const views = allViews.filter((view) => enabledSet.has(view.variantId));
  const variantInfo = new Map(
    products.flatMap((product) =>
      product.variants.map((variant) => [
        variant.id,
        { product, variantTitle: variant.title },
      ]),
    ),
  );
  const deliveries = views
    .filter((view) => view.state !== "CANCELLED")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((view) => {
      const info = variantInfo.get(view.variantId);
      return {
        id: view.id,
        productTitle:
          info?.product.title ?? translate(locale, "common.unknownProduct"),
        variantTitle:
          info && info.variantTitle !== "Default Title"
            ? info.variantTitle
            : null,
        imageUrl: info?.product.imageUrl ?? null,
        date: formatDate(locale, view.date),
        allocated: view.allocated,
        quantity: view.quantity,
        pct: progressPct(view.allocated, view.quantity),
        state: view.state,
      };
    });
  const next = deliveries.find(
    (d) => d.state === "ACTIVE" || d.state === "UPCOMING",
  );
  const stats = dashboardStats(overview.recent, new Date(), period);

  return {
    period,
    stats: {
      ...stats,
      openPaymentIssues: overview.openPaymentIssues,
      cancellations: overview.cancellations,
      waitlistWaiting: overview.waitlistWaiting,
      waitingUnits: overview.waitingUnits,
      readyUnits: overview.readyUnits,
      nextDelivery: next
        ? { date: next.date, product: next.productTitle }
        : null,
    },
    deliveries: deliveries.slice(0, 10),
    setup: {
      hasProducts: summaries.length > 0,
      hasDelivery: allViews.length > 0,
      hasEnabled: enabledVariants.length > 0,
      hidden: settings.setupGuideHidden,
      blockConfirmed: settings.themeBlockConfirmed,
      cartConfirmed: settings.cartEmbedConfirmed,
      // Det første produkt — der oprettes den første leverance.
      firstProduct: summaries[0] ? numericId(summaries[0].productId) : null,
      // Åbner temaeditoren med PREAURA-blokken klar til at blive tilføjet.
      themeBlockUrl: themeBlockUrl(process.env.SHOPIFY_API_KEY ?? ""),
      // Åbner App-integrationer med kurvens app embed slået til.
      cartEmbedUrl: cartEmbedUrl(process.env.SHOPIFY_API_KEY ?? ""),
    },
    supportEmail: SUPPORT_EMAIL,

    failedEvents: counts.FAILED ?? 0,
    dataRequests,
    withoutPlan7,
    unresolvedOrders: new Set(unresolved.map((row) => row.orderId)).size,
    products: summaries.map((summary) => {
      const product = byId.get(summary.productId);
      return {
        id: summary.productId,
        numericId: numericId(summary.productId),
        title: product?.title ?? null,
        imageUrl: product?.imageUrl ?? null,
        imageAlt: product?.imageAlt ?? "",
        variants: summary.variants,
        enabled: summary.enabled,
        // Alle produktets varianter i Shopify på forudbestilling?
        inPreorder: summary.inPreorder,
        allPreorder:
          summary.inPreorder > 0 &&
          summary.inPreorder >= (product?.variants.length ?? summary.variants),
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "confirmBlock") {
    await forShop(session.shop).settings.setThemeBlockConfirmed(true);
    return { guide: true };
  }
  if (form.get("intent") === "confirmCart") {
    await forShop(session.shop).settings.setCartEmbedConfirmed(true);
    return { guide: true };
  }
  if (form.get("intent") === "guide") {
    await forShop(session.shop).settings.setSetupGuideHidden(
      form.get("hidden") === "true",
    );
    return { guide: true };
  }
  if (form.get("intent") !== "addProducts") {
    return { error: "unknown_action" };
  }

  // Kun produkt-id'er kommer fra browseren. Varianter og lager-id'er hentes
  // selv fra Shopify, så de ikke kan forfalskes.
  const ids = form
    .getAll("productId")
    .map(String)
    .filter((id) => id.startsWith("gid://shopify/Product/"));
  const products = await fetchProducts(admin.graphql, ids);

  await forShop(session.shop).variantPlans.addVariants(
    products.flatMap((product) =>
      product.variants.map((variant) => ({
        productId: product.id,
        variantId: variant.id,
        inventoryItemId: variant.inventoryItemId,
        locationId: variant.locationId,
      })),
    ),
  );
  return { added: products.length };
};

export default function Index() {
  const {
    products,
    failedEvents,
    unresolvedOrders,
    withoutPlan7,
    dataRequests,
    stats,
    period,
    deliveries,
    setup,
    supportEmail,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const guide = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t, tn, money } = useT();
  const blockInfo = useBlockInfo();
  const block = blockInfo.status;
  const confirmBlock = () =>
    guide.submit({ intent: "confirmBlock" }, { method: "POST" });
  const cartInfo = useBlockInfo(CART_EMBED_HANDLE);
  const confirmCart = () =>
    guide.submit({ intent: "confirmCart" }, { method: "POST" });
  // Vis det nye valg med det samme, mens det gemmes.
  const guideHidden =
    guide.formData != null
      ? guide.formData.get("hidden") === "true"
      : setup.hidden;
  const toggleGuide = (hidden: boolean) =>
    guide.submit(
      { intent: "guide", hidden: String(hidden) },
      { method: "POST" },
    );
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "added" in fetcher.data && fetcher.data.added) {
      shopify.toast.show(t("home.productsAdded"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  async function selectProducts() {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "add",
      filter: { variants: false },
    });
    if (!selection || selection.length === 0) return;
    const form = new FormData();
    form.set("intent", "addProducts");
    for (const item of selection) form.append("productId", item.id);
    fetcher.submit(form, { method: "POST" });
  }

  return (
    <s-page heading={t("home.heading")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={selectProducts}
        {...(busy ? { loading: true } : {})}
      >
        {t("home.selectProducts")}
      </s-button>

      <LanguageMenu />

      <ThemeBlockBanner
        status={block}
        url={setup.themeBlockUrl}
        preorderOn={setup.hasEnabled}
      />

      {unresolvedOrders > 0 && (
        <s-banner tone="critical" heading={t("home.unresolved.heading")}>
          <s-paragraph>
            {tn("home.unresolved.text", unresolvedOrders)}
          </s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            {t("home.seeOrders")}
          </s-link>
        </s-banner>
      )}
      {dataRequests > 0 && (
        <s-banner tone="warning" heading={t("home.dataRequests.heading")}>
          <s-paragraph>
            {tn("home.dataRequests.text", dataRequests)}
          </s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            {t("home.dataRequests.link")}
          </s-link>
        </s-banner>
      )}
      {failedEvents > 0 && (
        <s-banner tone="warning" heading={t("home.failed.heading")}>
          <s-paragraph>{tn("home.failed.text", failedEvents)}</s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            {t("home.failed.link")}
          </s-link>
        </s-banner>
      )}

      {withoutPlan7 > 0 && (
        <s-banner tone="info" heading={t("home.withoutPlan.heading")}>
          <s-paragraph>{tn("home.withoutPlan.text", withoutPlan7)}</s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            {t("home.seeOrders")}
          </s-link>
        </s-banner>
      )}

      <SetupGuide
        state={{
          ...setup,
          block,
          blockConfirmed:
            setup.blockConfirmed ||
            guide.formData?.get("intent") === "confirmBlock",
          cart: cartInfo.status,
          cartConfirmed:
            setup.cartConfirmed ||
            guide.formData?.get("intent") === "confirmCart",
        }}
        blockReason={blockInfo.reason}
        onConfirmBlock={confirmBlock}
        cartReason={cartInfo.reason}
        onConfirmCart={confirmCart}
        cartEmbedUrl={setup.cartEmbedUrl}
        hidden={guideHidden}
        onToggle={toggleGuide}
        onSelectProducts={selectProducts}
        themeBlockUrl={setup.themeBlockUrl}
        firstProduct={setup.firstProduct}
      />

      {!setup.hasProducts && (
        <s-section heading={t("home.products.heading")}>
          <s-stack gap="base">
            <s-paragraph>{t("home.products.empty")}</s-paragraph>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={selectProducts}>
                {t("home.selectProducts")}
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {setup.hasProducts && (
        <s-section heading={t("home.overview.heading")}>
          <s-stack gap="base">
            <s-stack
              direction="inline"
              gap="small-200"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text color="subdued">{t("home.overview.intro")}</s-text>
              <s-stack direction="inline" gap="small-300">
                {PERIODS.map((days) => (
                  <s-button
                    key={days}
                    href={`/app?period=${days}`}
                    variant={days === period ? "primary" : "secondary"}
                  >
                    {t("home.period.days", { count: days })}
                  </s-button>
                ))}
              </s-stack>
            </s-stack>
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
              gap="base"
            >
              <StatCard
                icon="money"
                label={t("home.stats.amount")}
                value={
                  stats.amount
                    ? money(stats.amount.value, stats.amount.currency)
                    : "–"
                }
                trend={stats.amountTrendPct}
                note={
                  stats.amount == null
                    ? t("home.stats.amountNone")
                    : stats.amountPartial
                      ? t("home.stats.amountPartial")
                      : undefined
                }
              />
              <StatCard
                icon="order"
                label={t("home.stats.orders")}
                value={String(stats.orders)}
                trend={stats.ordersTrendPct}
              />
              <StatCard
                icon="receipt"
                label={t("home.stats.average")}
                value={
                  stats.averageOrder
                    ? money(
                        stats.averageOrder.value,
                        stats.averageOrder.currency,
                      )
                    : "–"
                }
              />
              <StatCard
                icon="product"
                label={t("home.stats.units")}
                value={t("common.units", { count: stats.units })}
              />
              <StatCard
                icon="delivery"
                label={t("home.stats.waiting")}
                value={t("common.units", { count: stats.waitingUnits })}
                note={
                  stats.readyUnits > 0
                    ? t("home.stats.ready", { count: stats.readyUnits })
                    : undefined
                }
              />
              <StatCard
                icon="calendar"
                label={t("home.stats.next")}
                value={stats.nextDelivery?.date ?? t("common.none")}
                note={stats.nextDelivery?.product}
              />
              <StatCard
                icon="credit-card-cancel"
                label={t("home.stats.paymentIssues")}
                value={String(stats.openPaymentIssues)}
                tone={stats.openPaymentIssues > 0 ? "warning" : undefined}
                href={stats.openPaymentIssues > 0 ? "/app/releases" : undefined}
              />
              <StatCard
                icon="x-circle"
                label={t("home.stats.cancellations")}
                value={String(stats.cancellations)}
                href={stats.cancellations > 0 ? "/app/releases" : undefined}
              />
              <StatCard
                icon="person-list"
                label={t("home.stats.waitlist")}
                value={String(stats.waitlistWaiting)}
                href={stats.waitlistWaiting > 0 ? "/app/waitlist" : undefined}
              />
            </s-grid>
          </s-stack>
        </s-section>
      )}

      {setup.hasProducts && deliveries.length === 0 && (
        <s-section heading={t("home.deliveries.heading")}>
          <s-stack gap="base">
            <s-paragraph>{t("home.deliveries.empty")}</s-paragraph>
            {setup.firstProduct && (
              <s-stack direction="inline">
                <s-button href={`/app/products/${setup.firstProduct}`}>
                  {t("home.deliveries.createFirst")}
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      {deliveries.length > 0 && (
        <s-section heading={t("home.deliveries.heading")} padding="base">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("home.col.product")}
              </s-table-header>
              <s-table-header>{t("home.col.date")}</s-table-header>
              <s-table-header>{t("home.col.sold")}</s-table-header>
              <s-table-header listSlot="secondary">
                {t("home.col.status")}
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {deliveries.map((d) => (
                <s-table-row key={d.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-thumbnail
                        src={d.imageUrl ?? undefined}
                        alt=""
                        size="small"
                      />
                      <s-stack gap="none">
                        <s-link href={`/app/deliveries/${d.id}`}>
                          {d.productTitle}
                        </s-link>
                        {d.variantTitle && (
                          <s-text color="subdued">{d.variantTitle}</s-text>
                        )}
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{d.date}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <ProgressBar pct={d.pct} />
                      <s-text>
                        {t("common.of", {
                          done: d.allocated,
                          total: d.quantity,
                        })}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {d.state === "ACTIVE" ? (
                      <s-badge tone="success">{t("home.state.active")}</s-badge>
                    ) : d.state === "SOLD_OUT" ? (
                      <s-badge tone="warning">
                        {t("home.state.soldOut")}
                      </s-badge>
                    ) : (
                      <s-badge>{t("home.state.upcoming")}</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {products.length > 0 && (
        <s-section heading={t("home.products.heading")} padding="base">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("home.col.product")}
              </s-table-header>
              <s-table-header>{t("home.col.variantsOn")}</s-table-header>
              <s-table-header listSlot="secondary">
                {t("home.col.status")}
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <s-table-row key={product.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-thumbnail
                        src={product.imageUrl ?? undefined}
                        alt={product.imageAlt}
                        size="small"
                      />
                      <s-link href={`/app/products/${product.numericId}`}>
                        {product.title ?? t("home.productGone")}
                      </s-link>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {t("common.of", {
                      done: product.enabled,
                      total: product.variants,
                    })}
                  </s-table-cell>
                  <s-table-cell>
                    {product.enabled === 0 ? (
                      <s-badge>{t("home.badge.off")}</s-badge>
                    ) : product.allPreorder ? (
                      <s-badge tone="success">
                        {t("home.badge.onlyPreorder")}
                      </s-badge>
                    ) : product.inPreorder > 0 ? (
                      <s-badge tone="info">{t("home.badge.mixed")}</s-badge>
                    ) : (
                      <s-badge>{t("home.badge.stock")}</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section heading={t("home.help.heading")}>
        <s-paragraph>
          {t("home.help.writeTo")}{" "}
          <s-link href={`mailto:${supportEmail}`}>{supportEmail}</s-link>.{" "}
          {t("home.help.text")}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

const STEP_TEXT: Record<
  "products" | "delivery" | "enable" | "block" | "cart",
  { title: MessageKey; text: MessageKey }
> = {
  products: { title: "guide.products.title", text: "guide.products.text" },
  delivery: { title: "guide.delivery.title", text: "guide.delivery.text" },
  enable: { title: "guide.enable.title", text: "guide.enable.text" },
  block: { title: "guide.block.title", text: "guide.block.text" },
  cart: { title: "guide.cart.title", text: "guide.cart.text" },
};

/**
 * Opsætningsguiden: få trin, der kan foldes sammen og åbnes igen. Den
 * spærrer ikke for noget — alt i appen kan bruges, uanset hvor langt
 * butikken er.
 */
function SetupGuide({
  state,
  hidden,
  onToggle,
  onSelectProducts,
  themeBlockUrl,
  firstProduct,
  blockReason,
  onConfirmBlock,
  cartReason,
  onConfirmCart,
  cartEmbedUrl,
}: {
  state: Parameters<typeof setupSteps>[0];
  blockReason: string | null;
  onConfirmBlock: () => void;
  cartReason: string | null;
  onConfirmCart: () => void;
  cartEmbedUrl: string;
  hidden: boolean;
  onToggle: (hidden: boolean) => void;
  onSelectProducts: () => void;
  themeBlockUrl: string;
  firstProduct: string | null;
}) {
  const guide = setupSteps(state);
  const { t, stored } = useT();
  const action = (id: keyof typeof STEP_TEXT) => {
    switch (id) {
      case "products":
        return (
          <s-button onClick={onSelectProducts}>
            {t("home.selectProducts")}
          </s-button>
        );
      case "delivery":
      case "enable":
        return firstProduct ? (
          <s-button href={`/app/products/${firstProduct}`}>
            {t("guide.openProduct")}
          </s-button>
        ) : null;
      case "block":
        return (
          <s-stack direction="inline" gap="small-200">
            <s-button href={themeBlockUrl} target="_top">
              {t("guide.addBlock")}
            </s-button>
            {state.block === "unknown" && (
              <s-button variant="tertiary" onClick={onConfirmBlock}>
                {t("guide.confirmBlock")}
              </s-button>
            )}
          </s-stack>
        );
      case "cart":
        return (
          <s-stack direction="inline" gap="small-200">
            <s-button href={cartEmbedUrl} target="_top">
              {t("guide.enableCart")}
            </s-button>
            {(state.cart ?? "unknown") === "unknown" && (
              <s-button variant="tertiary" onClick={onConfirmCart}>
                {t("guide.confirmCart")}
              </s-button>
            )}
          </s-stack>
        );
    }
  };
  return (
    <s-section>
      <s-stack gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-stack gap="small-300">
            <s-heading>
              {guide.complete ? t("guide.headingDone") : t("guide.heading")}
            </s-heading>
            <s-text color="subdued">
              {t("guide.progress", { done: guide.done, total: guide.total })}
              {guide.complete ? t("guide.progressDone") : ""}
            </s-text>
          </s-stack>
          <s-button variant="tertiary" onClick={() => onToggle(!hidden)}>
            {hidden ? t("guide.show") : t("guide.hide")}
          </s-button>
        </s-stack>
        {!hidden &&
          guide.steps.map((step, i) => (
            <SetupStep
              key={step.id}
              done={step.done}
              highlighted={step.id === guide.next}
              title={`${i + 1}. ${t(STEP_TEXT[step.id].title)}`}
              text={
                step.id === "block" && state.block === "unknown" && !step.done
                  ? `${t("guide.block.text")} ${t("guide.block.unknown", {
                      reason: blockReason ? ` (${stored(blockReason)})` : "",
                    })}`
                  : step.id === "cart" &&
                      (state.cart ?? "unknown") === "unknown" &&
                      !step.done
                    ? `${t("guide.cart.text")} ${t("guide.cart.unknown", {
                        reason: cartReason ? ` (${stored(cartReason)})` : "",
                      })}`
                    : t(STEP_TEXT[step.id].text)
              }
            >
              {action(step.id)}
            </SetupStep>
          ))}
      </s-stack>
    </s-section>
  );
}

function SetupStep({
  done,
  highlighted = false,
  title,
  text,
  children,
}: {
  done: boolean;
  highlighted?: boolean;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <s-box
      padding="base"
      borderWidth={highlighted ? "large" : "base"}
      borderRadius="base"
    >
      <s-stack
        direction="inline"
        gap="base"
        alignItems="center"
        justifyContent="space-between"
      >
        <s-stack gap="small-300">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type={done ? "check-circle-filled" : "circle-dashed"} />
            <s-text type="strong">{title}</s-text>
          </s-stack>
          <s-text color="subdued">{text}</s-text>
        </s-stack>
        {!done && children}
      </s-stack>
    </s-box>
  );
}

function StatCard({
  icon,
  label,
  value,
  trend,
  note,
  tone,
  href,
}: {
  icon: IconType;
  label: string;
  value: string;
  trend?: number | null;
  note?: string;
  tone?: "warning";
  href?: string;
}) {
  const { t } = useT();
  return (
    <s-box
      padding="base"
      border="base"
      borderRadius="base"
      background={tone === "warning" ? "subdued" : "base"}
    >
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={icon} tone={tone ?? "neutral"} size="small" />
          <s-text color="subdued">{label}</s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-heading>{value}</s-heading>
          {trend != null && trend !== 0 && (
            <s-badge tone={trend > 0 ? "success" : "critical"}>
              {trend > 0 ? "↑" : "↓"} {Math.abs(trend)} %
            </s-badge>
          )}
        </s-stack>
        {note && <s-text color="subdued">{note}</s-text>}
        {href && <s-link href={href}>{t("home.stats.see")}</s-link>}
      </s-stack>
    </s-box>
  );
}

type IconType = HTMLElementTagNameMap["s-icon"]["type"];

/** Fremdriftslinje: hvor stor en del af leverancen der er solgt. */
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        width: 120,
        height: 8,
        borderRadius: 4,
        background: "#e3e3e3",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: pct >= 100 ? "#e0b600" : "#4a9ff5",
        }}
      />
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
