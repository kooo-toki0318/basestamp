import { QueryClient } from "@tanstack/react-query";
import { Attribution } from "ox/erc8021";
import { createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";
import { BASE_SEPOLIA_DEPLOYMENT } from "./lib/deployment";

export const queryClient = new QueryClient();

const builderCode = import.meta.env.VITE_BASE_BUILDER_CODE?.trim() ?? "";
const dataSuffix =
  builderCode === ""
    ? undefined
    : Attribution.toDataSuffix({ codes: [builderCode] });

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    baseAccount({ appName: "BaseStamp" }),
    injected({ shimDisconnect: true })
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(BASE_SEPOLIA_DEPLOYMENT.rpcUrl)
  },
  ...(dataSuffix === undefined ? {} : { dataSuffix })
});

declare module "wagmi" {
  // Wagmi uses interface declaration merging for its global config register.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Register {
    config: typeof wagmiConfig;
  }
}
