import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// PostgreSQL-serveren, testene kører mod. På GitHub starter workflowet en;
// lokalt kan TEST_DATABASE_URL pege på en hvilken som helst tom database.
const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/preaura_test";

/**
 * En rigtig PostgreSQL-database med appens migrationer — i sit eget skema,
 * så testfiler, der kører samtidig, ikke ser hinandens data.
 * Kald setup() i beforeAll, reset() i beforeEach og teardown() i afterAll.
 */
export function createTestDb() {
  const schema = `test_${randomUUID().replace(/-/g, "")}`;
  const url = new URL(BASE_URL);
  url.searchParams.set("schema", schema);
  const client = new PrismaClient({ datasourceUrl: url.toString() });

  return {
    client,
    async setup() {
      await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      const migrations = join(__dirname, "../../prisma/migrations");
      const names = readdirSync(migrations)
        .filter((n) => /^\d/.test(n))
        .sort();
      for (const name of names) {
        const sql = readFileSync(
          join(migrations, name, "migration.sql"),
          "utf8",
        );
        for (const statement of sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)) {
          await client.$executeRawUnsafe(statement);
        }
      }
    },
    async reset() {
      await client.$executeRawUnsafe(
        `TRUNCATE "WebhookEvent", "DataRequest", "Session", "ModeChange", "QueueLock", "SellingPlanRef", "Allocation", "Delivery", "VariantPlan", "ShopSetting"`,
      );
    },
    async teardown() {
      await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await client.$disconnect();
    },
  };
}
