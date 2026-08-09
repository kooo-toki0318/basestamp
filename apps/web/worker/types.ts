export type Bindings = {
  DB: D1Database;
  APP_ENV?: string;
  MAINNET_WRITES_ENABLED?: string;
  SPONSOR_ENABLED?: string;
  X402_TESTNET_ENABLED?: string;
  X402_MAINNET_ENABLED?: string;
  SIWE_ALLOWED_DOMAIN?: string;
  SIWE_ALLOWED_ORIGIN?: string;
  SIWE_CHAIN_IDS?: string;
  SESSION_HASH_SECRET?: string;
};

export type AuthConfig = {
  domain: string;
  origin: string;
  chainIds: readonly (8453 | 84532)[];
  sessionHashSecret: string;
};
