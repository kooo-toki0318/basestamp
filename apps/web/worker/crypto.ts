import type { Hex } from "viem";

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(
  secret: string,
  value: string | Uint8Array
): Promise<string> {
  return toHex(
    await hmacSha256(
      secret,
      typeof value === "string" ? encoder.encode(value) : value
    )
  );
}

export async function hmacSha256(
  secret: string,
  value: Uint8Array
): Promise<Uint8Array> {
  const input = new Uint8Array(value);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, input);
  return new Uint8Array(digest);
}

export function randomHex32(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    "0x" +
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  ) as Hex;
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
