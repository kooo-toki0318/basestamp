import { coreApp } from "./app";
import { runCoreCleanupSafely } from "./cleanup";
import { handleConnectedSponsorGrant } from "./connected-sponsor-grant";

type SponsorOriginClass =
  | "base-app"
  | "basestamp-app"
  | "configured"
  | "keys-coinbase"
  | "missing"
  | "other";
type SponsorRpcMethod =
  | "pm_getAcceptedPaymentTokens"
  | "pm_getPaymasterData"
  | "pm_getPaymasterStubData"
  | "other";

function classifySponsorOrigin(request: Request, env: Env): SponsorOriginClass {
  const origin = request.headers.get("Origin");
  if (origin === null) return "missing";
  if (origin === "https://keys.coinbase.com") return "keys-coinbase";
  if (origin === "https://base.app") return "base-app";
  if (origin === env.SIWE_ALLOWED_ORIGIN) return "basestamp-app";

  const allowedOrigins = env.SPONSOR_ALLOWED_ORIGINS
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  return allowedOrigins.includes(origin) ? "configured" : "other";
}

async function classifySponsorRpcMethod(request: Request): Promise<SponsorRpcMethod> {
  if (request.method !== "POST") return "other";
  try {
    const value = await request.clone().json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "other";
    }
    const method: unknown = (value as Record<string, unknown>).method;
    if (
      method === "pm_getAcceptedPaymentTokens" ||
      method === "pm_getPaymasterData" ||
      method === "pm_getPaymasterStubData"
    ) {
      return method;
    }
  } catch {
    // Invalid or unreadable bodies are classified without logging request data.
  }
  return "other";
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.pathname === "/api/sponsor/connected-grant"
    ) {
      return handleConnectedSponsorGrant(request, env);
    }

    if (url.pathname === "/api/sponsor") {
      const originClass = classifySponsorOrigin(request, env);
      const rpcMethod = await classifySponsorRpcMethod(request);
      console.info(JSON.stringify({
        event: "sponsor_proxy_request",
        method: request.method,
        originClass,
        rpcMethod
      }));
      try {
        const response = await coreApp.fetch(request, env, context);
        console.info(JSON.stringify({
          event: "sponsor_proxy_response",
          method: request.method,
          originClass,
          rpcMethod,
          status: response.status
        }));
        return response;
      } catch (error) {
        console.warn(JSON.stringify({
          event: "sponsor_proxy_exception",
          method: request.method,
          originClass,
          rpcMethod
        }));
        throw error;
      }
    }

    return coreApp.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    context.waitUntil(runCoreCleanupSafely(env.DB));
  }
} satisfies ExportedHandler<Env>;
