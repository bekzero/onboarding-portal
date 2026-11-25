import { createHash } from "node:crypto";

export type ZohoJ1Keys = { journeyKey: string; triggerKey: string };

export function fingerprintZohoJ1Keys(keys: ZohoJ1Keys) {
  return createHash("sha256")
    .update(`${keys.journeyKey}\u0000${keys.triggerKey}`, "utf8")
    .digest("hex");
}

export function selectControlledTestJ1Keys(input: {
  production: ZohoJ1Keys;
  productionKeysVerified: boolean;
  productionReuseEnabled: boolean;
  test: ZohoJ1Keys;
}) {
  if (input.productionReuseEnabled) {
    if (
      !input.productionKeysVerified ||
      !input.production.journeyKey ||
      !input.production.triggerKey
    ) {
      return { configured: false, keys: null, mode: "INVALID" as const };
    }
    return {
      configured: true,
      keys: input.production,
      mode: "VERIFIED_PRODUCTION_REUSE" as const
    };
  }
  if (
    input.test.journeyKey &&
    input.test.triggerKey &&
    input.test.journeyKey !== input.production.journeyKey &&
    input.test.triggerKey !== input.production.triggerKey
  ) {
    return { configured: true, keys: input.test, mode: "DISTINCT_TEST" as const };
  }
  return { configured: false, keys: null, mode: "INVALID" as const };
}
