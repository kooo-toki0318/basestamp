import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import type { Connector } from "wagmi";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain
} from "wagmi";
import { createSiweMessage } from "viem/siwe";
import type { Session } from "./auth-types";
import { CreatePage } from "./pages/CreatePage";
import { HomePage } from "./pages/HomePage";
import { StampPage } from "./pages/StampPage";
import { VerifyStartPage } from "./pages/VerifyStartPage";
import {
  BASE_NETWORKS,
  chainName,
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

type NonceResponse = {
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expirationTime: string;
};

function shortAddress(address: string): string {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const value = (await response.json()) as
    | T
    | { error?: { message?: string } };
  if (!response.ok) {
    const errorValue = value as { error?: { message?: string } };
    const message = errorValue.error?.message ?? "Request failed.";
    throw new Error(message);
  }
  return value as T;
}

function currentStampId(): Hex | undefined {
  const match = /^\/stamps\/(0x[0-9a-fA-F]{64})\/?$/u.exec(
    window.location.pathname
  );
  return match?.[1]?.toLowerCase() as Hex | undefined;
}

export function App() {
  const {
    address,
    chainId: walletChainId,
    connector: activeConnector
  } = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connectAsync } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: switchChainAsync } = useSwitchChain();
  const [session, setSession] = useState<Session>({ authenticated: false });
  const [authStatus, setAuthStatus] = useState("Ready");
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedChainId, setSelectedChainId] =
    useState<SupportedChainId>(84532);
  const lastAutoSwitch = useRef<string | undefined>(undefined);
  const selectedNetwork = getBaseNetwork(selectedChainId);

  useEffect(() => {
    void fetch("/api/session", { credentials: "include" })
      .then((response) => parseJsonResponse<Session>(response))
      .then(setSession)
      .catch(() => {
        setSession({ authenticated: false });
      });
  }, []);

  useEffect(() => {
    if (
      address === undefined ||
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

    void Promise.resolve().then(async () => {
      setAuthStatus(`Switching wallet to ${selectedNetwork.name}…`);
      try {
        await switchChainAsync({ chainId: selectedChainId });
        const signInAgain =
          session.authenticated && session.chainId !== selectedChainId
            ? " Sign in again for this network."
            : "";
        setAuthStatus(
          `Wallet network automatically changed to ${selectedNetwork.name}.${signInAgain}`
        );
      } catch (error) {
        setAuthStatus(
          error instanceof Error
            ? `Automatic network switch failed: ${error.message}`
            : "Automatic network switch failed."
        );
      }
    });
  }, [
    address,
    selectedChainId,
    selectedNetwork.name,
    session,
    switchChainAsync,
    walletChainId
  ]);

  function selectNetwork(value: number): void {
    if (!isSupportedChainId(value)) return;
    lastAutoSwitch.current = undefined;
    setSelectedChainId(value);
    if (address === undefined) {
      setAuthStatus(
        `${getBaseNetwork(value).name} selected. The wallet will switch after connection.`
      );
    }
  }

  async function signIn(connector: Connector): Promise<void> {
    const reuseConnection =
      address !== undefined && activeConnector?.uid === connector.uid;

    setAuthBusy(true);
    setAuthStatus(
      reuseConnection
        ? `Preparing authentication on ${selectedNetwork.name}…`
        : `Connecting your wallet to ${selectedNetwork.name}…`
    );
    try {
      let account: Address;
      let connectedChainId: number;
      if (reuseConnection) {
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
        setAuthStatus(`Switching wallet to ${selectedNetwork.name}…`);
        await switchChainAsync({ chainId: selectedChainId });
      }

      setAuthStatus("Requesting a one-time nonce…");
      const nonce = await fetch("/api/auth/nonce", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: selectedChainId })
      }).then((response) => parseJsonResponse<NonceResponse>(response));

      const message = createSiweMessage({
        address: account,
        chainId: nonce.chainId,
        domain: nonce.domain,
        uri: nonce.uri,
        version: "1",
        nonce: nonce.nonce,
        issuedAt: new Date(nonce.issuedAt),
        expirationTime: new Date(nonce.expirationTime),
        statement: "Sign in to BaseStamp. This does not authorize a transaction."
      });

      setAuthStatus("Confirm the sign-in message in your wallet…");
      const provider = (await connector.getProvider()) as
        | PersonalSignProvider
        | null
        | undefined;
      if (provider == null) throw new Error("Wallet provider is unavailable.");
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, account]
      });
      if (typeof signature !== "string") {
        throw new Error("Wallet returned an invalid signature.");
      }

      setAuthStatus("Verifying the signature…");
      const authenticated = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature })
      }).then((response) => parseJsonResponse<Session>(response));
      setSession(authenticated);
      setAuthStatus("Signed in");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function disconnectWallet(): Promise<void> {
    setAuthBusy(true);
    let nextStatus = "Disconnected.";
    try {
      if (session.authenticated) {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }).then((response) => parseJsonResponse<Session>(response));
      }
    } catch (error) {
      nextStatus =
        error instanceof Error
          ? `Wallet disconnected. Server sign-out failed: ${error.message}`
          : "Wallet disconnected. Server sign-out failed.";
    } finally {
      setSession({ authenticated: false });
      disconnect();
      setAuthStatus(nextStatus);
      setAuthBusy(false);
    }
  }

  async function copyAddress(): Promise<void> {
    if (address === undefined) return;
    try {
      await navigator.clipboard.writeText(address);
      setAuthStatus("Wallet address copied.");
    } catch {
      setAuthStatus("Could not copy the wallet address.");
    }
  }

  const baseConnector = connectors.find(
    (connector) => connector.id === "baseAccount"
  );
  const injectedConnector = connectors.find(
    (connector) => connector.id !== "baseAccount"
  );
  const authenticatedConnection =
    session.authenticated &&
    session.walletAddress.toLowerCase() === address?.toLowerCase() &&
    session.chainId === selectedChainId;
  const stampId = currentStampId();
  const path = window.location.pathname;

  let page: React.ReactNode;
  if (path === "/" || path === "") {
    page = <HomePage />;
  } else if (path === "/create" || path === "/create/") {
    page = (
      <CreatePage
        address={address}
        selectedChainId={selectedChainId}
        session={session}
      />
    );
  } else if (path === "/verify" || path === "/verify/") {
    page = <VerifyStartPage />;
  } else if (stampId !== undefined) {
    page = <StampPage stampId={stampId} />;
  } else {
    page = (
      <section className="shell workspace">
        <p className="eyebrow">404</p>
        <h1>Page not found.</h1>
        <a href="/">Return home</a>
      </section>
    );
  }

  return (
    <>
      <header className="shell nav">
        <a className="brand" href="/" aria-label="BaseStamp home">
          <span aria-hidden="true">B</span>
          BaseStamp
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          <a href="/create">Create</a>
          <a href="/verify">Verify</a>
          <label className="network-picker">
            <span>Network</span>
            <select
              value={selectedChainId}
              onChange={(event) => {
                selectNetwork(Number(event.target.value));
              }}
              disabled={authBusy}
            >
              {BASE_NETWORKS.map((network) => (
                <option key={network.chainId} value={network.chainId}>
                  {network.name} · {network.environment}
                </option>
              ))}
            </select>
          </label>
        </nav>
        <div className="auth-area">
          {address !== undefined ? (
            <>
              {!authenticatedConnection && activeConnector !== undefined && (
                <button
                  className="compact"
                  type="button"
                  onClick={() => void signIn(activeConnector)}
                  disabled={authBusy}
                >
                  Authenticate
                </button>
              )}
              <div
                className="wallet-identity"
                title={authenticatedConnection ? "Connected and authenticated" : "Connected"}
              >
                <span className="wallet-address" title={address}>
                  {shortAddress(address)}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void copyAddress()}
                  disabled={authBusy}
                  aria-label="Copy wallet address"
                  title="Copy wallet address"
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
                disabled={authBusy}
              >
                Disconnect
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
                disabled={authBusy || baseConnector === undefined}
              >
                Sign in with Base
              </button>
              {injectedConnector !== undefined && (
                <button
                  className="compact secondary"
                  type="button"
                  onClick={() => void signIn(injectedConnector)}
                  disabled={authBusy}
                >
                  Browser wallet
                </button>
              )}
            </>
          )}
        </div>
      </header>
      <div className="shell auth-status" role="status" aria-live="polite">
        {authStatus}
        {address === undefined
          ? ""
          : ` · ${shortAddress(address)} · Wallet: ${chainName(walletChainId)}`}
      </div>
      <main>{page}</main>
      <footer className="shell footer">
        <span>BaseStamp · local-first records on Base</span>
        <span>Not notarization, identity verification, or legal advice.</span>
      </footer>
    </>
  );
}
