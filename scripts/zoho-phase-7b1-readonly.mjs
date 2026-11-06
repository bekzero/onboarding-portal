import process from "node:process";
import { getPhase7aTarget, safeTargetSummary } from "./zoho-phase-7a-safety.mjs";
import { ZohoApiClientCore, ZohoOAuthTokenManager } from "../lib/zoho-api-core.ts";
import {
  assertPhase7b1ReadOnlyOperation,
  buildPhase7b1DiscoveryReport,
  evaluatePhase7b1Configuration
} from "../lib/zoho-phase7b1-readiness.ts";

const mode = process.argv[2] ?? "config";
if (!new Set(["config", "live"]).has(mode)) throw new Error(`Unknown Phase 7B.1 mode: ${mode}`);

const target = getPhase7aTarget();
const configuration = evaluatePhase7b1Configuration(process.env);
console.log(JSON.stringify({
  configuration,
  mode,
  phase: "7B.1",
  target: safeTargetSummary(target)
}, null, 2));

if (mode === "config") {
  process.exitCode = configuration.readyForLiveReadOnlyCalls ? 0 : 2;
} else {
  if (!configuration.readyForLiveReadOnlyCalls) {
    throw new Error("Phase 7B.1 live read-only verification refused because configuration blockers remain.");
  }

  const manager = new ZohoOAuthTokenManager({
    clientId: process.env.ZOHO_CLIENT_ID.trim(),
    clientSecret: process.env.ZOHO_CLIENT_SECRET.trim(),
    refreshToken: process.env.ZOHO_REFRESH_TOKEN.trim()
  });
  const client = new ZohoApiClientCore(manager);

  ["GET_ALL_LEAD_FIELDS", "GET_MAILING_LISTS", "GET_TOPICS", "GET_OPEN_JOURNEYS"]
    .forEach(assertPhase7b1ReadOnlyOperation);

  // These are the only provider operations allowed by this harness. It has no
  // contact-subscribe or journey-trigger branch.
  const [fields, lists, topics, journeys] = await Promise.all([
    client.getAllLeadFields(),
    client.getMailingLists(),
    client.getTopics(),
    client.getOpenJourneys()
  ]);

  console.log(JSON.stringify({
    authenticatedReadOnlyCallsSucceeded: true,
    organizationIdentity: {
      expected: process.env.ZOHO_PHASE7B1_EXPECTED_ORGANIZATION,
      status: "MANUAL_EVIDENCE_DECLARED_API_DOES_NOT_RETURN_ORG_ID"
    },
    report: buildPhase7b1DiscoveryReport({ environment: process.env, fields, journeys, lists, topics })
  }, null, 2));
}
