import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const html = read("apps/web/index.html");
const environment = read("apps/web/.env.production");
const readme = read("README.md");

assert.match(
  html,
  /name="base:app_id" content="6a709d282c28265d676171e1"/u
);
for (const metadata of [
  'rel="canonical"',
  'property="og:image"',
  "/basestamp-social.png",
  "/basestamp-icon.png"
]) {
  assert.ok(html.includes(metadata), `missing HTML metadata: ${metadata}`);
}

for (const setting of [
  "VITE_MAINNET_WRITES_ENABLED=true",
  "VITE_SPONSOR_ENABLED=true",
  "VITE_BASE_BUILDER_CODE=bc_o3k81ayl"
]) {
  assert.ok(environment.includes(setting), `missing release setting: ${setting}`);
}

for (const path of [
  "apps/web/public/basestamp-icon.png",
  "apps/web/public/basestamp-social.png"
]) {
  assert.ok(existsSync(resolve(root, path)), `missing release asset: ${path}`);
}

for (const required of [
  "Live Mainnet app",
  "Base Mainnet Registry"
]) {
  assert.ok(readme.includes(required), `README is missing: ${required}`);
}

for (const retired of [
  "Live Base Sepolia preview",
  "Mainnet writes remain disabled",
  "Base Mainnet recording;"
]) {
  assert.ok(!readme.includes(retired), `retired release copy remains: ${retired}`);
}

console.log("Mainnet Standard Web App runtime metadata are complete.");
