import "server-only";

import { StaffSsoStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STAFF_SSO_CONFIGURATION_ID } from "@/lib/staff-sso-config";
import { expectedIssuerForRealm } from "@/lib/staff-sso-validation";

const MAX_DOCUMENT_BYTES = 256_000;

function trustedHttpsUrl(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is missing.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "ca.auth.kzero.com") throw new Error(`${label} is not a trusted KZero HTTPS endpoint.`);
  return url.toString();
}

export async function testStaffSsoDiscovery(actor: string) {
  const config = await prisma.staffSsoConfiguration.findUniqueOrThrow({ where: { id: STAFF_SSO_CONFIGURATION_ID } });
  if (config.issuerUrl !== expectedIssuerForRealm(config.realmName)) throw new Error("Configured issuer no longer matches the case-sensitive realm name.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${config.issuerUrl}/.well-known/openid-configuration`, { cache: "no-store", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Discovery returned HTTP ${response.status}.`);
    const length = Number(response.headers.get("content-length") || "0");
    if (length > MAX_DOCUMENT_BYTES) throw new Error("Discovery document exceeds the safe size limit.");
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new Error("Discovery document exceeds the safe size limit.");
    const document = JSON.parse(text) as Record<string, unknown>;
    if (document.issuer !== config.issuerUrl) throw new Error("Discovery issuer does not exactly match the configured issuer.");
    const authorizationEndpoint = trustedHttpsUrl(document.authorization_endpoint, "Authorization endpoint");
    const tokenEndpoint = trustedHttpsUrl(document.token_endpoint, "Token endpoint");
    const jwksUri = trustedHttpsUrl(document.jwks_uri, "JWKS endpoint");
    const responseTypes = Array.isArray(document.response_types_supported) ? document.response_types_supported : [];
    const challenges = Array.isArray(document.code_challenge_methods_supported) ? document.code_challenge_methods_supported : [];
    if (!responseTypes.includes("code")) throw new Error("Authorization Code flow is not advertised.");
    if (!challenges.includes("S256")) throw new Error("PKCE S256 is not advertised.");
    const evidence = { issuer: config.issuerUrl, authorizationEndpoint, tokenEndpoint, jwksUri, authorizationCode: true, pkceS256: true };
    await prisma.$transaction(async (tx) => {
      await tx.staffSsoConfiguration.update({ where: { id: config.id }, data: { status: config.status === StaffSsoStatus.ENABLED ? StaffSsoStatus.ENABLED : StaffSsoStatus.VALIDATED, discoveryValidatedAt: new Date(), discoveryEvidence: evidence } });
      await tx.staffSsoAudit.create({ data: { configurationId: config.id, actor, action: "DISCOVERY_VALIDATED", reason: "Trusted KZero discovery document validated.", metadata: evidence } });
    });
    return evidence;
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Discovery request timed out." : error instanceof Error ? error.message : "Discovery validation failed.";
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}
