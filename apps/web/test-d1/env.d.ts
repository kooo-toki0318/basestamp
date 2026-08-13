/* eslint-disable @typescript-eslint/consistent-type-definitions -- Declaration merging requires an interface. */
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
