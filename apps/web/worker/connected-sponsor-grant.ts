import { getAddress, isAddress, type Address } from "viem";
import type { SupportedChainId } from "../src/lib/networks";
import { SPONSOR_TURNSTILE_ACTION } from "../src/lib/sponsor";
import { ApiError, assertExactKeys, readJsonObject } from "./http";
import {
  createD1SponsorGrantRepository,
  getSponsorConfig,
  issueSponsorGrant,
  requireSponsorIdempotencyKey,
  requireTurnstileToken,
  type IssueSponsorGrantArguments
} from "./sponsor";
import { verifyTurnstileToken, type TurnstileVerifier } from "./turnstile";
import type { Bindings } from "./types";

const SUPPORTED_CHAINS = new Set<number>([8453, 84532]);

type SponsorGrantIssuer = (
  env: Bindings,
  arguments_: Omit<IssueSponsorGrantArguments, "repository">
) => ReturnType<typeof issueSponsorGrant>;

type ConnectedSponsorGrantDependencies = {
  issueGrant?: SponsorGrantIssuer;
  verifyTurnstile?: TurnstileVerifier;
};

function requireOrigin(request: Request, env: Bindings): void {
  const allowedOrigin = env.SIWE_ALLOWED_ORIGIN?.trim() ?? "";
  if (allowedOrigin === "" || request.headers.get("origin") !== allowedOrigin) {
    throw new ApiError(
      403,
      "origin_rejected",
      "Request origin is not allowed."
    );
  }
}

function requireChainId(value: unknown): SupportedChainId {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !SUPPORTED_CHAINS.has(value)
  ) {
    throw new ApiError(
      400,
      "invalid_sponsor_request",
      "Sponsor request is invalid."
    );
  }
  return value as SupportedChainId;
}

function requireWalletAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new ApiError(
      400,
      "invalid_sponsor_request",
      "Sponsor request is invalid."
    );
  }
  return getAddress(value);
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function handleConnectedSponsorGrant(
  request: Request,
  env: Bindings,
  dependencies: ConnectedSponsorGrantDependencies = {}
): Promise<Response> {
  try {
    const config = getSponsorConfig(env);
    requireOrigin(request, env);
    const body = await readJsonObject(request);
    assertExactKeys(body, [
      "chainId",
      "idempotencyKey",
      "turnstileToken",
      "walletAddress"
    ]);

    const chainId = requireChainId(body.chainId);
    const walletAddress = requireWalletAddress(body.walletAddress);
    const idempotencyKey = requireSponsorIdempotencyKey(body.idempotencyKey);
    const turnstileToken = requireTurnstileToken(body.turnstileToken);
    const remoteIp = request.headers.get("CF-Connecting-IP") ?? undefined;
    const verifyTurnstile =
      dependencies.verifyTurnstile ?? verifyTurnstileToken;
    const issueGrant: SponsorGrantIssuer =
      dependencies.issueGrant ??
      ((workerEnv, arguments_) =>
        issueSponsorGrant({
          ...arguments_,
          repository: createD1SponsorGrantRepository(workerEnv.DB)
        }));

    const grant = await issueGrant(env, {
      action: SPONSOR_TURNSTILE_ACTION,
      chainId,
      config,
      idempotencyKey,
      verifyHuman: () =>
        verifyTurnstile({
          allowedHostnames: config.allowedHostnames,
          ...(remoteIp === undefined ? {} : { remoteIp }),
          secret: config.turnstileSecret,
          token: turnstileToken
        }),
      walletAddress
    });

    return jsonResponse(grant);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(
        {
          error: {
            code: error.code,
            message: error.message
          }
        },
        error.status
      );
    }
    console.error(
      JSON.stringify({ event: "connected_sponsor_grant_unexpected_error" })
    );
    return jsonResponse(
      {
        error: {
          code: "internal_error",
          message: "Request could not be completed."
        }
      },
      500
    );
  }
}
