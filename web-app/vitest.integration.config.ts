import { defineConfig } from "vitest/config";

// Integração real contra o banco de TESTE (ver src/services/stock.integration.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
