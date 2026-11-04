import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildClientSchema,
  parse,
  validate,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from "graphql";
import { getVariableValues } from "graphql/execution/values";
import { beforeAll, describe, expect, it } from "vitest";
import { createShopifyGateway } from "./shopifyGateway.server";
import { desiredPlans } from "./plans";

// Validerer hver forespørgsel og mutation, appen sender til Shopify, mod
// Shopifys rigtige Admin-skema — inklusive variablerne (feltnavne og
// enum-værdier som PRE_ORDER og ON_FULFILLMENT). Skemaet hentes med
// `npm run graphql-codegen`.

const SCHEMA_PATH = join(__dirname, "../types/admin-2026-10.schema.json");

let schema: GraphQLSchema;
beforeAll(() => {
  if (!existsSync(SCHEMA_PATH)) {
    throw new Error(
      "Shopifys skema mangler. Kør `npm run graphql-codegen` først.",
    );
  }
  const json = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  schema = buildClientSchema(json.data ?? json);
});

type Call = { query: string; variables: Record<string, unknown> };

/** Kører en gateway-metode og fanger den forespørgsel, den sender. */
async function capture(
  action: (
    gateway: ReturnType<typeof createShopifyGateway>,
  ) => Promise<unknown>,
): Promise<Call> {
  let call: Call | undefined;
  const gateway = createShopifyGateway(async (query, options) => {
    call = { query, variables: options?.variables ?? {} };
    throw new Error("stop");
  });
  await action(gateway).catch(() => undefined);
  if (!call) throw new Error("Der blev ikke sendt nogen forespørgsel.");
  return call;
}

function expectValid({ query, variables }: Call) {
  const document = parse(query);
  expect(validate(schema, document).map((e) => e.message)).toEqual([]);
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
  )!;
  const coerced = getVariableValues(
    schema,
    operation.variableDefinitions ?? [],
    variables,
  );
  expect(coerced.errors?.map((e) => e.message) ?? []).toEqual([]);
}

const plans = desiredPlans(
  [{ id: "d1", position: 1, date: "2026-12-01", status: "OPEN" }],
  {
    dateMode: "SHIPPING",
    shippingDateText: "Forventet afsendelse: {dato}",
    deliveryDateText: "Forventet levering: {dato}",
  },
);
const VARIANT = "gid://shopify/ProductVariant/1";
const GROUP = "gid://shopify/SellingPlanGroup/1";

describe("forespørgsler mod Shopifys skema", () => {
  it("læsning med og uden gruppe og lager", async () => {
    expectValid(
      await capture((g) =>
        g.read({
          variantId: VARIANT,
          groupId: GROUP,
          locationId: "gid://shopify/Location/1",
        }),
      ),
    );
    expectValid(
      await capture((g) =>
        g.read({ variantId: VARIANT, groupId: null, locationId: null }),
      ),
    );
  });

  it("opret gruppe med planer", async () => {
    expectValid(
      await capture((g) =>
        g.createGroup({ variantId: VARIANT, merchantCode: "x", plans }),
      ),
    );
  });

  it("opret og udfas planer", async () => {
    expectValid(await capture((g) => g.createPlans(GROUP, plans)));
    expectValid(
      await capture((g) =>
        g.deletePlans(GROUP, ["gid://shopify/SellingPlan/1"]),
      ),
    );
  });

  it("gruppe: slet, tilknyt og fjern variant", async () => {
    expectValid(await capture((g) => g.deleteGroup(GROUP)));
    expectValid(await capture((g) => g.addVariant(GROUP, VARIANT)));
    expectValid(await capture((g) => g.removeVariant(GROUP, VARIANT)));
  });

  it("lager: sporing og antal", async () => {
    expectValid(
      await capture((g) =>
        g.enforceInventoryTracking("gid://shopify/Product/1", VARIANT),
      ),
    );
    expectValid(
      await capture((g) =>
        g.setAvailable({
          inventoryItemId: "gid://shopify/InventoryItem/1",
          locationId: "gid://shopify/Location/1",
          quantity: 5,
          changeFrom: 3,
        }),
      ),
    );
  });

  it("ordrer: læsning, metafelter og tags", async () => {
    const ORDER = "gid://shopify/Order/1";
    expectValid(await capture((g) => g.readOrder(ORDER)));
    expectValid(
      await capture((g) =>
        g.setOrderMetafields(ORDER, [
          { key: "promised_date", type: "date", value: "2026-12-01" },
          { key: "allocations", type: "json", value: "[]" },
        ]),
      ),
    );
    expectValid(
      await capture((g) => g.addOrderTags(ORDER, ["Forudbestilling"])),
    );
    expectValid(
      await capture((g) =>
        g.removeOrderTags(ORDER, ["Forudbestilling uafklaret"]),
      ),
    );
  });

  it("udgående hændelser: ordrens detaljer (med og uden kunde) og Flow", async () => {
    const ORDER = "gid://shopify/Order/1";
    expectValid(await capture((g) => g.readOrderDetails(ORDER)));

    // Uden adgang til kundedata spørges der igen uden kunden.
    const calls: Call[] = [];
    const gateway = createShopifyGateway(async (query, options) => {
      calls.push({ query, variables: options?.variables ?? {} });
      return new Response(
        JSON.stringify(
          calls.length === 1
            ? {
                errors: [
                  {
                    message: "Access denied for email field.",
                    extensions: { code: "ACCESS_DENIED" },
                  },
                ],
              }
            : { data: { order: { name: "#1001", lineItems: { nodes: [] } } } },
        ),
      );
    });
    const details = await gateway.readOrderDetails(ORDER);
    expect(details).toEqual({ name: "#1001", customer: null, lines: [] });
    expect(calls).toHaveLength(2);
    expectValid(calls[1]);

    // Shopifys rigtige svar, når appen ikke er godkendt til e-mail (uden
    // fejlkode): hændelsen sendes uden kunde i stedet for at sidde fast.
    let attempt = 0;
    const unapproved = createShopifyGateway(async () => {
      attempt += 1;
      return new Response(
        JSON.stringify(
          attempt === 1
            ? {
                errors: [
                  {
                    message:
                      "This app is not approved to use the email field. See https://shopify.dev/docs/apps/launch/protected-customer-data for more details.",
                  },
                ],
              }
            : { data: { order: { name: "#1003", lineItems: { nodes: [] } } } },
        ),
      );
    });
    expect(await unapproved.readOrderDetails(ORDER)).toEqual({
      name: "#1003",
      customer: null,
      lines: [],
    });

    // Andre fejl giver stadig en fejl, så hændelsen prøves igen.
    const broken = createShopifyGateway(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "Internal error" }] }),
        ),
    );
    await expect(broken.readOrderDetails(ORDER)).rejects.toThrow(
      "Internal error",
    );

    expectValid(
      await capture((g) =>
        g.flowTriggerReceive("preaura-preorder-ready", { order_id: 1 }),
      ),
    );
  });

  it("produkt: krav om selling plan", async () => {
    expectValid(
      await capture((g) =>
        g.setProductRequiresSellingPlan("gid://shopify/Product/1", true),
      ),
    );
  });

  it("variant: metafelt til produktsiden", async () => {
    expectValid(
      await capture((g) =>
        g.setVariantPreorderMetafield(
          "gid://shopify/ProductVariant/1",
          '{"active":false}',
        ),
      ),
    );
  });
});
