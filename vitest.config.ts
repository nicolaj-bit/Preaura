import { defineConfig } from "vitest/config";

// Egen konfiguration, så testene ikke starter React Router-pluginet fra
// vite.config.ts.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "theme-extension-src/**/*.test.ts"],
    environment: "node",
    // Hver databasetestfil opretter sit eget skema og kører alle migrationer
    // i beforeAll. På en travl GitHub-maskine kan det tage over 10 sekunder
    // (standarden), og så river afterAll skemaet ned midt i opsætningen.
    hookTimeout: 60_000,
  },
});
