import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations")
  );

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          compatibilityDate: "2026-08-03",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"]
        }
      })
    ],
    test: {
      include: ["test-d1/**/*.test.ts"],
      testTimeout: 30_000
    }
  };
});
