import { useEffect, useRef } from "react";
import { SPONSOR_TURNSTILE_ACTION } from "../lib/sponsor";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      appearance: "interaction-only";
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
      sitekey: string;
      size: "compact" | "flexible";
      theme: "auto";
      "timeout-callback"(): void;
    }
  ): string;
  reset(widgetId: string): void;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- browser global declaration merging is required.
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoader: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) {
    return Promise.resolve(window.turnstile);
  }
  if (turnstileLoader !== undefined) return turnstileLoader;

  turnstileLoader = new Promise<TurnstileApi>((resolve, reject) => {
    const finish = () => {
      if (window.turnstile === undefined) {
        reject(new Error("Turnstile did not initialize."));
        return;
      }
      resolve(window.turnstile);
    };
    const existing = document.querySelector<HTMLScriptElement>(
      `#${TURNSTILE_SCRIPT_ID}`
    );
    if (existing !== null) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => {
          reject(new Error("Turnstile failed to load."));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => {
        reject(new Error("Turnstile failed to load."));
      },
      { once: true }
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    turnstileLoader = undefined;
    throw error;
  });
  return turnstileLoader;
}

export type TurnstileWidgetProperties = {
  accessibleLabel: string;
  onError: () => void;
  onTokenChange: (token: string | undefined) => void;
  resetKey: number;
  siteKey: string;
};

export function TurnstileWidget({
  accessibleLabel,
  onError,
  onTokenChange,
  resetKey,
  siteKey
}: TurnstileWidgetProperties) {
  const containerReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let widgetId: string | undefined;
    let api: TurnstileApi | undefined;
    let renderedSize: "compact" | "flexible" | undefined;
    let resizeObserver: ResizeObserver | undefined;
    onTokenChange(undefined);

    const renderWidget = (
      loadedApi: TurnstileApi,
      container: HTMLElement,
      size: "compact" | "flexible"
    ) => {
      if (widgetId !== undefined) loadedApi.remove(widgetId);
      onTokenChange(undefined);
      renderedSize = size;
      widgetId = loadedApi.render(container, {
        action: SPONSOR_TURNSTILE_ACTION,
        appearance: "interaction-only",
        callback: (token) => {
          onTokenChange(token);
        },
        "error-callback": () => {
          onTokenChange(undefined);
          onError();
        },
        "expired-callback": () => {
          onTokenChange(undefined);
        },
        sitekey: siteKey,
        size,
        theme: "auto",
        "timeout-callback": () => {
          onTokenChange(undefined);
        }
      });
    };

    void loadTurnstile()
      .then((loadedApi) => {
        const container = containerReference.current;
        if (disposed || container === null) return;
        api = loadedApi;
        const size = container.getBoundingClientRect().width < 300
          ? "compact"
          : "flexible";
        renderWidget(loadedApi, container, size);
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(([entry]) => {
            if (disposed || entry === undefined) return;
            const nextSize = entry.contentRect.width < 300
              ? "compact"
              : "flexible";
            if (nextSize !== renderedSize) {
              renderWidget(loadedApi, container, nextSize);
            }
          });
          resizeObserver.observe(container);
        }
      })
      .catch(() => {
        if (!disposed) onError();
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      onTokenChange(undefined);
      if (api !== undefined && widgetId !== undefined) {
        api.remove(widgetId);
      }
    };
  }, [onError, onTokenChange, resetKey, siteKey]);

  return (
    <div
      className="turnstile-widget"
      aria-label={accessibleLabel}
      ref={containerReference}
    />
  );
}
