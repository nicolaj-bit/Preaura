import { defineConfig } from "vitest/config";

// Egen konfiguration, så testene ikke starter React Router-pluginet fra
// vite.config.ts.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
