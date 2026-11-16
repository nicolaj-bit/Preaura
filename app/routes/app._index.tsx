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
import { dashboardStats, progressPct } from "../lib/dashboard";
import { setupSteps, themeBlockUrl } from "../onboarding/setup";
import { ThemeBlockBanner, useBlockStatus } from "../components/ThemeBlock";
import { SUPPORT_EMAIL } from "../onboarding/support";

// Oversigt over produkter i appen. Produkter vælges med Shopifys egen
// produktvælger. Et produkt står som slået til, hvis mindst én variant er.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);

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
      data.dashboard.overview(),
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
  const dateFormat = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const formatDate = (date: string) =>
    dateFormat.format(new Date(`${date}T12:00:00Z`));
  const deliveries = views
    .filter((view) => view.state !== "CANCELLED")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((view) => {
      const info = variantInfo.get(view.variantId);
      return {
        id: view.id,
        productTitle: info?.product.title ?? "Ukendt produkt",
        variantTitle:
          info && info.variantTitle !== "Default Title"
            ? info.variantTitle
            : null,
        imageUrl: info?.product.imageUrl ?? null,
        date: formatDate(view.date),
        allocated: view.allocated,
        quantity: view.quantity,
        pct: progressPct(view.allocated, view.quantity),
        state: view.state,
      };
    });
  const next = deliveries.find(
    (d) => d.state === "ACTIVE" || d.state === "UPCOMING",
  );
  const stats = dashboardStats(overview.recent, new Date());

  return {
    stats: {
      ...stats,
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
      // Det første produkt — der oprettes den første leverance.
      firstProduct: summaries[0] ? numericId(summaries[0].productId) : null,
      // Åbner temaeditoren med PREAURA-blokken klar til at blive tilføjet.
      themeBlockUrl: themeBlockUrl(process.env.SHOPIFY_API_KEY ?? ""),
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

  if (form.get("intent") === "guide") {
    await forShop(session.shop).settings.setSetupGuideHidden(
      form.get("hidden") === "true",
    );
    return { guide: true };
  }
  if (form.get("intent") !== "addProducts") {
    return { error: "Ukendt handling." };
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
    deliveries,
    setup,
    supportEmail,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const guide = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const block = useBlockStatus();
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
      shopify.toast.show("Produkter tilføjet");
    }
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
    <s-page heading="Forudbestilling">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={selectProducts}
        {...(busy ? { loading: true } : {})}
      >
        Vælg produkter
      </s-button>

      <ThemeBlockBanner
        status={block}
        url={setup.themeBlockUrl}
        preorderOn={setup.hasEnabled}
      />

      {unresolvedOrders > 0 && (
        <s-banner tone="critical" heading="Ordrer uden plads i en leverance">
          <s-paragraph>
            {unresolvedOrders === 1
              ? "1 ordre har"
              : `${unresolvedOrders} ordrer har`}{" "}
            forudbestilte varer, der ikke er plads til i nogen leverance.
          </s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            Se ordrerne
          </s-link>
        </s-banner>
      )}
      {dataRequests > 0 && (
        <s-banner tone="warning" heading="En kunde har bedt om sine data">
          <s-paragraph>
            {dataRequests === 1
              ? "1 dataanmodning venter"
              : `${dataRequests} dataanmodninger venter`}{" "}
            på svar. Kunden har ret til svar inden for 30 dage.
          </s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            Se anmodningen
          </s-link>
        </s-banner>
      )}
      {failedEvents > 0 && (
        <s-banner tone="warning" heading="Ordrer kunne ikke behandles">
          <s-paragraph>
            {failedEvents === 1 ? "1 hændelse" : `${failedEvents} hændelser`}{" "}
            fra Shopify fejlede og venter på, at du prøver igen.
          </s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            Gå til ordrebehandling
          </s-link>
        </s-banner>
      )}

      {withoutPlan7 > 0 && (
        <s-banner tone="info" heading="Forudbestillinger købt uden plan">
          <s-paragraph>
            {withoutPlan7 === 1 ? "1 ordre" : `${withoutPlan7} ordrer`} de
            seneste 7 dage købte en vare på forudbestilling uden at vælge
            forudbestilling. Appen har talt dem med, men det kan betyde, at
            noget i opsætningen er galt.
          </s-paragraph>
          <s-link slot="secondary-actions" href="/app/queue">
            Se ordrerne
          </s-link>
        </s-banner>
      )}

      <SetupGuide
        state={{ ...setup, block }}
        hidden={guideHidden}
        onToggle={toggleGuide}
        onSelectProducts={selectProducts}
        themeBlockUrl={setup.themeBlockUrl}
        firstProduct={setup.firstProduct}
      />

      {!setup.hasProducts && (
        <s-section heading="Produkter">
          <s-stack gap="base">
            <s-paragraph>
              Du har ikke valgt nogen produkter endnu. Vælg de produkter, der
              skal kunne forudbestilles, når de er udsolgt — fx en vare, du
              venter en ny forsendelse af. Produkterne bliver solgt almindeligt
              fra lageret, indtil lageret rammer 0.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={selectProducts}>
                Vælg produkter
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {setup.hasProducts && (
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
          gap="base"
        >
          <StatCard
            label="Forudbestillinger (30 dage)"
            value={String(stats.orders30)}
            trend={stats.ordersTrendPct}
          />
          <StatCard
            label="Forudbestilte stk. (30 dage)"
            value={String(stats.units30)}
          />
          <StatCard
            label="Venter på varer"
            value={`${stats.waitingUnits} stk.`}
            note={
              stats.readyUnits > 0
                ? `${stats.readyUnits} stk. klar til afsendelse`
                : undefined
            }
          />
          <StatCard
            label="Næste leverance"
            value={stats.nextDelivery?.date ?? "Ingen"}
            note={stats.nextDelivery?.product}
          />
        </s-grid>
      )}

      {setup.hasProducts && deliveries.length === 0 && (
        <s-section heading="Leverancer">
          <s-stack gap="base">
            <s-paragraph>
              Ingen leverancer endnu. En leverance er en forsendelse af varer,
              du venter hjem: en forventet dato og et antal. Kunderne
              forudbestiller i den første leverance med ledige pladser og får
              dens dato lovet. Når den er udsolgt, fortsætter salget i den
              næste.
            </s-paragraph>
            {setup.firstProduct && (
              <s-stack direction="inline">
                <s-button href={`/app/products/${setup.firstProduct}`}>
                  Opret den første leverance
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      {deliveries.length > 0 && (
        <s-section heading="Leverancer" padding="base">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Produkt</s-table-header>
              <s-table-header>Dato</s-table-header>
              <s-table-header>Solgt</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
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
                        {d.allocated} af {d.quantity}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {d.state === "ACTIVE" ? (
                      <s-badge tone="success">Aktiv</s-badge>
                    ) : d.state === "SOLD_OUT" ? (
                      <s-badge tone="warning">Udsolgt</s-badge>
                    ) : (
                      <s-badge>Kommende</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {products.length > 0 && (
        <s-section heading="Produkter" padding="base">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Produkt</s-table-header>
              <s-table-header>Varianter med forudbestilling</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
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
                        {product.title ?? "Produktet findes ikke længere"}
                      </s-link>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {product.enabled} af {product.variants}
                  </s-table-cell>
                  <s-table-cell>
                    {product.enabled === 0 ? (
                      <s-badge>Slået fra</s-badge>
                    ) : product.allPreorder ? (
                      <s-badge tone="success">Kun forudbestilling</s-badge>
                    ) : product.inPreorder > 0 ? (
                      <s-badge tone="info">Blandet</s-badge>
                    ) : (
                      <s-badge>Lagermode</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section heading="Brug for hjælp?">
        <s-paragraph>
          Skriv til{" "}
          <s-link href={`mailto:${supportEmail}`}>{supportEmail}</s-link>. Vi
          svarer på hverdage, som regel samme dag. Skriv gerne butikkens navn
          og, hvis det handler om en ordre, ordrenummeret.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

const STEP_TEXT: Record<
  "products" | "delivery" | "enable" | "block",
  { title: string; text: string }
> = {
  products: {
    title: "Vælg de produkter, der skal kunne forudbestilles",
    text: "Fx en vare, du venter en ny forsendelse af. Produkterne sælges som normalt fra lageret, indtil det er tomt.",
  },
  delivery: {
    title: "Opret den første leverance",
    text: "Åbn produktet, og skriv hvornår du forventer at sende varerne, og hvor mange du vil sælge på forudbestilling. Datoen er den, kunderne får lovet.",
  },
  enable: {
    title: "Slå forudbestilling til",
    text: "Slå «Forudbestilling, når lageret er tomt» til på varianten. Appen skifter selv til forudbestilling, når lageret rammer 0. Har varen stadig lager, ser kunderne ingen forudbestilling endnu — vil du se den med det samme, så slå «Tving forudbestilling» til på produktet.",
  },
  block: {
    title: "Vis forudbestillingen på produktsiden",
    text: "Tilføj PREAURA-blokken i dit tema. Knappen åbner temaeditoren med blokken klar — du skal kun trykke Gem.",
  },
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
}: {
  state: Parameters<typeof setupSteps>[0];
  hidden: boolean;
  onToggle: (hidden: boolean) => void;
  onSelectProducts: () => void;
  themeBlockUrl: string;
  firstProduct: string | null;
}) {
  const guide = setupSteps(state);
  const action = (id: keyof typeof STEP_TEXT) => {
    switch (id) {
      case "products":
        return <s-button onClick={onSelectProducts}>Vælg produkter</s-button>;
      case "delivery":
      case "enable":
        return firstProduct ? (
          <s-button href={`/app/products/${firstProduct}`}>
            Åbn produktet
          </s-button>
        ) : null;
      case "block":
        return (
          <s-button href={themeBlockUrl} target="_top">
            Tilføj blokken
          </s-button>
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
              {guide.complete ? "PREAURA er sat op" : "Kom i gang med PREAURA"}
            </s-heading>
            <s-text color="subdued">
              {guide.done} af {guide.total} trin gjort
              {guide.complete
                ? " — dine kunder kan nu forudbestille."
                : state.block === "unknown"
                  ? " (blokken i temaet kan ikke tjekkes herfra)"
                  : ""}
            </s-text>
          </s-stack>
          <s-button variant="tertiary" onClick={() => onToggle(!hidden)}>
            {hidden ? "Vis trin" : "Skjul"}
          </s-button>
        </s-stack>
        {!hidden &&
          guide.steps.map((step, i) => (
            <SetupStep
              key={step.id}
              done={step.done}
              highlighted={step.id === guide.next}
              title={`${i + 1}. ${STEP_TEXT[step.id].title}`}
              text={STEP_TEXT[step.id].text}
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
  label,
  value,
  trend,
  note,
}: {
  label: string;
  value: string;
  trend?: number | null;
  note?: string;
}) {
  return (
    <s-section>
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-heading>{value}</s-heading>
          {trend != null && trend !== 0 && (
            <s-badge tone={trend > 0 ? "success" : "critical"}>
              {trend > 0 ? "↑" : "↓"} {Math.abs(trend)} %
            </s-badge>
          )}
        </s-stack>
        {note && <s-text color="subdued">{note}</s-text>}
      </s-stack>
    </s-section>
  );
}

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
