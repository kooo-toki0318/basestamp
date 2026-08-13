import { coreApp } from "./app";
import { runCoreCleanupSafely } from "./cleanup";

export default {
  fetch(request, env, context) {
    return coreApp.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    context.waitUntil(runCoreCleanupSafely(env.DB));
  }
} satisfies ExportedHandler<Env>;
