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

  return {
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
  const { products } = useLoaderData<typeof loader>();
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
                    {product.enabled > 0 ? (
                      <s-badge tone="success">Slået til</s-badge>
                    ) : (
                      <s-badge>Slået fra</s-badge>
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
