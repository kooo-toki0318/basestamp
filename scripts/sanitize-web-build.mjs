import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const webRoot = resolve(process.cwd());
const workerOutput = resolve(webRoot, "dist", "basestamp_web");
if (!workerOutput.startsWith(webRoot + sep)) {
  throw new Error("Refusing to sanitize outside the web package.");
}

for (const name of [
  ".dev.vars",
  ".env",
  ".env.local",
  ".env.production.local"
]) {
  await rm(resolve(workerOutput, name), { force: true });
}
