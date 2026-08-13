import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const artifactPath = new URL("../contracts/out/BaseStampRegistry.sol/BaseStampRegistry.json", import.meta.url);
const sepoliaDeploymentPath = new URL("../contracts/deployments/84532.json", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

const [artifactSource, packageSource, sepoliaDeploymentSource] = await Promise.all([
  readFile(artifactPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(sepoliaDeploymentPath, "utf8"),
]);

const artifact = JSON.parse(artifactSource);
const packageJson = JSON.parse(packageSource);
const sepoliaDeployment = JSON.parse(sepoliaDeploymentSource);
const abi = artifact.abi;

if (!Array.isArray(abi)) {
  throw new Error("BaseStampRegistry artifact ABI is missing.");
}

const functionNames = abi
  .filter((entry) => entry.type === "function")
  .map((entry) => entry.name)
  .sort();
const expectedFunctions = [
  "createStamp",
  "createStampFor",
  "eip712Domain",
  "exists",
  "getStamp",
].sort();

if (JSON.stringify(functionNames) !== JSON.stringify(expectedFunctions)) {
  throw new Error(
    `Unexpected BaseStampRegistry function surface: ${functionNames.join(", ")}`,
  );
}

const assetEntry = abi.find(
  (entry) =>
    entry.type === "receive" ||
    entry.type === "fallback" ||
    entry.stateMutability === "payable",
);
if (assetEntry) {
  throw new Error(
    `BaseStampRegistry must not expose payable/receive/fallback ABI entries: ${assetEntry.type}`,
  );
}

const constructor = abi.find((entry) => entry.type === "constructor");
if (!constructor || constructor.stateMutability !== "nonpayable") {
  throw new Error("BaseStampRegistry constructor must be nonpayable.");
}

if (typeof artifact.bytecode?.object !== "string" || artifact.bytecode.object === "0x") {
  throw new Error("BaseStampRegistry deployment bytecode is missing.");
}

const runtimeObject = artifact.deployedBytecode?.object;
if (
  typeof runtimeObject !== "string" ||
  !/^0x[0-9a-fA-F]+$/.test(runtimeObject) ||
  runtimeObject.length % 2 !== 0
) {
  throw new Error("BaseStampRegistry runtime bytecode is missing or malformed.");
}

const normalizedRuntime = Buffer.from(runtimeObject.slice(2), "hex");
const immutableReferences = artifact.deployedBytecode?.immutableReferences;
if (
  immutableReferences === null ||
  typeof immutableReferences !== "object" ||
  Array.isArray(immutableReferences)
) {
  throw new Error("BaseStampRegistry immutable references are missing.");
}

for (const references of Object.values(immutableReferences)) {
  if (!Array.isArray(references)) {
    throw new Error("BaseStampRegistry immutable references are malformed.");
  }
  for (const reference of references) {
    const start = reference?.start;
    const length = reference?.length;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length <= 0 ||
      start + length > normalizedRuntime.length
    ) {
      throw new Error("BaseStampRegistry immutable reference is outside runtime bytecode.");
    }
    normalizedRuntime.fill(0, start, start + length);
  }
}

const immutableNormalizedRuntimeHash = execFileSync(
  "cast",
  ["keccak", `0x${normalizedRuntime.toString("hex")}`],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
).trim();
const expectedRuntimeHash =
  sepoliaDeployment.bytecode?.immutableNormalizedRuntimeHash;
if (
  !/^0x[0-9a-f]{64}$/.test(expectedRuntimeHash) ||
  immutableNormalizedRuntimeHash !== expectedRuntimeHash
) {
  throw new Error(
    `Registry runtime hash does not match the canonical Sepolia artifact: ${immutableNormalizedRuntimeHash}`,
  );
}

const compilerVersion = artifact.metadata?.compiler?.version;
const settings = artifact.metadata?.settings;
if (compilerVersion !== "0.8.36+commit.8a079791") {
  throw new Error(`Unexpected Solidity compiler: ${compilerVersion}`);
}
if (settings?.evmVersion !== "osaka") {
  throw new Error(`Unexpected EVM target: ${settings?.evmVersion}`);
}
if (settings?.optimizer?.enabled !== true || settings?.optimizer?.runs !== 200) {
  throw new Error("Unexpected optimizer configuration.");
}
if (settings?.metadata?.bytecodeHash !== "ipfs") {
  throw new Error("Unexpected bytecode metadata hash mode.");
}
if (packageJson.devDependencies?.["@openzeppelin/contracts"] !== "5.6.1") {
  throw new Error("OpenZeppelin Contracts must remain pinned to 5.6.1.");
}

console.log(
  `Registry ABI, compiler settings, and canonical runtime verified from ${repositoryRoot} (5 functions, no asset/admin surface).`,
);
