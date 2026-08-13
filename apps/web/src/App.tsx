import { useCallback, useEffect, useRef, useState } from "react";
import { isHex, numberToHex, type Address, type Hex } from "viem";
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
  readConnectedAddress,
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
  getBaseNetwork,
  isSupportedChainId,
  type SupportedChainId
} from "./lib/networks";

type PersonalSignProvider = {
  request(arguments_: {
    method: "personal_sign";
    params: [string, Address];
  }): Promise<unknown>;
};

type BaseSignInProvider = {
  request(arguments_: {
    method: "wallet_connect";
    params: [
      {
        capabilities: {
          signInWithEthereum: ReturnType<typeof createBaseSiweCapability>;
        };
        chainIds: Hex[];
      }
    ];
  }): Promise<unknown>;
};

type AuthTone = "neutral" | "pending" | "success" | "error";

type AuthFeedback = {
  message: string;
  tone: AuthTone;
};

function shortAddress(address: string): string {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function currentStampId(): Hex | undefined {
  const match = /^\/stamps\/(0x[0-9a-fA-F]{64})\/?$/u.exec(
    window.location.pathname
  );
  return match?.[1]?.toLowerCase() as Hex | undefined;
}

function currentHandoffStampId(): Hex | undefined {
  const match = /^\/handoff\/(0x[0-9a-fA-F]{64})\/?$/u.exec(
    window.location.pathname
  );
  return match?.[1]?.toLowerCase() as Hex | undefined;
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
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback>({
    message: "",
    tone: "neutral"
  });
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedChainId, setSelectedChainId] =
    useState<SupportedChainId>(84532);
  const lastAutoSwitch = useRef<string | undefined>(undefined);
  const selectedNetwork = getBaseNetwork(selectedChainId);
  const showAuthStatus = useCallback(
    (message: string, tone: AuthTone = "neutral") => {
      setAuthFeedback({ message, tone });
    },
    []
  );

  const ensureSelectedNetwork = useCallback(
    async (connector: Connector | undefined = activeConnector) => {
      if (connector === undefined) {
        throw new Error(t("auth.providerUnavailable"));
      }
      try {
        const currentChainId = await connector.getChainId();
        if (currentChainId === selectedChainId) return;

        showAuthStatus(
          t("auth.switching", { network: selectedNetwork.name }),
          "pending"
        );
        const switchedChain = await switchChainAsync({
          chainId: selectedChainId,
          connector
        });
        const confirmedChainId = await connector.getChainId();
        if (
          switchedChain.id !== selectedChainId ||
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
      t
    ]
  );

  useEffect(() => {
    void fetch("/api/session", { credentials: "include" })
      .then((response) => parseJsonResponse<Session>(response, t))
      .then(setSession)
      .catch(() => {
        setSession({ authenticated: false });
      });
  }, [t]);

  useEffect(() => {
    if (
      address === undefined ||
      activeConnector === undefined ||
      walletChainId === undefined ||
      walletChainId === selectedChainId
    ) {
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

  async function requestAuthNonce(): Promise<NonceResponse> {
    showAuthStatus(t("auth.requestNonce"), "pending");
    return fetch("/api/auth/nonce", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: selectedChainId })
    }).then((response) => parseJsonResponse<NonceResponse>(response, t));
  }

  async function verifySignedSiwe(
    signedMessage: SignedSiweMessage
  ): Promise<void> {
    showAuthStatus(t("auth.verifying"), "pending");
    const authenticated = await fetch("/api/auth/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedMessage)
    }).then((response) => parseJsonResponse<Session>(response, t));
    setSession(authenticated);
    showAuthStatus(t("auth.signedIn"), "success");
  }

  async function signIn(requestedConnector: Connector): Promise<void> {
    const connector = connectors.find(
      (candidate) => candidate.uid === requestedConnector.uid
    );
    if (connector === undefined) {
      showAuthStatus(t("auth.providerUnavailable"), "error");
      return;
    }
    const reuseConnection =
      address !== undefined && activeConnector?.uid === connector.uid;

    setAuthBusy(true);
    showAuthStatus(
      reuseConnection
        ? t("auth.preparing", { network: selectedNetwork.name })
        : t("auth.connecting", { network: selectedNetwork.name }),
      "pending"
    );
    try {
      let account: Address;
      let connectedChainId: number;
      let nonce: NonceResponse | undefined;
      let signedMessage: SignedSiweMessage | undefined;

      if (connector.id === "baseAccount") {
        nonce = await requestAuthNonce();
        const signInWithEthereum = createBaseSiweCapability(nonce);
        if (reuseConnection) {
          const provider = (await connector.getProvider()) as
            | BaseSignInProvider
            | null
            | undefined;
          if (provider == null) {
            throw new Error(t("auth.providerUnavailable"));
          }
          const response = await provider.request({
            method: "wallet_connect",
            params: [
              {
                capabilities: { signInWithEthereum },
                chainIds: [
                  numberToHex(selectedChainId),
                  ...BASE_NETWORKS.filter(
                    (network) => network.chainId !== selectedChainId
                  ).map((network) => numberToHex(network.chainId))
                ]
              }
            ]
          });
          account = readConnectedAddress(response) ?? address;
          signedMessage = readBaseSiweResponse(response)?.signedMessage;
          connectedChainId = walletChainId ?? (await connector.getChainId());
        } else {
          const connection = await connectAsync({
            connector,
            chainId: selectedChainId,
            withCapabilities: true,
            capabilities: { signInWithEthereum }
          });
          const connectedAddress = readConnectedAddress(connection);
          if (connectedAddress === undefined) {
            throw new Error(t("auth.providerUnavailable"));
          }
          account = connectedAddress;
          signedMessage = readBaseSiweResponse(connection)?.signedMessage;
          connectedChainId = connection.chainId;
        }
      } else if (reuseConnection) {
        account = address;
        connectedChainId = walletChainId ?? (await connector.getChainId());
      } else {
        const connection = await connectAsync({
          connector,
          chainId: selectedChainId
        });
        account = connection.accounts[0];
        connectedChainId = connection.chainId;
      }

      if (connectedChainId !== selectedChainId) {
        lastAutoSwitch.current =
          `${account}:${String(connectedChainId)}:${String(selectedChainId)}`;
        await ensureSelectedNetwork(connector);
      }

      if (signedMessage === undefined) {
        nonce ??= await requestAuthNonce();
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
        const provider = (await connector.getProvider()) as
          | PersonalSignProvider
          | null
          | undefined;
        if (provider == null) {
          throw new Error(t("auth.providerUnavailable"));
        }
        const signature = await provider.request({
          method: "personal_sign",
          params: [message, account]
        });
        if (typeof signature !== "string" || !isHex(signature)) {
          throw new Error(t("auth.invalidSignature"));
        }
        signedMessage = { message, signature };
      }

      await verifySignedSiwe(signedMessage);
    } catch (error) {
      showAuthStatus(
        error instanceof Error ? error.message : t("auth.signInFailed"),
        "error"
      );
    } finally {
      setAuthBusy(false);
    }
  }

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
  const walletChainMatchesSelection = walletChainId === selectedChainId;
  const authenticatedConnection =
    session.authenticated &&
    session.walletAddress.toLowerCase() === address?.toLowerCase() &&
    session.chainId === selectedChainId &&
    walletChainMatchesSelection;
  const displayedAuthStatus =
    authFeedback.message === "" ? t("auth.ready") : authFeedback.message;
  const stampId = currentStampId();
  const handoffStampId = currentHandoffStampId();
  const path = window.location.pathname;
  const publicInformationPage = getPublicInformationPage(path);

  let page: React.ReactNode;
  if (path === "/" || path === "") {
    page = <HomePage />;
  } else if (path === "/create" || path === "/create/") {
    page = (
      <CreatePage
        key={`${activeConnector?.id ?? "disconnected"}:${address ?? ""}`}
        address={address}
        connectorId={activeConnector?.id}
        walletChainId={walletChainId}
        selectedChainId={selectedChainId}
        session={session}
        authBusy={authBusy || networkBusy}
        baseSignInAvailable={baseConnector !== undefined}
        browserSignInAvailable={injectedConnector !== undefined}
        onSignInBase={() => {
          if (baseConnector !== undefined) void signIn(baseConnector);
        }}
        onSignInBrowser={() => {
          if (injectedConnector !== undefined) void signIn(injectedConnector);
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
  } else if (handoffStampId !== undefined) {
    page = (
      <HandoffPage
        stampId={handoffStampId}
        address={address}
        walletChainId={walletChainId}
        selectedChainId={selectedChainId}
        session={session}
        authBusy={authBusy || networkBusy}
        baseSignInAvailable={baseConnector !== undefined}
        browserSignInAvailable={injectedConnector !== undefined}
        onSignInBase={() => {
          if (baseConnector !== undefined) void signIn(baseConnector);
        }}
        onSignInBrowser={() => {
          if (injectedConnector !== undefined) void signIn(injectedConnector);
        }}
        onAuthenticate={() => {
          if (activeConnector !== undefined) void signIn(activeConnector);
        }}
        onSelectBaseSepolia={() => {
          selectNetwork(84532);
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
  } else if (stampId !== undefined) {
    page = <StampPage stampId={stampId} />;
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
          <span aria-hidden="true">B</span>
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
              ) : !authenticatedConnection && activeConnector !== undefined ? (
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
                onClick={() =>
                  baseConnector && void signIn(baseConnector)
                }
                disabled={authBusy || networkBusy || baseConnector === undefined}
              >
                {t("auth.signInBase")}
              </button>
              {injectedConnector !== undefined && (
                <button
                  className="compact secondary"
                  type="button"
                  onClick={() => void signIn(injectedConnector)}
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
          aria-live={authFeedback.tone === "error" ? "assertive" : "polite"}
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
