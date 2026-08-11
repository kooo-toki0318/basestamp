import { coreApp } from "./app";
import { runCoreCleanup } from "./cleanup";

export default {
  fetch(request, env, context) {
    return coreApp.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    context.waitUntil(runCoreCleanup(env.DB));
  }
} satisfies ExportedHandler<Env>;
