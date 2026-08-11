type StringBindingKey = {
  [Key in keyof Env]-?: Env[Key] extends string ? Key : never;
}[keyof Env];

type OptionalSponsorSecrets = Partial<{
  BASE_BUILDER_CODE: string;
  CDP_PAYMASTER_URL: string;
  IP_BUCKET_HMAC_SECRET: string;
  SPONSOR_ID_HMAC_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
}>;

export type Bindings = Omit<Env, StringBindingKey> &
  Partial<Record<StringBindingKey, string>> &
  OptionalSponsorSecrets;

export type AuthConfig = {
  domain: string;
  origin: string;
  chainIds: readonly (8453 | 84532)[];
  sessionHashSecret: string;
};
