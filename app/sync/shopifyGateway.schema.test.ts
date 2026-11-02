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
// enum-værdier som PRE_ORDER og NO_REMAINING_BALANCE). Skemaet hentes med
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
});
