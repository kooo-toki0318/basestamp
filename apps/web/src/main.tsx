import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { captureHandoffFragment } from "./handoff-fragment";
import { I18nProvider } from "./i18n";
import "./styles.css";
import "./improvements.css";
import "./ux-flow.css";
import "./brand-polish.css";
import "./information.css";
import "./ux-fixes.css";
import "./release-polish.css";
import "./create-route.css";
import { queryClient, wagmiConfig } from "./wagmi";

captureHandoffFragment();

document.body.classList.toggle(
  "basestamp-create-route",
  window.location.pathname === "/create" || window.location.pathname === "/create/"
);

const root = document.getElementById("root");
if (root === null) throw new Error("Application root is missing.");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </I18nProvider>
  </StrictMode>
);
