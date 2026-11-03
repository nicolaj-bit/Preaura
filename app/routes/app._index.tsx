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

// Oversigt over produkter i appen. Produkter vælges med Shopifys egen
// produktvælger. Et produkt står som slået til, hvis mindst én variant er.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = forShop(session.shop);

  const summaries = await data.variantPlans.listProducts();
  const products = await fetchProducts(
    admin.graphql,
    summaries.map((summary) => summary.productId),
  );
  const byId = new Map(products.map((product) => [product.id, product]));

  const [counts, unresolved, withoutPlan7] = await Promise.all([
    queueFor(session.shop).countByStatus(),
    data.orders.unresolved(),
    data.orders.countWithoutPlanSince(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    ),
  ]);

  return {
    failedEvents: counts.FAILED ?? 0,
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
        allPreorder:
          summary.enabled > 0 &&
          summary.enabled >= (product?.variants.length ?? summary.variants),
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

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
  const { products, failedEvents, unresolvedOrders, withoutPlan7 } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
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

      {products.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center">
            <s-heading>Ingen produkter endnu</s-heading>
            <s-paragraph>
              Vælg de produkter, der skal kunne forudbestilles. Bagefter slår du
              forudbestilling til pr. variant og opretter leverancer.
            </s-paragraph>
            <s-button onClick={selectProducts}>Vælg produkter</s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
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
                    ) : (
                      <s-badge tone="info">Blandet</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
