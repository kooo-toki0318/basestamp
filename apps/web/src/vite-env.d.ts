/// <reference types="vite/client" />

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Vite declaration merging is required.
interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
  readonly VITE_BASE_BUILDER_CODE?: string;
  readonly VITE_MAINNET_WRITES_ENABLED?: string;
  readonly VITE_SECURITY_CONTACT_URL?: string;
  readonly VITE_SPONSOR_ENABLED?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Vite declaration merging is required.
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
