import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";
import { BASE_SEPOLIA_DEPLOYMENT } from "./lib/deployment";

export const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    injected({ shimDisconnect: true }),
    baseAccount({ appName: "BaseStamp" })
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(BASE_SEPOLIA_DEPLOYMENT.rpcUrl)
  }
});

declare module "wagmi" {
  // Wagmi uses interface declaration merging for its global config register.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Register {
    config: typeof wagmiConfig;
  }
}
