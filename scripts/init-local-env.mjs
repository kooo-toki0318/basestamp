import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(path, contents) {
  if (await exists(path)) {
    console.log(`Keeping existing ${path.slice(root.length)}`);
    return;
  }
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(`Created ${path.slice(root.length)}`);
}

const webDirectory = resolve(root, "apps/web");
await writeIfMissing(
  resolve(webDirectory, ".env.local"),
  [
    "# Public browser configuration for local development.",
    "VITE_APP_URL=http://localhost:5173",
    "VITE_BASE_BUILDER_CODE=",
    "VITE_TURNSTILE_SITE_KEY=",
    ""
  ].join("\n")
);

await writeIfMissing(
  resolve(webDirectory, ".dev.vars"),
  [
    "# Local Worker configuration. This file is ignored by Git.",
    "APP_ENV=local",
    "MAINNET_WRITES_ENABLED=false",
    "SPONSOR_ENABLED=false",
    "X402_TESTNET_ENABLED=false",
    "X402_MAINNET_ENABLED=false",
    "SIWE_ALLOWED_DOMAIN=localhost:5173",
    "SIWE_ALLOWED_ORIGIN=http://localhost:5173",
    "SIWE_CHAIN_IDS=84532,8453",
    `SESSION_HASH_SECRET=${randomBytes(32).toString("hex")}`,
    "IP_BUCKET_HMAC_SECRET=",
    "SPONSOR_ID_HMAC_SECRET=",
    "TURNSTILE_SECRET_KEY=",
    "CDP_PAYMASTER_URL=",
    "CDP_PROJECT_ID=",
    "CDP_API_KEY_ID=",
    "CDP_API_KEY_SECRET=",
    ""
  ].join("\n")
);
