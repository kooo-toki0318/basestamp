type StringBindingKey = {
  [Key in keyof Env]-?: Env[Key] extends string ? Key : never;
}[keyof Env];

export type Bindings = Omit<Env, StringBindingKey> &
  Partial<Record<StringBindingKey, string>>;

export type AuthConfig = {
  domain: string;
  origin: string;
  chainIds: readonly (8453 | 84532)[];
  sessionHashSecret: string;
};
