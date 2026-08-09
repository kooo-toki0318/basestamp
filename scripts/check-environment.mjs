import {
  constants,
  accessSync,
  existsSync,
  realpathSync,
  readFileSync
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const checks = [
  ["node", ["--version"], /^v24\.18\.0$/],
  ["pnpm", ["--version"], /^11\.4\.0$/],
  ["wrangler", ["--version"], /^4\.118\.0$/],
  ["forge", ["--version"], /Version: 1\.7\.1/],
  ["cast", ["--version"], /Version: 1\.7\.1/],
  ["anvil", ["--version"], /Version: 1\.7\.1/],
  ["chisel", ["--version"], /Version: 1\.7\.1/],
  ["codex", ["--version"], /^codex-cli 0\.146\.0$/]
];

const expectedMounts = new Set([
  "source=basestamp-pnpm-store,target=/home/node/.local/share/pnpm/store,type=volume",
  "source=basestamp-foundry-keystore,target=/home/node/.foundry/keystores,type=volume",
  "source=basestamp-codex-home,target=/home/node/.codex,type=volume"
]);

const ignoredSecretPaths = [
  ".env",
  ".env.local",
  ".dev.vars",
  ".dev.vars.local",
  "development.pem",
  "development.key",
  ".foundry/keystores/local",
  "contracts/broadcast/8453/run-latest.json",
  ".codex/auth.json",
  ".codex/sessions/example.jsonl",
  "basestamp_mvp_codex_brief_v4.md"
];

const prohibitedV4Terms = [
  "clientNonce",
  "acknowledgementNonce",
  "証明JSON",
  "100 MB",
  "RELAYER_PRIVATE_KEY",
  "Node 22",
  "compose.yaml"
];

const prohibitedComposeFiles = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml"
];

const sensitiveKeys = [
  "SESSION_HASH_SECRET",
  "IP_BUCKET_HMAC_SECRET",
  "SPONSOR_ID_HMAC_SECRET",
  "TURNSTILE_SECRET_KEY",
  "CDP_PAYMASTER_URL",
  "CDP_PROJECT_ID",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "PRIVATE_KEY",
  "MNEMONIC",
  "SEED_PHRASE"
];

const sensitiveValue = String.raw`(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s#,'"\[\]{}]+)`;
const versionedHmacKey = String.raw`(?:SESSION_HASH_SECRET|IP_BUCKET_HMAC_SECRET|SPONSOR_ID_HMAC_SECRET)(?:_v[A-Za-z0-9]+)?`;
const otherSensitiveKeys = sensitiveKeys
  .filter((key) => !key.endsWith("_HMAC_SECRET") && key !== "SESSION_HASH_SECRET")
  .join("|");
const sensitiveAssignmentPattern = new RegExp(
  String.raw`["']?(?:${versionedHmacKey}|${otherSensitiveKeys})["']?[ \t]*(?:=|:)[ \t]*${sensitiveValue}`,
  "im"
);

const secretPatterns = [
  ["private-key PEM", /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/],
  [
    "live provider credential",
    /\b(?:sk_(?:live|test)|rk_live|AKIA|ASIA|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}\b/i
  ],
  ["JWT-like credential", /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/],
  ["credential in URL", /https?:\/\/[^\s/:@]+:[^\s/@]+@/i],
  ["non-empty sensitive configuration", sensitiveAssignmentPattern]
];

// Remove only the exact synthetic expressions before scanning their source files.
// Any different assignment to the same keys remains detectable.
const testSessionSecretExpression = `${sensitiveKeys[0]}: "x".repeat(32)`;
const generatedSessionSecretExpression = [
  "`",
  sensitiveKeys[0],
  '=${randomBytes(32).toString("hex")}`'
].join("");
const syntheticSensitiveAssignmentsBySource = new Map([
  ["apps/web/test/app.test.ts", [testSessionSecretExpression]],
  [
    "scripts/init-local-env.mjs",
    [generatedSessionSecretExpression]
  ]
]);

let failed = false;

function ok(message) {
  console.log(`OK   ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failed = true;
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function findSecretLabels(content) {
  return secretPatterns
    .filter(([, pattern]) => pattern.test(content))
    .map(([label]) => label);
}

const syntheticValue = ["synthetic", "scanner", "value"].join("-");
const scannerCases = [
  [`${sensitiveKeys[4]}=${syntheticValue}`, true],
  [JSON.stringify({ [sensitiveKeys[7]]: syntheticValue }), true],
  [`${sensitiveKeys[5]} = '${syntheticValue}'`, true],
  [`${sensitiveKeys[6]}: ${syntheticValue}`, true],
  [`${sensitiveKeys[2]}_v2=${syntheticValue}`, true],
  [`${sensitiveKeys[0]}=`, false],
  [JSON.stringify({ [sensitiveKeys[7]]: "" }), false]
];

if (scannerCases.some(([sample, expected]) => (findSecretLabels(sample).length > 0) !== expected)) {
  fail("secret scanner self-test failed");
} else {
  ok("secret scanner recognizes env, JSON, TOML, and YAML assignments");
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  fail("container must run as a non-root user");
} else {
  ok(`uid=${typeof process.getuid === "function" ? process.getuid() : "unknown"}`);
}

if (existsSync("/var/run/docker.sock")) {
  fail("Docker socket must not be mounted in the development container");
} else {
  ok("Docker socket is not mounted");
}

for (const path of [
  "/home/node/.local/share/pnpm/store",
  "/home/node/.foundry/keystores",
  "/home/node/.codex"
]) {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    ok(`writable ${path}`);
  } catch {
    fail(`not writable ${path}`);
  }
}

for (const [command, args, expected] of checks) {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();

    if (!expected.test(output)) {
      fail(`${command}: unexpected version: ${output}`);
      continue;
    }

    ok(`${command}: ${output.split("\n")[0]}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`${command}: ${detail}`);
  }
}

try {
  const pnpmPath = execFileSync("sh", ["-c", "command -v pnpm"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const outsideWorkspaceVersion = execFileSync("pnpm", ["--version"], {
    cwd: "/tmp",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const loginPnpmPath = execFileSync("bash", ["-lc", "command -v pnpm"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const loginOutsideWorkspaceVersion = execFileSync("bash", ["-lc", "pnpm --version"], {
    cwd: "/tmp",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const packageManager = JSON.parse(readText("package.json")).packageManager;
  const expectedPackageManager =
    "pnpm@11.4.0+sha512.f0febc7e37552ab485494a914241b338e0b3580b93d54ce31f00933015880863129038a1b4ae4e414a0ee63ac35bf21197e990172c4a68256450b5636310968f";
  const allowedPnpmPaths = new Set([
    "/home/node/.local/share/pnpm/pnpm",
    "/usr/local/share/npm-global/bin/pnpm"
  ]);
  const expectedShimTarget = "/usr/local/lib/node_modules/corepack/dist/pnpm.js";

  if (
    !allowedPnpmPaths.has(pnpmPath) ||
    realpathSync(pnpmPath) !== expectedShimTarget ||
    outsideWorkspaceVersion !== "11.4.0" ||
    loginPnpmPath !== "/usr/local/share/npm-global/bin/pnpm" ||
    realpathSync(loginPnpmPath) !== expectedShimTarget ||
    loginOutsideWorkspaceVersion !== "11.4.0" ||
    packageManager !== expectedPackageManager ||
    process.env.COREPACK_ENABLE_NETWORK !== "0" ||
    process.env.COREPACK_DEFAULT_TO_LATEST !== "0"
  ) {
    fail("Corepack/pnpm pin is not authoritative inside and outside the workspace");
  } else {
    ok("Corepack/pnpm 11.4.0 pin is authoritative in normal and login shells");
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`cannot validate authoritative pnpm pin: ${detail}`);
}

try {
  const ignoredBuilds = execFileSync("pnpm", ["ignored-builds"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (!/\bNone\b/.test(ignoredBuilds)) {
    fail("pnpm reports unreviewed dependency build scripts");
  } else {
    ok("pnpm reports no unreviewed dependency build scripts");
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`cannot inspect ignored dependency builds: ${detail}`);
}

try {
  const pnpmConfig = JSON.parse(
    execFileSync("pnpm", ["config", "list", "--location", "project"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
  );
  const approvedBuilds = pnpmConfig.allowBuilds ?? {};
  const configIsExact =
    pnpmConfig.autoInstallPeers === false &&
    pnpmConfig.engineStrict === true &&
    pnpmConfig.savePrefix === "" &&
    pnpmConfig.strictDepBuilds === true &&
    pnpmConfig.strictPeerDependencies === true &&
    Object.keys(approvedBuilds).length === 2 &&
    approvedBuilds.esbuild === true &&
    approvedBuilds.workerd === true;

  if (!configIsExact) {
    fail("pnpm effective project config differs from the approved strict settings");
  } else {
    ok("pnpm effective project config and build-script allowlist are exact");
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`cannot validate pnpm effective project config: ${detail}`);
}

try {
  const devcontainer = JSON.parse(readText(".devcontainer/devcontainer.json"));
  const actualMounts = new Set(devcontainer.mounts ?? []);
  const mountsAreExact =
    actualMounts.size === expectedMounts.size &&
    [...expectedMounts].every((mount) => actualMounts.has(mount));

  if (!mountsAreExact) {
    fail("Dev Container mounts differ from the three approved named volumes");
  } else {
    ok("Dev Container has exactly the three approved named volumes");
  }

  if (JSON.stringify(devcontainer).includes("docker.sock")) {
    fail("Dev Container configuration references a Docker socket");
  } else {
    ok("Dev Container configuration has no Docker socket reference");
  }

  if (devcontainer.remoteUser !== "node" || devcontainer.containerUser !== "node") {
    fail("Dev Container users must both be node");
  } else {
    ok("Dev Container remote and container users are node");
  }

  const vscode = devcontainer.customizations?.vscode ?? {};
  if (
    !Array.isArray(vscode.extensions) ||
    !vscode.extensions.includes("openai.chatgpt") ||
    vscode.settings?.["chatgpt.openOnStartup"] !== true
  ) {
    fail("Codex IDE extension is not enabled for the Dev Container");
  } else {
    ok("Codex IDE extension is enabled and opens on startup");
  }

  if (process.env.CODEX_HOME !== "/home/node/.codex") {
    fail("CODEX_HOME must use the dedicated persistent volume");
  } else {
    ok("CODEX_HOME uses the dedicated persistent volume");
  }

  const codexConfig = readText("/home/node/.codex/config.toml");
  if (
    !codexConfig.includes('approval_policy = "untrusted"') ||
    !codexConfig.includes('sandbox_mode = "danger-full-access"')
  ) {
    fail("Codex is not configured to use the outer container security boundary");
  } else {
    ok("Codex uses the outer container boundary with untrusted-command approvals");
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`cannot validate devcontainer.json: ${detail}`);
}

for (const path of prohibitedComposeFiles) {
  if (existsSync(path)) {
    fail(`prohibited multi-service file exists: ${path}`);
  }
}

const requiredDockerIgnorePatterns = [
  ".git/",
  ".env",
  ".env.*",
  ".dev.vars",
  ".dev.vars.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "keystore*",
  "credentials*.json",
  "**/keystores/",
  ".codex/",
  ".agents/",
  "basestamp_mvp_codex_brief_v*.md",
  "contracts/broadcast/"
];
try {
  const dockerIgnoreLines = new Set(
    readText(".dockerignore")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
  const missingPatterns = requiredDockerIgnorePatterns.filter(
    (pattern) => !dockerIgnoreLines.has(pattern)
  );
  if (missingPatterns.length > 0) {
    fail(`.dockerignore is missing secret boundaries: ${missingPatterns.join(", ")}`);
  } else {
    ok(".dockerignore contains all required secret and keystore boundaries");
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`cannot validate .dockerignore: ${detail}`);
}
if (!prohibitedComposeFiles.some((path) => existsSync(path))) {
  ok("no Compose configuration exists");
}

for (const path of ignoredSecretPaths) {
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", "--", path],
    { stdio: "ignore" }
  );
  if (result.status !== 0) {
    fail(`secret path is not ignored by Git: ${path}`);
  }
}
if (!failed) {
  ok("representative secrets, Codex state, and private briefs are Git-ignored");
}

try {
  const visibleFiles = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )
    .split("\0")
    .filter(Boolean);

  const findings = [];
  for (const path of visibleFiles) {
    let content;
    try {
      content = readFileSync(path);
    } catch {
      continue;
    }
    if (content.includes(0)) {
      continue;
    }
    let text = content.toString("utf8");
    for (const assignment of syntheticSensitiveAssignmentsBySource.get(path) ?? []) {
      text = text.replace(assignment, "");
    }
    for (const label of findSecretLabels(text)) {
      findings.push(`${path} (${label})`);
    }
  }

  if (findings.length > 0) {
    fail(`secret scan findings: ${findings.join(", ")}`);
  } else {
    ok(`secret scan passed across ${visibleFiles.length} Git-visible files`);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`secret scan could not enumerate Git-visible files: ${detail}`);
}

if (existsSync("basestamp_mvp_codex_brief_v4.md")) {
  try {
  const v4 = readText("basestamp_mvp_codex_brief_v4.md");
  const foundTerms = prohibitedV4Terms.filter((term) => v4.includes(term));
  if (foundTerms.length > 0) {
    fail(`v4 contains prohibited legacy terms: ${foundTerms.join(", ")}`);
  } else {
    ok("v4 contains no prohibited legacy vocabulary");
  }

  const fenceCount = v4.split("\n").filter((line) => line.startsWith("~~~")).length;
  if (fenceCount % 2 !== 0) {
    fail(`v4 has an unbalanced Markdown fence count: ${fenceCount}`);
  } else {
    ok(`v4 Markdown fences are balanced (${fenceCount})`);
  }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`cannot validate v4 brief: ${detail}`);
  }
} else {
  ok("private v4 brief is absent from this checkout");
}

for (const path of [".env.example", ".dev.vars.example"]) {
  try {
    const assignments = readText(path)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const invalid = assignments.filter((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) return true;
      const name = line.slice(0, separator);
      const value = line.slice(separator + 1);
      return name.endsWith("_ENABLED") ? value !== "false" : value !== "";
    });
    if (invalid.length > 0) {
      fail(`${path} must contain only empty placeholders and false feature flags`);
    } else {
      ok(`${path} contains only empty placeholders and false feature flags`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`cannot validate ${path}: ${detail}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("BaseStamp development environment is ready.");
}
