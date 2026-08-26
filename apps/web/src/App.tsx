import { useCallback, useEffect, useRef, useState } from "react";
import {
  isHex,
  numberToHex,
  stringToHex,
  type Address,
  type Hex
} from "viem";
import type { Connector } from "wagmi";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSignTypedData,
  useSwitchChain
} from "wagmi";
import { createSiweMessage } from "viem/siwe";
import type { Session } from "./auth-types";
import {
  createBaseSiweCapability,
  readBaseSiweResponse,
  SIWE_STATEMENT,
  type NonceResponse,
  type SignedSiweMessage
} from "./auth-client";
import { parseJsonResponse } from "./api-client";
import { useI18n } from "./i18n-context";
import { CreatePage } from "./pages/CreatePage";
import { HandoffPage } from "./pages/HandoffPage";
import { HomePage } from "./pages/HomePage";
import { InformationPage } from "./pages/InformationPage";
import { StampPage } from "./pages/StampPage";
import { VerifyStartPage } from "./pages/VerifyStartPage";
import { getPublicInformationPage } from "./public-pages";
import {
  BASE_NETWORKS,
  DEFAULT_BASE_CHAIN_ID,
  getBaseNetwork,
  isSupportedChainId,
  type SupportedChainId
} from "./lib/networks";
import { parseHandoffRoute, parseStampRoute } from "./lib/routes";

type PersonalSignProvider = {
  request(arguments_: {
    method: "personal_sign";
    params: [Hex, Address];
  }): Promise<unknown>;
};

type WalletConnectAuthProvider = {
  request(arguments_: {
    method: "wallet_connect";
    params: [
      {
        version: "1";
        capabilities: {
          signInWithEthereum: ReturnType<typeof createBaseSiweCapability>;
        };
      }
    ];
  }): Promise<unknown>;
};

type ChainProvider = {
  request(arguments_:
    | {
        method: "eth_chainId";
      }
    | {
        method: "wallet_switchEthereumChain";
        params: [{ chainId: Hex }];
      }): Promise<unknown>;
};

type BaseInjectedProvider = {
  isBase?: boolean;
  isCoinbaseWallet?: boolean;
};

function isBaseInjectedProvider(provider: unknown): boolean {
  if (provider === null || typeof provider !== "object") return false;
  const candidate = provider as BaseInjectedProvider;
  return candidate.isBase === true || candidate.isCoinbaseWallet === true;
}

async function readConnectorChainId(connector: Connector): Promise<number> {
  const provider = (await connector.getProvider()) as
    | ChainProvider
    | null
    | undefined;
  if (provider == null) throw new Error("Wallet provider is unavailable.");
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/iu.test(chainId)) {
    throw new Error("Wallet returned an invalid chain ID.");
  }
  return Number(BigInt(chainId));
}

type AuthTone = "neutral" | "pending" | "success" | "error";

type AuthFeedback = {
  message: string;
  tone: AuthTone;
};

function shortAddress(address: string): string {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

export function App() {
  const { locale, setLocale, t } = useI18n();
  const {
    address,
    chainId: walletChainId,
    connector: activeConnector
  } = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connectAsync } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: signTypedDataAsync } = useSignTypedData();
  const {
    mutateAsync: switchChainAsync,
    isPending: networkBusy
  } = useSwitchChain();
  const [session, setSession] = useState<Session>({ authenticated: false });
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback>({
    message: "",
    tone: "neutral"
  });
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedChainId, setSelectedChainId] =
    useState<SupportedChainId>(DEFAULT_BASE_CHAIN_ID);
  const authDebugEnabled =
    new URLSearchParams(window.location.search).get("authdebug") === "1";
  const [authDiagnostics, setAuthDiagnostics] = useState<string[]>([]);
  const [baseInjectedConnectorUid, setBaseInjectedConnectorUid] = useState<
    string | undefined
  >(undefined);
  const [baseInjectedProbeComplete, setBaseInjectedProbeComplete] =
    useState(false);
  const lastAutoSwitch = useRef<string | undefined>(undefined);
  const adoptedWalletConnection = useRef<string | undefined>(undefined);
  const selectedNetwork = getBaseNetwork(selectedChainId);
  const traceAuth = useCallback(
    (event: string) => {
      if (!authDebugEnabled) return;
      const timestamp = new Date().toISOString().slice(11, 23);
      setAuthDiagnostics((entries) => [
        ...entries.slice(-15),
        `${timestamp} ${event}`
      ]);
    },
    [authDebugEnabled]
  );
  const showAuthStatus = useCallback(
    (message: string, tone: AuthTone = "neutral") => {
      setAuthFeedback({ message, tone });
    },
    []
  );

  useEffect(() => {
    const injectedConnector = connectors.find(
      (connector) => connector.id !== "baseAccount"
    );
    if (injectedConnector === undefined) {
      queueMicrotask(() => {
        setBaseInjectedConnectorUid(undefined);
        setBaseInjectedProbeComplete(true);
      });
      return;
    }

    let cancelled = false;
    void injectedConnector
      .getProvider()
      .then((provider) => {
        if (cancelled) return;
        const isBaseProvider = isBaseInjectedProvider(provider);
        traceAuth(
          `injected provider probe=${isBaseProvider ? "base" : "other"}`
        );
        setBaseInjectedConnectorUid(
          isBaseProvider ? injectedConnector.uid : undefined
        );
      })
      .catch(() => {
        if (cancelled) return;
        traceAuth("injected provider probe failed");
        setBaseInjectedConnectorUid(undefined);
      })
      .finally(() => {
        if (!cancelled) setBaseInjectedProbeComplete(true);
      });

    return () => {
      cancelled = true;
    };
  }, [connectors, traceAuth]);

  const ensureSelectedNetwork = useCallback(
    async (connector: Connector | undefined = activeConnector) => {
      if (connector === undefined) {
        throw new Error(t("auth.providerUnavailable"));
      }
      try {
        traceAuth(`RPC eth_chainId via ${connector.id}`);
        const currentChainId = await readConnectorChainId(connector);
        if (currentChainId === selectedChainId) return;

        showAuthStatus(
          t("auth.switching", { network: selectedNetwork.name }),
          "pending"
        );
        let switchedChainId: number;
        if (connector.id === "baseAccount") {
          const provider = (await connector.getProvider()) as
            | ChainProvider
            | null
            | undefined;
          if (provider == null) {
            throw new Error(t("auth.providerUnavailable"));
          }
          traceAuth("RPC wallet_switchEthereumChain via baseAccount");
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: numberToHex(selectedChainId) }]
          });
          traceAuth("RPC eth_chainId after network switch");
          switchedChainId = await readConnectorChainId(connector);
        } else {
          traceAuth(`wagmi switchChain via ${connector.id}`);
          switchedChainId = (
            await switchChainAsync({ chainId: selectedChainId, connector })
          ).id;
        }
        traceAuth("RPC eth_chainId confirm network");
        const confirmedChainId = await readConnectorChainId(connector);
        if (
          switchedChainId !== selectedChainId ||
          confirmedChainId !== selectedChainId
        ) {
          throw new Error(
            t("auth.switchIncomplete", {
              chainId: confirmedChainId,
              network: selectedNetwork.name
            })
          );
        }

        const signInAgain =
          session.authenticated && session.chainId !== selectedChainId
            ? t("auth.switchAgain")
            : "";
        showAuthStatus(
          t("auth.switched", {
            network: selectedNetwork.name,
            again: signInAgain
          }),
          "success"
        );
      } catch (error) {
        showAuthStatus(
          error instanceof Error
            ? t("auth.switchFailed", {
                message: error.message,
                network: selectedNetwork.name
              })
            : t("auth.autoSwitchFailedFallback"),
          "error"
        );
        throw error;
      }
    },
    [
      activeConnector,
      selectedChainId,
      selectedNetwork.name,
      session,
      showAuthStatus,
      switchChainAsync,
      t,
      traceAuth
    ]
  );

  useEffect(() => {
    void fetch("/api/session", { credentials: "include" })
      .then((response) => parseJsonResponse<Session>(response, t))
      .then(setSession)
      .catch(() => {
        setSession({ authenticated: false });
      })
      .finally(() => {
        setSessionLoaded(true);
      });
  }, [t]);

  useEffect(() => {
    if (address === undefined || activeConnector === undefined) {
      adoptedWalletConnection.current = undefined;
      return;
    }
    if (walletChainId === undefined) return;

    const connectionKey = `${activeConnector.uid}:${address}`;
    if (adoptedWalletConnection.current !== connectionKey) {
      adoptedWalletConnection.current = connectionKey;
      if (isSupportedChainId(walletChainId)) {
        lastAutoSwitch.current = undefined;
        if (walletChainId !== selectedChainId) {
          queueMicrotask(() => {
            setSelectedChainId(walletChainId);
          });
          return;
        }
      }
    }

    if (walletChainId === selectedChainId) {
      lastAutoSwitch.current = undefined;
      return;
    }

    const attemptKey =
      `${address}:${String(walletChainId)}:${String(selectedChainId)}`;
    if (lastAutoSwitch.current === attemptKey) return;
    lastAutoSwitch.current = attemptKey;

    void ensureSelectedNetwork().catch(() => {
      // The prominent authentication status already explains the failure.
    });
  }, [
    activeConnector,
    address,
    ensureSelectedNetwork,
    selectedChainId,
    walletChainId
  ]);

  function selectNetwork(value: number): void {
    if (!isSupportedChainId(value)) return;
    lastAutoSwitch.current = undefined;
    setSelectedChainId(value);
    if (address === undefined) {
      showAuthStatus(
        t("auth.networkSelected", { network: getBaseNetwork(value).name })
      );
    }
  }

  const requestAuthNonce = useCallback(async (): Promise<NonceResponse> => {
    traceAuth("HTTP POST /api/auth/nonce");
    showAuthStatus(t("auth.requestNonce"), "pending");
    const nonce = await fetch("/api/auth/nonce", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: selectedChainId })
    }).then((response) => parseJsonResponse<NonceResponse>(response, t));
    traceAuth("HTTP /api/auth/nonce complete");
    return nonce;
  }, [selectedChainId, showAuthStatus, t, traceAuth]);

  const verifySignedSiwe = useCallback(async (
    signedMessage: SignedSiweMessage
  ): Promise<void> => {
    traceAuth("HTTP POST /api/auth/verify");
    showAuthStatus(t("auth.verifying"), "pending");
    const authenticated = await fetch("/api/auth/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedMessage)
    }).then((response) => parseJsonResponse<Session>(response, t));
    traceAuth("HTTP /api/auth/verify complete");
    setSession(authenticated);
    showAuthStatus(t("auth.signedIn"), "success");
  }, [showAuthStatus, t, traceAuth]);

  const connectWallet = useCallback(
    async (requestedConnector: Connector): Promise<void> => {
      const connector = connectors.find(
        (candidate) => candidate.uid === requestedConnector.uid
      );
      if (connector === undefined) {
        showAuthStatus(t("auth.providerUnavailable"), "error");
        return;
      }

      setAuthBusy(true);
      showAuthStatus(
        t("auth.connecting", { network: selectedNetwork.name }),
        "pending"
      );
      try {
        traceAuth(`wallet connect requested via ${connector.id}`);
        const connection = await connectAsync({
          connector,
          chainId: selectedChainId
        });
        traceAuth("wallet connect returned");

        const account = connection.accounts[0];

        if (connection.chainId !== selectedChainId) {
          lastAutoSwitch.current =
            `${account}:${String(connection.chainId)}:${String(selectedChainId)}`;
          await ensureSelectedNetwork(connector);
        }

        showAuthStatus(t("auth.connected"), "success");
      } catch (error) {
        traceAuth("wallet connect failed");
        showAuthStatus(
          error instanceof Error ? error.message : t("auth.signInFailed"),
          "error"
        );
      } finally {
        setAuthBusy(false);
      }
    },
    [
      connectAsync,
      connectors,
      ensureSelectedNetwork,
      selectedChainId,
      selectedNetwork.name,
      showAuthStatus,
      t,
      traceAuth
    ]
  );

  const signIn = useCallback(
    async (requestedConnector: Connector): Promise<void> => {
      const connector = connectors.find(
        (candidate) => candidate.uid === requestedConnector.uid
      );

      if (
        connector === undefined ||
        address === undefined ||
        activeConnector?.uid !== connector.uid
      ) {
        traceAuth("signIn failed: active connector unavailable");
        showAuthStatus(t("auth.providerUnavailable"), "error");
        return;
      }

      traceAuth(`signIn connector=${connector.id}`);
      traceAuth("reuseConnection=true");
      traceAuth(
        `chain wallet=${String(walletChainId ?? "unknown")} selected=${String(selectedChainId)}`
      );

      setAuthBusy(true);
      showAuthStatus(
        t("auth.preparing", { network: selectedNetwork.name }),
        "pending"
      );

      try {
        const account = address;
        const connectedChainId =
          walletChainId ?? (await readConnectorChainId(connector));

        if (connectedChainId !== selectedChainId) {
          traceAuth("network mismatch; switch requested");
          lastAutoSwitch.current =
            `${account}:${String(connectedChainId)}:${String(selectedChainId)}`;
          await ensureSelectedNetwork(connector);
        }

        const nonce = await requestAuthNonce();
        const rawProvider = await connector.getProvider();
        if (rawProvider == null) {
          throw new Error(t("auth.providerUnavailable"));
        }

        if (connector.id === "baseAccount" || isBaseInjectedProvider(rawProvider)) {
          showAuthStatus(t("auth.confirmMessage"), "pending");
          const provider = rawProvider as WalletConnectAuthProvider;
          traceAuth(
            `RPC wallet_connect + signInWithEthereum via ${connector.id}`
          );
          const response = await provider.request({
            method: "wallet_connect",
            params: [
              {
                version: "1",
                capabilities: {
                  signInWithEthereum: createBaseSiweCapability(nonce)
                }
              }
            ]
          });
          traceAuth("RPC wallet_connect auth returned");

          const parsed = readBaseSiweResponse(response);
          if (
            parsed === undefined ||
            parsed.address.toLowerCase() !== account.toLowerCase()
          ) {
            throw new Error(t("auth.invalidSignature"));
          }

          await verifySignedSiwe(parsed.signedMessage);
          return;
        }

        const message = createSiweMessage({
          address: account,
          chainId: nonce.chainId,
          domain: nonce.domain,
          uri: nonce.uri,
          version: "1",
          nonce: nonce.nonce,
          issuedAt: new Date(nonce.issuedAt),
          expirationTime: new Date(nonce.expirationTime),
          statement: SIWE_STATEMENT
        });

        showAuthStatus(t("auth.confirmMessage"), "pending");

        const provider = rawProvider as PersonalSignProvider;
        traceAuth(`RPC personal_sign via ${connector.id}`);
        const signature = await provider.request({
          method: "personal_sign",
          params: [stringToHex(message), account]
        });
        traceAuth("RPC personal_sign returned");

        if (typeof signature !== "string" || !isHex(signature)) {
          throw new Error(t("auth.invalidSignature"));
        }

        await verifySignedSiwe({ message, signature });
      } catch (error) {
        traceAuth("signIn failed");
        showAuthStatus(
          error instanceof Error
            ? error.message
            : t("auth.signInFailed"),
          "error"
        );
      } finally {
        setAuthBusy(false);
      }
    },
    [
      activeConnector,
      address,
      connectors,
      ensureSelectedNetwork,
      requestAuthNonce,
      selectedChainId,
      selectedNetwork.name,
      showAuthStatus,
      t,
      traceAuth,
      verifySignedSiwe,
      walletChainId
    ]
  );

  async function disconnectWallet(): Promise<void> {
    setAuthBusy(true);
    let nextStatus = t("auth.disconnected");
    let nextTone: AuthTone = "neutral";
    try {
      if (session.authenticated) {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }).then((response) => parseJsonResponse<Session>(response, t));
      }
    } catch (error) {
      nextTone = "error";
      nextStatus =
        error instanceof Error
          ? t("auth.serverSignOutFailed", { message: error.message })
          : t("auth.serverSignOutFailedFallback");
    } finally {
      setSession({ authenticated: false });
      disconnect();
      showAuthStatus(nextStatus, nextTone);
      setAuthBusy(false);
    }
  }

  async function copyAddress(): Promise<void> {
    if (address === undefined) return;
    try {
      await navigator.clipboard.writeText(address);
      showAuthStatus(t("auth.addressCopied"), "success");
    } catch {
      showAuthStatus(t("auth.addressCopyFailed"), "error");
    }
  }

  const baseConnector = connectors.find(
    (connector) => connector.id === "baseAccount"
  );
  const injectedConnector = connectors.find(
    (connector) => connector.id !== "baseAccount"
  );
  const baseInjectedConnector = connectors.find(
    (connector) => connector.uid === baseInjectedConnectorUid
  );
  const preferredBaseConnector = baseInjectedProbeComplete
    ? (baseInjectedConnector ?? baseConnector)
    : undefined;
  const secondaryBrowserConnector =
    injectedConnector?.uid === preferredBaseConnector?.uid
      ? undefined
      : injectedConnector;
  const walletChainMatchesSelection = walletChainId === selectedChainId;
  const authenticatedConnection =
    session.authenticated &&
    session.walletAddress.toLowerCase() === address?.toLowerCase() &&
    session.chainId === selectedChainId &&
    walletChainMatchesSelection;
  const displayedAuthStatus =
    authFeedback.message === "" ? t("auth.ready") : authFeedback.message;
  const path = window.location.pathname;
  const stampRoute = parseStampRoute(path);
  const handoffRoute = parseHandoffRoute(path);
  const publicInformationPage = getPublicInformationPage(path);

  let page: React.ReactNode;
  if (path === "/" || path === "") {
    page = <HomePage />;
  } else if (path === "/create" || path === "/create/") {
    page = (
      <CreatePage
        key={`create:${String(selectedChainId)}`}
        address={address}
        connectorId={activeConnector?.id}
        walletChainId={walletChainId}
        selectedChainId={selectedChainId}
        session={session}
        authBusy={authBusy || networkBusy}
        baseSignInAvailable={preferredBaseConnector !== undefined}
        browserSignInAvailable={secondaryBrowserConnector !== undefined}
        onSignInBase={() => {
          if (preferredBaseConnector !== undefined) {
            void connectWallet(preferredBaseConnector);
          }
        }}
        onSignInBrowser={() => {
          if (secondaryBrowserConnector !== undefined) {
            void connectWallet(secondaryBrowserConnector);
          }
        }}
        onAuthenticate={() => {
          if (activeConnector !== undefined) void signIn(activeConnector);
        }}
        onEnsureNetwork={() => ensureSelectedNetwork()}
      />
    );
  } else if (path === "/verify" || path === "/verify/") {
    page = <VerifyStartPage />;
  } else if (publicInformationPage !== undefined) {
    page = <InformationPage page={publicInformationPage} />;
  } else if (handoffRoute !== undefined) {
    page = (
      <HandoffPage
        chainId={handoffRoute.chainId}
        stampId={handoffRoute.stampId}
        address={address}
        walletChainId={walletChainId}
        selectedChainId={selectedChainId}
        session={session}
        authBusy={authBusy || networkBusy}
        baseSignInAvailable={preferredBaseConnector !== undefined}
        browserSignInAvailable={secondaryBrowserConnector !== undefined}
        onSignInBase={() => {
          if (preferredBaseConnector !== undefined) {
            void connectWallet(preferredBaseConnector);
          }
        }}
        onSignInBrowser={() => {
          if (secondaryBrowserConnector !== undefined) {
            void connectWallet(secondaryBrowserConnector);
          }
        }}
        onAuthenticate={() => {
          if (activeConnector !== undefined) void signIn(activeConnector);
        }}
        onSelectNetwork={() => {
          selectNetwork(handoffRoute.chainId);
        }}
        onEnsureNetwork={() => ensureSelectedNetwork()}
        onSignTypedData={(challenge) =>
          signTypedDataAsync({
            account: address,
            connector: activeConnector,
            domain: challenge.domain,
            types: challenge.types,
            primaryType: challenge.primaryType,
            message: {
              ...challenge.message,
              issuedAt: BigInt(challenge.message.issuedAt),
              challengeExpiresAt: BigInt(
                challenge.message.challengeExpiresAt
              )
            }
          })
        }
      />
    );
  } else if (stampRoute !== undefined) {
    page = (
      <StampPage
        chainId={stampRoute.chainId}
        stampId={stampRoute.stampId}
      />
    );
  } else {
    page = (
      <section className="shell workspace">
        <p className="eyebrow">{t("page.notFoundEyebrow")}</p>
        <h1>{t("page.notFoundTitle")}</h1>
        <a href="/">{t("page.returnHome")}</a>
      </section>
    );
  }

  return (
    <>
      <header className="shell nav">
        <a className="brand" href="/" aria-label={t("nav.home")}>
          <img src="/basestamp-icon.png" alt="" aria-hidden="true" />
          BaseStamp
        </a>
        <nav className="nav-links" aria-label={t("nav.primary")}>
          <a href="/create">{t("nav.create")}</a>
          <a href="/verify">{t("nav.verify")}</a>
          <a
            className="github-link"
            href="https://github.com/kooo-toki0318/basestamp"
            target="_blank"
            rel="noreferrer"
            aria-label={t("nav.githubAria")}
          >
            <span>{t("nav.github")}</span>
            <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <div className="auth-area">
          {address !== undefined ? (
            <>
              {!walletChainMatchesSelection &&
              walletChainId !== undefined &&
              activeConnector !== undefined ? (
                <button
                  className="compact"
                  type="button"
                  onClick={() => {
                    void ensureSelectedNetwork().catch(() => {
                      // The prominent authentication status explains the failure.
                    });
                  }}
                  disabled={authBusy || networkBusy}
                >
                  {t("auth.switchTo", { network: selectedNetwork.name })}
                </button>
              ) : sessionLoaded &&
                !authenticatedConnection &&
                activeConnector !== undefined ? (
                <button
                  className={
                    authFeedback.tone === "error"
                      ? "compact auth-retry"
                      : "compact"
                  }
                  type="button"
                  onClick={() => void signIn(activeConnector)}
                  disabled={authBusy || networkBusy}
                >
                  {t(
                    authFeedback.tone === "error"
                      ? "auth.retry"
                      : "auth.authenticate"
                  )}
                </button>
              ) : null}
              <div
                className="wallet-identity"
                title={
                  authenticatedConnection
                    ? t("auth.connectedAuthenticated")
                    : t("auth.connected")
                }
              >
                <span className="wallet-address" title={address}>
                  {shortAddress(address)}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void copyAddress()}
                  disabled={authBusy || networkBusy}
                  aria-label={t("auth.copyAddress")}
                  title={t("auth.copyAddress")}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
                    <path d="M4.5 13.5h-1A1.5 1.5 0 0 1 2 12V3.5A1.5 1.5 0 0 1 3.5 2H12a1.5 1.5 0 0 1 1.5 1.5v1" />
                  </svg>
                </button>
              </div>
              <button
                className="compact secondary"
                type="button"
                onClick={() => void disconnectWallet()}
                disabled={authBusy || networkBusy}
              >
                {t("auth.disconnect")}
              </button>
            </>
          ) : (
            <>
              <button
                className="compact"
                type="button"
                onClick={() => {
                  if (preferredBaseConnector !== undefined) {
                    void connectWallet(preferredBaseConnector);
                  }
                }}
                disabled={
                  authBusy ||
                  networkBusy ||
                  preferredBaseConnector === undefined
                }
              >
                {t("auth.signInBase")}
              </button>
              {secondaryBrowserConnector !== undefined && (
                <button
                  className="compact secondary"
                  type="button"
                  onClick={() => void connectWallet(secondaryBrowserConnector)}
                  disabled={authBusy || networkBusy}
                >
                  {t("auth.browserWallet")}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="shell context-bar">
        <div
          className={"auth-status " + authFeedback.tone}
          role={authFeedback.tone === "error" ? "alert" : "status"}
          aria-live={
            authFeedback.tone === "error"
              ? "assertive"
              : "polite"
          }
        >
          <span>{displayedAuthStatus}</span>
        </div>

        <div className="context-controls">
          <label className="setting-picker network-picker">
            <span className="setting-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="7" />
                <path d="M3.6 8h12.8M3.6 12h12.8M10 3c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z" />
              </svg>
            </span>
            <span className="setting-field">
              <span className="setting-label">{t("nav.network")}</span>
              <span className="setting-select">
                <select
                  aria-label={t("nav.networkAria")}
                  value={selectedChainId}
                  onChange={(event) => {
                    selectNetwork(Number(event.target.value));
                  }}
                  disabled={authBusy || networkBusy}
                >
                  {BASE_NETWORKS.map((network) => (
                    <option key={network.chainId} value={network.chainId}>
                      {network.name} ·{" "}
                      {t(
                        network.environment === "Mainnet"
                          ? "network.mainnet"
                          : "network.testnet"
                      )}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 12 8" aria-hidden="true">
                  <path d="m1 1.5 5 5 5-5" />
                </svg>
              </span>
            </span>
          </label>

          <label className="setting-picker language-picker">
            <span className="setting-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M3 5.5h8M7 3v2.5m-2.5 0c.8 2.8 2.7 5.1 5.5 6.5M9.5 5.5A11 11 0 0 1 4 12" />
                <path d="m11 16 3-7 3 7m-5-2h4" />
              </svg>
            </span>
            <span className="setting-field">
              <span className="setting-label">{t("nav.language")}</span>
              <span className="setting-select">
                <select
                  aria-label={t("nav.languageAria")}
                  value={locale}
                  onChange={(event) => {
                    setLocale(event.target.value === "ja" ? "ja" : "en");
                  }}
                >
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                </select>
                <svg viewBox="0 0 12 8" aria-hidden="true">
                  <path d="m1 1.5 5 5 5-5" />
                </svg>
              </span>
            </span>
          </label>
        </div>
      </div>

      <main>{page}</main>

      {authDebugEnabled && (
        <aside
          aria-label="Auth diagnostics"
          aria-live="polite"
          style={{
            position: "fixed",
            zIndex: 2000,
            top: 12,
            left: 12,
            width: "min(430px, calc(100vw - 24px))",
            maxHeight: "42vh",
            overflow: "auto",
            padding: 12,
            border: "1px solid rgba(255,255,255,.18)",
            borderRadius: 12,
            color: "#f7f5ef",
            background: "rgba(16,39,31,.94)",
            boxShadow: "0 12px 36px rgba(0,0,0,.28)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: 1.45
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 8
            }}
          >
            <strong style={{ fontSize: 12 }}>Auth diagnostics</strong>
            <button
              type="button"
              onClick={() => {
                setAuthDiagnostics([]);
              }}
              style={{
                minHeight: 28,
                padding: "3px 8px",
                border: "1px solid rgba(255,255,255,.24)",
                borderRadius: 7,
                color: "inherit",
                background: "transparent",
                boxShadow: "none",
                font: "inherit"
              }}
            >
              Clear
            </button>
          </div>
          <div style={{ opacity: 0.78, marginBottom: 8 }}>
            <div>connector: {activeConnector?.id ?? "none"}</div>
            <div>connected: {address === undefined ? "no" : "yes"}</div>
            <div>
              walletChain: {walletChainId ?? "unknown"} · selectedChain: {selectedChainId}
            </div>
            <div>
              session: {session.authenticated ? "authenticated" : "not authenticated"}
            </div>
          </div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {authDiagnostics.length === 0 ? (
              <li>Waiting for an authentication action…</li>
            ) : (
              authDiagnostics.map((entry, index) => (
                <li key={`${String(index)}:${entry}`}>{entry}</li>
              ))
            )}
          </ol>
          <p style={{ margin: "8px 0 0", opacity: 0.68 }}>
            No nonce, SIWE message, signature, session token, or full wallet address is logged.
          </p>
        </aside>
      )}

      <footer className="shell footer">
        <div className="footer-copy">
          <span>{t("footer.product")}</span>
          <span>{t("footer.boundary")}</span>
        </div>
        <nav className="footer-links" aria-label={t("footer.information")}>
          <a href="/about/legal">{t("footer.legal")}</a>
          <a href="/privacy">{t("footer.privacy")}</a>
          <a href="/terms">{t("footer.terms")}</a>
          <a href="/security">{t("footer.security")}</a>
        </nav>
      </footer>
    </>
  );
}
