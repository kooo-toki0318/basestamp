import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { captureHandoffFragment } from "./handoff-fragment";
import { I18nProvider } from "./i18n";
import "./styles.css";
import "./improvements.css";
import { queryClient, wagmiConfig } from "./wagmi";

captureHandoffFragment();

const root = document.getElementById("root");
if (root === null) throw new Error("Application root is missing.");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </I18nProvider>
  </StrictMode>
);
