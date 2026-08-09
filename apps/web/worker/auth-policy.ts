export type ParsedSiweFields = {
  domain?: string;
  uri?: string;
  version?: string;
  chainId?: number;
  nonce?: string;
  issuedAt?: Date;
  expirationTime?: Date;
  notBefore?: Date;
  requestId?: string;
  resources?: readonly string[];
  scheme?: string;
};

export type SiwePolicy = {
  domain: string;
  origin: string;
  chainId: number;
  now: Date;
  maxClockSkewMs: number;
  maxLifetimeMs: number;
};

export function validateSiweFields(
  fields: ParsedSiweFields,
  policy: SiwePolicy
): string | null {
  if (fields.domain !== policy.domain) return "domain";
  if (fields.uri !== policy.origin) return "uri";
  if (fields.version !== "1") return "version";
  if (fields.chainId !== policy.chainId) return "chain_id";
  if (typeof fields.nonce !== "string" || !/^[A-Za-z0-9]{8,}$/u.test(fields.nonce)) {
    return "nonce";
  }
  if (!(fields.issuedAt instanceof Date) || Number.isNaN(fields.issuedAt.getTime())) {
    return "issued_at";
  }
  if (
    !(fields.expirationTime instanceof Date) ||
    Number.isNaN(fields.expirationTime.getTime())
  ) {
    return "expiration_time";
  }

  const now = policy.now.getTime();
  const issuedAt = fields.issuedAt.getTime();
  const expiresAt = fields.expirationTime.getTime();
  if (issuedAt > now + policy.maxClockSkewMs) return "issued_at";
  if (issuedAt < now - policy.maxLifetimeMs) return "issued_at";
  if (expiresAt <= now || expiresAt > issuedAt + policy.maxLifetimeMs) {
    return "expiration_time";
  }
  if (fields.notBefore instanceof Date && fields.notBefore.getTime() > now) {
    return "not_before";
  }
  if (fields.requestId !== undefined || (fields.resources?.length ?? 0) > 0) {
    return "unsupported_extension";
  }

  const expectedScheme = new URL(policy.origin).protocol.slice(0, -1);
  if (fields.scheme !== undefined && fields.scheme !== expectedScheme) return "scheme";
  return null;
}
