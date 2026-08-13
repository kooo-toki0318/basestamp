import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const deployScriptSource = await readFile(
  path.join(repositoryRoot, "contracts/script/deploy-mainnet.sh"),
  "utf8",
);
const expectedConfirmation =
  "DEPLOY BASESTAMP REGISTRY TO BASE MAINNET 8453";
const deployerAddress = "0x1111111111111111111111111111111111111111";
const rpcUrl = "https://mainnet.base.example.invalid";
const interactiveTest = process.platform === "linux" ? test : test.skip;

async function createFixture() {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "basestamp-mainnet-deploy-test-"),
  );
  const contractsDir = path.join(fixtureRoot, "contracts");
  const scriptDir = path.join(contractsDir, "script");
  const binDir = path.join(fixtureRoot, "bin");
  const commandLog = path.join(fixtureRoot, "commands.log");
  const deployScript = path.join(scriptDir, "deploy-mainnet.sh");

  await mkdir(scriptDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(deployScript, deployScriptSource, { mode: 0o755 });
  await writeFile(commandLog, "");

  const stubPreamble =
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "{",
      "    printf '%s' \"${0##*/}\"",
      "    printf '\\t%s' \"$@\"",
      "    printf '\\n'",
      "} >> \"$BASESTAMP_TEST_COMMAND_LOG\"",
    ].join("\n") + "\n";
  await writeFile(
    path.join(binDir, "cast"),
    stubPreamble +
      [
        "case \"${1:-}\" in",
        "    chain-id) printf '%s\\n' \"${BASESTAMP_TEST_CHAIN_ID:-8453}\" ;;",
        "    balance) printf '%s\\n' \"${BASESTAMP_TEST_BALANCE:-1}\" ;;",
        "    *) exit 64 ;;",
        "esac",
      ].join("\n") +
      "\n",
    { mode: 0o755 },
  );
  await writeFile(path.join(binDir, "pnpm"), stubPreamble, { mode: 0o755 });
  await writeFile(
    path.join(binDir, "forge"),
    stubPreamble +
      [
        "is_broadcast=false",
        "for argument in \"$@\"; do",
        "    if [[ \"$argument\" == \"--broadcast\" ]]; then",
        "        is_broadcast=true",
        "    fi",
        "done",
        "if [[ \"$is_broadcast\" == false ]]; then",
        "    dry_run_directory=\"$PWD/broadcast/DeployBaseStampRegistry.s.sol/8453/dry-run\"",
        "    mkdir -p \"$dry_run_directory\"",
        "    printf '{}\\n' > \"$dry_run_directory/run-1700000000000.json\"",
        "    printf '{}\\n' > \"$dry_run_directory/run-latest.json\"",
        "    case \"${BASESTAMP_TEST_POST_SIMULATION_ENTRY:-}\" in",
        "        top-level)",
        "            printf '{}\\n' > \"${dry_run_directory%/dry-run}/run-injected.json\"",
        "            ;;",
        "        dry-run-other)",
        "            mkdir \"$dry_run_directory/unexpected\"",
        "            ;;",
        "    esac",
        "fi",
      ].join("\n") +
      "\n",
    { mode: 0o755 },
  );

  return {
    fixtureRoot,
    contractsDir,
    deployScript,
    commandLog,
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      LC_ALL: "C",
      BASE_MAINNET_RPC_URL: rpcUrl,
      BASE_MAINNET_DEPLOYER_ADDRESS: deployerAddress,
      ETHERSCAN_API_KEY: "test-only-verifier-key",
      BASESTAMP_TEST_COMMAND_LOG: commandLog,
    },
    async cleanup() {
      await rm(fixtureRoot, { recursive: true, force: true });
    },
  };
}

function runNonInteractive(fixture, envOverrides = {}) {
  return spawnSync("bash", [fixture.deployScript], {
    cwd: fixture.fixtureRoot,
    env: { ...fixture.env, ...envOverrides },
    encoding: "utf8",
    input: "",
  });
}

function runInteractive(fixture, confirmation, envOverrides = {}) {
  return spawnSync(
    "/usr/bin/script",
    [
      "--quiet",
      "--return",
      "--command",
      `bash ${fixture.deployScript}`,
      "/dev/null",
    ],
    {
      cwd: fixture.fixtureRoot,
      env: { ...fixture.env, ...envOverrides },
      encoding: "utf8",
      input: `${confirmation}\n`,
    },
  );
}

async function readCommands(fixture) {
  const contents = await readFile(fixture.commandLog, "utf8");
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

test("rejects an RPC whose chain ID is not Base Mainnet", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());

  const result = runNonInteractive(fixture, {
    BASESTAMP_TEST_CHAIN_ID: "84532",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /RPC chain ID is 84532, expected Base Mainnet 8453/);
  assert.equal(
    (await readCommands(fixture)).some((command) =>
      command.includes("--broadcast"),
    ),
    false,
  );
});

test("rejects any prior Foundry chain directory, not only run-latest", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const priorRunDirectory = path.join(
    fixture.contractsDir,
    "broadcast/DeployBaseStampRegistry.s.sol/8453",
  );
  await mkdir(priorRunDirectory, { recursive: true });
  await writeFile(path.join(priorRunDirectory, "run-1700000000000.json"), "{}\n");

  const result = runNonInteractive(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /prior Base Mainnet Foundry broadcast directory/);
  assert.deepEqual(await readCommands(fixture), []);
});

test("rejects an empty prior Foundry chain directory", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  await mkdir(
    path.join(
      fixture.contractsDir,
      "broadcast/DeployBaseStampRegistry.s.sol/8453",
    ),
    { recursive: true },
  );

  const result = runNonInteractive(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /prior Base Mainnet Foundry broadcast directory/);
  assert.deepEqual(await readCommands(fixture), []);
});

test("rejects raw private-key variables before tool execution", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());

  const result = runNonInteractive(fixture, { PRIVATE_KEY: "test-raw-key" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing deployment: PRIVATE_KEY is set/);
  assert.deepEqual(await readCommands(fixture), []);
});

test("non-interactive stdin cannot reach a broadcast", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());

  const result = runNonInteractive(fixture);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /final Mainnet confirmation must be entered in an interactive terminal/,
  );
  const forgeCommands = (await readCommands(fixture)).filter(
    ([command]) => command === "forge",
  );
  assert.equal(forgeCommands.length, 1);
  assert.equal(forgeCommands[0].includes("--broadcast"), false);
});

interactiveTest(
  "rejects a top-level broadcast record created after simulation",
  async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());

    const result = runInteractive(fixture, expectedConfirmation, {
      BASESTAMP_TEST_POST_SIMULATION_ENTRY: "top-level",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /unexpected entry exists beside the current Mainnet dry-run/);
    assert.equal(
      (await readCommands(fixture)).some((command) =>
        command.includes("--broadcast"),
      ),
      false,
    );
  },
);

interactiveTest(
  "rejects an unexpected artifact inside the new dry-run directory",
  async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());

    const result = runInteractive(fixture, expectedConfirmation, {
      BASESTAMP_TEST_POST_SIMULATION_ENTRY: "dry-run-other",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /unexpected Mainnet dry-run artifact: unexpected/);
    assert.equal(
      (await readCommands(fixture)).some((command) =>
        command.includes("--broadcast"),
      ),
      false,
    );
  },
);

interactiveTest(
  "an inexact interactive confirmation cannot reach a broadcast",
  async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());

    const result = runInteractive(fixture, `${expectedConfirmation} `);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /confirmation did not match exactly/);
    assert.equal(
      (await readCommands(fixture)).some((command) =>
        command.includes("--broadcast"),
      ),
      false,
    );
  },
);

interactiveTest(
  "the exact confirmation uses reviewed broadcast and verification arguments",
  async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());

    const result = runInteractive(fixture, expectedConfirmation);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const commands = await readCommands(fixture);
    assert.deepEqual(
      commands.filter(([command]) => command === "pnpm"),
      [
        ["pnpm", "contracts:build"],
        ["pnpm", "contracts:artifact:check"],
      ],
    );
    const forgeCommands = commands.filter(([command]) => command === "forge");
    assert.equal(forgeCommands.length, 2);
    assert.deepEqual(forgeCommands[0], [
      "forge",
      "script",
      "script/DeployBaseStampRegistry.s.sol:DeployBaseStampRegistry",
      "--rpc-url",
      rpcUrl,
      "--chain",
      "8453",
      "--sender",
      deployerAddress,
      "--slow",
    ]);
    assert.deepEqual(forgeCommands[1], [
      "forge",
      "script",
      "script/DeployBaseStampRegistry.s.sol:DeployBaseStampRegistry",
      "--rpc-url",
      rpcUrl,
      "--chain",
      "8453",
      "--sender",
      deployerAddress,
      "--broadcast",
      "--verify",
      "--verifier",
      "etherscan",
      "--retries",
      "10",
      "--delay",
      "10",
      "--slow",
      "--browser",
      "--browser-disable-open",
      "--browser-port",
      "9545",
    ]);
  },
);
