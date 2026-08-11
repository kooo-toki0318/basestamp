import { describe, expect, it } from "vitest";
import { createCoreApp } from "../worker/app";

describe("locale negotiation API", () => {
  it("uses Accept-Language without requiring authentication config", async () => {
    const response = await createCoreApp().request(
      "/api/locale",
      { headers: { "Accept-Language": "en-US;q=0.6, ja-JP;q=0.9" } },
      {}
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ locale: "ja" });
    expect(response.headers.get("content-language")).toBe("ja");
    expect(response.headers.get("vary")).toBe("Accept-Language");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
