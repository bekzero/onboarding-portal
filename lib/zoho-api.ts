import "server-only";
import {
  ZohoApiClientCore,
  ZohoApiError,
  ZohoOAuthTokenManager
} from "@/lib/zoho-api-core";
import { getZohoOAuthConfig } from "@/lib/zoho-config";

let client: ZohoApiClientCore | null = null;

export function getZohoApiClient() {
  if (!client) {
    const tokenManager = new ZohoOAuthTokenManager(getZohoOAuthConfig());
    client = new ZohoApiClientCore(tokenManager);
  }
  return client;
}

export function getSanitizedZohoError(error: unknown) {
  if (error instanceof ZohoApiError) {
    return {
      kind: error.kind,
      message: error.message,
      providerCode: error.options.providerCode,
      retryAfterSeconds: error.options.retryAfterSeconds,
      status: error.options.status
    };
  }
  return { kind: "UNEXPECTED" as const, message: "An unexpected Zoho integration error occurred." };
}

export function getZohoApiErrorStatus(error: unknown) {
  if (!(error instanceof ZohoApiError)) return 500;
  if (error.kind === "CONFIGURATION") return 503;
  if (["INVALID_EMAIL", "GROUP_EMAIL", "MISSING_FIELD"].includes(error.kind)) return 400;
  if (error.kind === "RATE_LIMIT") return 429;
  if (error.kind === "TIMEOUT") return 504;
  if (error.kind === "UNAUTHORIZED" || error.kind === "OAUTH") return 502;
  return 502;
}
