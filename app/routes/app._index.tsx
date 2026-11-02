import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// Eneste admin-side indtil videre. Den beviser, at installation, OAuth og
// indlejring i Shopify Admin virker: hentes butikkens navn, er alt på plads.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query PreauraShopName {
        shop {
          name
        }
      }`,
  );
  const { data } = await response.json();

  return { shopName: data?.shop?.name ?? "" };
};

export default function Index() {
  const { shopName } = useLoaderData<typeof loader>();

  return (
    <s-page heading="PREAURA">
      <s-section>
        <s-paragraph>{shopName}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
