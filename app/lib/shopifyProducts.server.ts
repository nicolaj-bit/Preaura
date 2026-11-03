// Læsning fra Shopify. Kun queries — appen skriver intet til Shopify i denne
// omgang.

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  inventoryItemId: string;
  /** Første lager, varen ligger på. Null, hvis den ikke ligger på noget. */
  locationId: string | null;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  /** Kan produktet kun købes med en selling plan? */
  requiresSellingPlan: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  variants: ShopifyVariant[];
};

const PRODUCTS_QUERY = `#graphql
  query PreauraProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        requiresSellingPlan
        featuredMedia {
          preview {
            image {
              url
              altText
            }
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            inventoryItem {
              id
              inventoryLevels(first: 1) {
                nodes {
                  location {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

type ProductNode = {
  id: string;
  title: string;
  requiresSellingPlan: boolean;
  featuredMedia: {
    preview: { image: { url: string; altText: string | null } | null } | null;
  } | null;
  variants: {
    nodes: {
      id: string;
      title: string;
      sku: string | null;
      inventoryItem: {
        id: string;
        inventoryLevels: { nodes: { location: { id: string } }[] };
      };
    }[];
  };
};

/** Henter produkter med varianter. Ukendte eller slettede id'er udelades. */
export async function fetchProducts(
  graphql: AdminGraphql,
  ids: string[],
): Promise<ShopifyProduct[]> {
  if (ids.length === 0) return [];
  const products: ShopifyProduct[] = [];

  // nodes() tager højst 250 id'er ad gangen.
  for (let i = 0; i < ids.length; i += 250) {
    const response = await graphql(PRODUCTS_QUERY, {
      variables: { ids: ids.slice(i, i + 250) },
    });
    const json = (await response.json()) as {
      data?: { nodes: (ProductNode | null)[] };
    };
    for (const node of json.data?.nodes ?? []) {
      if (!node?.id) continue;
      const image = node.featuredMedia?.preview?.image ?? null;
      products.push({
        id: node.id,
        title: node.title,
        requiresSellingPlan: node.requiresSellingPlan,
        imageUrl: image?.url ?? null,
        imageAlt: image?.altText ?? null,
        variants: node.variants.nodes.map((variant) => ({
          id: variant.id,
          title: variant.title,
          sku: variant.sku,
          inventoryItemId: variant.inventoryItem.id,
          locationId:
            variant.inventoryItem.inventoryLevels.nodes[0]?.location.id ?? null,
        })),
      });
    }
  }
  return products;
}

/** Butikkens tidszone, fx "Europe/Copenhagen". Bruges til "i dag". */
export async function fetchShopTimeZone(graphql: AdminGraphql) {
  const response = await graphql(`
    #graphql
    query PreauraShopTimeZone {
      shop {
        ianaTimezone
      }
    }
  `);
  const json = (await response.json()) as {
    data?: { shop: { ianaTimezone: string } };
  };
  const timeZone = json.data?.shop.ianaTimezone;
  // Ingen stille fallback: med en forkert tidszone kunne "i dag" være forkert.
  if (!timeZone) throw new Error("Kunne ikke hente butikkens tidszone.");
  return timeZone;
}

export { numericId } from "./ids";
