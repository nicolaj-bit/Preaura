import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * En rigtig SQLite-database i en midlertidig mappe med appens migrationer.
 * Kald setup() i beforeAll, reset() i beforeEach og teardown() i afterAll.
 */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "preaura-test-"));
  const client = new PrismaClient({
    // Én forbindelse: migrationerne slår fremmednøgle-kontrollen fra og til
    // med PRAGMA, som kun gælder den forbindelse, de kører på. Med en pulje
    // af forbindelser kunne en forbindelse ende med kontrollen slået fra.
    datasourceUrl: `file:${join(dir, "test.sqlite")}?connection_limit=1`,
  });

  return {
    client,
    async setup() {
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
      await client.webhookEvent.deleteMany();
      await client.modeChange.deleteMany();
      await client.queueLock.deleteMany();
      await client.sellingPlanRef.deleteMany();
      await client.allocation.deleteMany();
      await client.delivery.deleteMany();
      await client.variantPlan.deleteMany();
      await client.shopSetting.deleteMany();
    },
    async teardown() {
      await client.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
