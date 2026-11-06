import "server-only";
import { normalizeZohoRecipientEmail } from "@/lib/zoho-foundation";

function value(name: string) {
  return process.env[name]?.trim() || "";
}

export function getZohoListKey() {
  return value("ZMA_LIST_KEY") || value("ZOHO_MA_LIST_KEY");
}

export function getZohoTopicId() {
  return value("ZMA_TOPIC_ID") || value("ZOHO_MA_TOPIC_ID");
}

export function getZohoOAuthConfig() {
  return {
    clientId: value("ZOHO_CLIENT_ID"),
    clientSecret: value("ZOHO_CLIENT_SECRET"),
    refreshToken: value("ZOHO_REFRESH_TOKEN")
  };
}

export function getZohoJourneyConfiguration() {
  return {
    J1: { journeyKey: value("ZMA_J1_JOURNEY_KEY"), triggerKey: value("ZMA_J1_TRIGGER_KEY") },
    J3_R1: { journeyKey: value("ZMA_J3_JOURNEY_KEY"), triggerKey: value("ZMA_J3_TRIGGER_KEY") },
    J5: { journeyKey: value("ZMA_J5_JOURNEY_KEY"), triggerKey: value("ZMA_J5_TRIGGER_KEY") },
    J8: { journeyKey: value("ZMA_J8_JOURNEY_KEY"), triggerKey: value("ZMA_J8_TRIGGER_KEY") }
  } as const;
}

export function getZohoTestJourneyConfiguration() {
  return {
    J1: { journeyKey: value("ZMA_TEST_J1_JOURNEY_KEY"), triggerKey: value("ZMA_TEST_J1_TRIGGER_KEY") },
    J3_R1: { journeyKey: value("ZMA_TEST_J3_JOURNEY_KEY"), triggerKey: value("ZMA_TEST_J3_TRIGGER_KEY") },
    J5: { journeyKey: value("ZMA_TEST_J5_JOURNEY_KEY"), triggerKey: value("ZMA_TEST_J5_TRIGGER_KEY") },
    J8: { journeyKey: value("ZMA_TEST_J8_JOURNEY_KEY"), triggerKey: value("ZMA_TEST_J8_TRIGGER_KEY") }
  } as const;
}

function enabled(name: string) {
  return value(name).toLowerCase() === "true";
}

export function getZohoDispatchConfiguration() {
  const modeValue = value("ZOHO_DISPATCH_MODE").toLowerCase();
  const mode = modeValue === "test" || modeValue === "production" ? modeValue : "disabled";
  const batch = Number(value("ZOHO_DISPATCH_BATCH_SIZE") || 10);
  const lease = Number(value("ZOHO_DISPATCH_LEASE_SECONDS") || 120);
  return {
    automaticDispatchEnabled: enabled("ZOHO_AUTOMATIC_DISPATCH_ENABLED"),
    batchSize: Math.max(1, Math.min(25, Number.isFinite(batch) ? Math.trunc(batch) : 10)),
    contactSyncEnabled: enabled("ZOHO_CONTACT_SYNC_ENABLED") || enabled("ZOHO_DISPATCH_ENABLED"),
    globalKillSwitch: !process.env.ZOHO_GLOBAL_KILL_SWITCH || enabled("ZOHO_GLOBAL_KILL_SWITCH"),
    journeyTriggeringEnabled: enabled("ZOHO_JOURNEY_TRIGGERING_ENABLED"),
    leaseSeconds: Math.max(30, Math.min(600, Number.isFinite(lease) ? Math.trunc(lease) : 120)),
    mode,
    productionApproved: enabled("ZOHO_PRODUCTION_DISPATCH_APPROVED")
  } as const;
}

export function getZohoCronSecret() {
  return value("CRON_SECRET");
}

export function getZohoNudgeConfiguration() {
  const batch = Number(value("ZMA_NUDGE_EVALUATION_BATCH_SIZE") || 50);
  return {
    batchSize: Math.max(1, Math.min(100, Number.isFinite(batch) ? Math.trunc(batch) : 50)),
    enabled: enabled("ZMA_NUDGE_EVALUATION_ENABLED")
  } as const;
}

export function getZohoPublicPortalBaseUrl() {
  const configured = value("PORTAL_PUBLIC_BASE_URL") || value("AUTH_URL");
  if (!configured) return "";

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function getZohoTestConfiguration() {
  const emails = value("ZOHO_TEST_EMAIL_ALLOWLIST")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map(normalizeZohoRecipientEmail);
  const planIds = value("ZOHO_TEST_PLAN_IDS")
    .split(",")
    .map((planId) => planId.trim())
    .filter(Boolean);

  return {
    allowedEmails: new Set(emails),
    allowedPlanIds: new Set(planIds),
    enabled: value("ZOHO_TEST_SYNC_ENABLED").toLowerCase() === "true"
  };
}

export function getZohoConfigurationStatus() {
  const oauth = getZohoOAuthConfig();
  const journeys = getZohoJourneyConfiguration();
  const dispatch = getZohoDispatchConfiguration();
  return {
    automaticDispatchEnabled: dispatch.automaticDispatchEnabled,
    contactSynchronizationEnabled: dispatch.contactSyncEnabled,
    dispatchMode: dispatch.mode,
    eventEmissionEnabled:
      process.env.ZOHO_EVENT_EMISSION_ENABLED?.trim().toLowerCase() === "true",
    globalKillSwitch: dispatch.globalKillSwitch,
    journeyTriggeringEnabled: dispatch.journeyTriggeringEnabled,
    nudgeEvaluationEnabled: getZohoNudgeConfiguration().enabled,
    fieldMappingVerified: value("ZMA_FIELD_MAPPING_VERIFIED").toLowerCase() === "true",
    journeys: Object.fromEntries(
      Object.entries(journeys).map(([key, config]) => [
        key,
        { journeyKeyPresent: Boolean(config.journeyKey), triggerKeyPresent: Boolean(config.triggerKey) }
      ])
    ),
    listKeyPresent: Boolean(getZohoListKey()),
    listPrivacyVerified: value("ZMA_PRIVATE_LIST_VERIFIED").toLowerCase() === "true",
    oauthConfigured: Boolean(oauth.clientId && oauth.clientSecret && oauth.refreshToken),
    portalBaseUrlPresent: Boolean(getZohoPublicPortalBaseUrl()),
    testMode: {
      allowlistedEmailCount: getZohoTestConfiguration().allowedEmails.size,
      allowlistedPlanCount: getZohoTestConfiguration().allowedPlanIds.size,
      enabled: getZohoTestConfiguration().enabled
    },
    topicIdPresent: Boolean(getZohoTopicId())
  };
}
