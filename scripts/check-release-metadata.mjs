import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const html = read("apps/web/index.html");
const environment = read("apps/web/.env.production");
const readme = read("README.md");
const submission = read("docs/base-dashboard-submission.md");

assert.match(
  html,
  /name="base:app_id" content="6a709d282c28265d676171e1"/u
);
for (const metadata of [
  'rel="canonical"',
  'property="og:image"',
  "/basestamp-social.png",
  "/basestamp-icon.svg"
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
  "apps/web/public/basestamp-icon.svg",
  "apps/web/public/basestamp-icon-180.png",
  "apps/web/public/basestamp-icon-512.png",
  "apps/web/public/basestamp-social.png",
  "docs/assets/base-dashboard/home-mainnet.png",
  "docs/assets/base-dashboard/create-mainnet.png",
  "docs/assets/base-dashboard/verify.png"
]) {
  assert.ok(existsSync(resolve(root, path)), `missing release asset: ${path}`);
}

for (const required of [
  "Live Mainnet app",
  "Base Mainnet Registry",
  "6a709d282c28265d676171e1",
  "bc_o3k81ayl",
  "docs/base-dashboard-submission.md"
]) {
  assert.ok(readme.includes(required), `README is missing: ${required}`);
}

for (const required of [
  "Base.dev owner checklist",
  "0x70978557cd70183acb30d70104f34ece9d3778a43e9a0c14fc258531e69bef85",
  "0x77e19acfb8136d10e09b93fce9da9d398fce6cd2740f2f48a1f2a43f32aed538"
]) {
  assert.ok(submission.includes(required), `submission record is missing: ${required}`);
}

for (const retired of [
  "Live Base Sepolia preview",
  "Mainnet writes remain disabled",
  "Base Mainnet recording;"
]) {
  assert.ok(!readme.includes(retired), `retired release copy remains: ${retired}`);
}

console.log("Mainnet release metadata and Base.dev assets are complete.");
