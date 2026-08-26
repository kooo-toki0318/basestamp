import { coreApp } from "./app";
import { runCoreCleanupSafely } from "./cleanup";
import { handleConnectedSponsorGrant } from "./connected-sponsor-grant";

export default {
  fetch(request, env, context) {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.pathname === "/api/sponsor/connected-grant"
    ) {
      return handleConnectedSponsorGrant(request, env);
    }
    return coreApp.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    context.waitUntil(runCoreCleanupSafely(env.DB));
  }
} satisfies ExportedHandler<Env>;
