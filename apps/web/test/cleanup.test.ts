import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCleanupHealth,
  runCoreCleanup,
  runCoreCleanupSafely
} from "../worker/cleanup";

type CapturedStatement = {
  bindings: unknown[];
  sql: string;
};

function createCleanupDatabase() {
  const captured: CapturedStatement[] = [];
  let batched: unknown[] = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          const statement = { bindings, sql };
          captured.push(statement);
          return statement;
        }
      };
    },
    batch(statements: unknown[]) {
      batched = statements;
      return Promise.resolve([]);
    }
  } as unknown as D1Database;
  return { captured, database, getBatched: () => batched };
}

function createHealthDatabase(updatedAt: number | undefined): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            first() {
              return Promise.resolve(
                updatedAt === undefined ? null : { updated_at: updatedAt }
              );
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

describe("Core D1 cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs all retention operations in one atomic D1 batch with fixed cutoffs", async () => {
    const now = 1_800_000_000;
    const fixture = createCleanupDatabase();
    await runCoreCleanup(fixture.database, now);

    expect(fixture.captured).toHaveLength(14);
    expect(fixture.getBatched()).toHaveLength(14);
    expect(fixture.captured[0]?.sql).toContain("rate_limit_buckets");
    expect(fixture.captured[1]?.sql).toContain("sponsor:global:day:");
    expect(fixture.captured[2]?.sql).toContain("sponsor:wallet:month:");
    expect(fixture.captured[3]).toMatchObject({
      bindings: [now - 300]
    });
    expect(fixture.captured[3]?.sql).toContain("status = 'requested'");
    expect(fixture.captured[4]?.sql).toContain("status = 'expired'");
    expect(fixture.captured[5]).toMatchObject({
      bindings: [now - 30 * 86_400]
    });
    expect(fixture.captured[6]).toMatchObject({
      bindings: [now - 2 * 86_400]
    });
    expect(fixture.captured[8]).toMatchObject({
      bindings: [now - 7 * 86_400]
    });
    expect(fixture.captured[10]).toMatchObject({ bindings: [now] });
    expect(fixture.captured[11]?.sql).toContain("+62 days");
    expect(fixture.captured[12]?.sql).toContain("sponsor_wallet_allowlist");
    expect(fixture.captured[13]).toMatchObject({
      bindings: ["system:cleanup:last_success", now, now]
    });
  });

  it("reports a recent cleanup as healthy", async () => {
    const now = 1_800_000_000;
    await expect(
      readCleanupHealth(createHealthDatabase(now - 3_599), now)
    ).resolves.toEqual({
      healthy: true,
      lastSuccessAt: new Date((now - 3_599) * 1_000)
        .toISOString()
        .replace(".000Z", "Z")
    });
  });

  it.each([
    ["missing", undefined],
    ["stale", 1_800_000_000 - 7_200],
    ["future", 1_800_000_000 + 61]
  ])("reports %s cleanup state as unhealthy", async (_label, updatedAt) => {
    const health = await readCleanupHealth(
      createHealthDatabase(updatedAt),
      1_800_000_000
    );
    expect(health.healthy).toBe(false);
  });

  it("contains scheduled failures and logs no exception details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      runCoreCleanupSafely(
        {} as D1Database,
        () => Promise.reject(new Error("sensitive cleanup detail"))
      )
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "cleanup_failed" })
    );
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain(
      "sensitive cleanup detail"
    );
  });
});
