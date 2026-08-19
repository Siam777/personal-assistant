import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Every auth/entry test performs at least one real Argon2id derivation
    // at the calibrated production cost (config.ts KDF_PARAMS, ~450-500ms
    // measured in isolation). Under the vitest worker pool's parallelism,
    // many concurrent derivations compete for CPU, and the 5000ms default
    // is marginal — observed flaking under load even though every
    // individual test is well-behaved in isolation. Raised rather than
    // lowering KDF cost (which config.ts's own doc comment forbids).
    testTimeout: 20_000,
  },
});
