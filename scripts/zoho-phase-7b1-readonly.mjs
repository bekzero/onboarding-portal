import process from "node:process";
import { createHash } from "node:crypto";
import { getPhase7aTarget, safeTargetSummary } from "./zoho-phase-7a-safety.mjs";
import {
  ZOHO_API_BASE_URL,
  ZOHO_TOPICS_API_BASE_URL,
  ZohoApiClientCore,
  ZohoApiError,
  ZohoOAuthTokenManager
} from "../lib/zoho-api-core.ts";
import {
  assertPhase7b1ReadOnlyOperation,
  buildPhase7b1DiscoveryReport,
  evaluatePhase7b1Configuration,
  evaluatePhase7b1TopicBootstrapConfiguration,
  findExactPhase7b1Topic
} from "../lib/zoho-phase7b1-readiness.ts";

const mode = process.argv[2] ?? "config";
if (!new Set([
  "config",
  "live",
  "mailing-list-diagnostic",
  "oauth-grant-diagnostic",
  "topic-bootstrap-config",
  "topic-bootstrap",
  "topic-diagnostic"
]).has(mode)) {
  throw new Error(`Unknown Phase 7B.1 mode: ${mode}`);
}

const target = getPhase7aTarget();
const topicOperation = mode.startsWith("topic-bootstrap") ||
  mode === "topic-diagnostic" ||
  mode === "mailing-list-diagnostic" ||
  mode === "oauth-grant-diagnostic";
const configuration = topicOperation
  ? evaluatePhase7b1TopicBootstrapConfiguration(process.env)
  : evaluatePhase7b1Configuration(process.env);
console.log(JSON.stringify({
  configuration,
  mode,
  phase: "7B.1",
  target: safeTargetSummary(target)
}, null, 2));

if (mode === "config" || mode === "topic-bootstrap-config") {
  const ready = topicOperation
    ? configuration.readyForTopicBootstrap
    : configuration.readyForLiveReadOnlyCalls;
  process.exitCode = ready ? 0 : 2;
} else {
  const ready = topicOperation
    ? configuration.readyForTopicBootstrap
    : configuration.readyForLiveReadOnlyCalls;
  if (!ready) {
    throw new Error("Phase 7B.1 live read-only verification refused because configuration blockers remain.");
  }

  const manager = new ZohoOAuthTokenManager({
    clientId: process.env.ZOHO_CLIENT_ID.trim(),
    clientSecret: process.env.ZOHO_CLIENT_SECRET.trim(),
    refreshToken: process.env.ZOHO_REFRESH_TOKEN.trim()
  });
  const client = new ZohoApiClientCore(manager);

  if (mode === "oauth-grant-diagnostic") {
    await manager.getAccessToken(true);
    const fingerprint = (value) => `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
    console.log(JSON.stringify({
      credentialFingerprints: {
        clientId: fingerprint(process.env.ZOHO_CLIENT_ID),
        refreshToken: fingerprint(process.env.ZOHO_REFRESH_TOKEN)
      },
      oauthRefresh: manager.getLastRefreshDiagnostic(),
      organizationIdentity: {
        apiResponseIncludesOrganizationId: false,
        expected: process.env.ZOHO_PHASE7B1_EXPECTED_ORGANIZATION,
        verificationReferencePresent: true
      },
      tokenCache: "NEW_PROCESS_FORCED_REFRESH_NO_PERSISTENT_CACHE"
    }, null, 2));
    process.exit(0);
  }

  if (mode === "topic-bootstrap") {
    assertPhase7b1ReadOnlyOperation("GET_TOPICS");
    const topic = findExactPhase7b1Topic(await client.getTopics());
    console.log(JSON.stringify({
      authenticatedReadOnlyCallSucceeded: true,
      organizationIdentity: {
        expected: process.env.ZOHO_PHASE7B1_EXPECTED_ORGANIZATION,
        evidenceReferencePresent: true,
        status: "MANUAL_EVIDENCE_DECLARED_API_DOES_NOT_RETURN_ORG_ID"
      },
      topic: {
        primaryList: topic.primaryList,
        topicId: topic.topicId,
        topicName: topic.topicName
      }
    }, null, 2));
    process.exit(0);
  }

  if (mode === "topic-diagnostic") {
    assertPhase7b1ReadOnlyOperation("GET_TOPICS");
    const endpoints = [];
    for (const baseUrl of [ZOHO_TOPICS_API_BASE_URL, ZOHO_API_BASE_URL]) {
      try {
        const discovery = await client.discoverTopics({ baseUrl });
        const exactMatches = discovery.topics.filter((topic) => topic.topicName === "Partner Onboarding");
        endpoints.push({
          baseUrl,
          exactMatchCount: exactMatches.length,
          exactMatchTopicIds: exactMatches.map((topic) => topic.topicId),
          pages: discovery.pages,
          topicCount: discovery.topics.length
        });
      } catch (error) {
        endpoints.push({
          baseUrl,
          error: error instanceof ZohoApiError ? {
            kind: error.kind,
            message: error.message,
            providerCode: error.options.providerCode ?? null,
            status: error.options.status ?? null
          } : { kind: "UNEXPECTED", message: "The topic diagnostic failed unexpectedly." }
        });
      }
    }

    const ids = [...new Set(endpoints.flatMap((endpoint) => endpoint.exactMatchTopicIds ?? []))];
    const resolvedTopicId = ids.length === 1 && /^\d+$/.test(ids[0]) ? ids[0] : null;
    console.log(JSON.stringify({
      diagnostic: {
        endpoints,
        organization: {
          apiReturnsOrganizationId: false,
          expected: process.env.ZOHO_PHASE7B1_EXPECTED_ORGANIZATION,
          mismatchEvidence: endpoints.every((endpoint) => (endpoint.topicCount ?? 0) === 0)
            ? "POSSIBLE_WRONG_ORGANIZATION_OR_TOPIC_MODEL"
            : "NONE_FROM_THIS_ENDPOINT",
          verificationReferencePresent: true
        }
      },
      resolvedTopic: resolvedTopicId ? {
        topicId: resolvedTopicId,
        topicName: "Partner Onboarding"
      } : null
    }, null, 2));
    process.exitCode = resolvedTopicId ? 0 : 2;
  } else if (mode === "mailing-list-diagnostic") {
    assertPhase7b1ReadOnlyOperation("GET_MAILING_LISTS");
    try {
      const pages = [];
      const lists = [];
      let parseError = null;
      for (let page = 0; page < 10; page += 1) {
        const result = await client.inspectMailingListsPage({ fromIndex: 1 + page * 100, range: 100 });
        pages.push(result.diagnostic);
        if (!result.lists) {
          parseError = result.parseError;
          break;
        }
        lists.push(...result.lists);
        if (result.lists.length < 100) break;
      }
      const matches = lists.filter((list) => list.listName === "KZero Partner Onboarding");
      const list = matches.length === 1 ? matches[0] : null;
      const scopeRejected = pages.some((page) => page.code === "INVALID_OAUTHSCOPE");
      console.log(JSON.stringify({
        diagnostic: {
          expectedListExactMatchCount: matches.length,
          expectedListFound: Boolean(list),
          listCount: lists.length,
          pages,
          parseError
        },
        expectedList: list ? {
          isPublic: list.isPublic,
          listKeyReturned: Boolean(list.listKey),
          listName: list.listName,
          owner: list.owner
        } : null,
        organizationEvidence: scopeRejected ?
          "OAUTH_SCOPE_REJECTED_RESOURCE_ACCESS_NOT_TESTED" : list ?
          "EXPECTED_KZERO_RESOURCE_ACCESSIBLE_NOT_CONCLUSIVE_ORGANIZATION_PROOF" :
          "EXPECTED_KZERO_RESOURCE_NOT_VISIBLE_POSSIBLE_PORTAL_OR_ACCOUNT_MISMATCH"
      }, null, 2));
      process.exitCode = list ? 0 : 2;
    } catch (error) {
      console.log(JSON.stringify({
        diagnostic: {
          error: error instanceof ZohoApiError ? {
            kind: error.kind,
            message: error.message,
            providerCode: error.options.providerCode ?? null,
            status: error.options.status ?? null
          } : { kind: "UNEXPECTED", message: "The mailing-list diagnostic failed unexpectedly." }
        },
        expectedList: null,
        organizationEvidence: "UNAVAILABLE"
      }, null, 2));
      process.exitCode = 2;
    }
  } else {

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
}
