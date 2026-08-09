const MAX_JSON_BYTES = 20_000;

export class ApiError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 413 | 415 | 503;

  constructor(
    status: 400 | 403 | 413 | 415 | 503,
    code: string,
    message: string
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }

  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(400, "invalid_body", "Expected a JSON object.");
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ApiError(400, "invalid_body", "Unsupported JSON object.");
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): void {
  const keys = Object.keys(value).sort();
  const accepted = [...expected].sort();
  if (
    keys.length !== accepted.length ||
    keys.some((key, index) => key !== accepted[index])
  ) {
    throw new ApiError(400, "invalid_body", "Request fields do not match the schema.");
  }
}
