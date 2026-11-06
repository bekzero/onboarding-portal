export const ZOHO_API_BASE_URL = "https://marketingautomation.zoho.com";
export const ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.com";
export const ZOHO_TOPICS_API_BASE_URL = "https://ma.zoho.com";
export const ZOHO_ORGANIZATION_ID = "org859403413";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ZohoErrorKind =
  | "CONFIGURATION"
  | "OAUTH"
  | "UNAUTHORIZED"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "INVALID_LIST"
  | "INVALID_TOPIC"
  | "INVALID_EMAIL"
  | "GROUP_EMAIL"
  | "MISSING_FIELD"
  | "INVALID_JOURNEY"
  | "INACTIVE_JOURNEY"
  | "INVALID_TRIGGER"
  | "PROVIDER";

export class ZohoApiError extends Error {
  constructor(
    message: string,
    readonly kind: ZohoErrorKind,
    readonly options: { providerCode?: string; retryAfterSeconds?: number; status?: number } = {}
  ) {
    super(message);
    this.name = "ZohoApiError";
  }
}

export type ZohoOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

function sanitizeProviderMessage(value: unknown) {
  if (typeof value !== "string") return "Zoho returned an error.";
  return value.replace(/(token|secret|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]").slice(0, 300);
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new ZohoApiError("Zoho returned an empty response.", "INVALID_RESPONSE", {
      status: response.status
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ZohoApiError("Zoho returned invalid JSON.", "INVALID_RESPONSE", {
      status: response.status
    });
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || controller.signal.aborted)) {
      throw new ZohoApiError("The Zoho request timed out.", "TIMEOUT");
    }
    throw new ZohoApiError("The Zoho request could not be completed.", "PROVIDER");
  } finally {
    clearTimeout(timeout);
  }
}

function requireOAuthConfig(config: ZohoOAuthConfig) {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new ZohoApiError("Zoho OAuth configuration is incomplete.", "CONFIGURATION");
  }
}

export class ZohoOAuthTokenManager {
  private cache: TokenCache | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly config: ZohoOAuthConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 10_000
  ) {}

  invalidate() {
    this.cache = null;
  }

  async getAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.cache && this.cache.expiresAt - 60_000 > this.now()) {
      return this.cache.accessToken;
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshAccessToken() {
    requireOAuthConfig(this.config);
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken
    });
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token`,
      {
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST"
      },
      this.timeoutMs
    );
    const payload = await parseJsonResponse(response);
    const record = isRecord(payload) ? payload : {};
    const accessToken = typeof record.access_token === "string" ? record.access_token : "";
    const expiresIn = Number(record.expires_in ?? 3600);

    if (!response.ok || !accessToken) {
      throw new ZohoApiError(
        sanitizeProviderMessage(record.error_description ?? record.error ?? "Zoho OAuth refresh failed."),
        "OAUTH",
        { status: response.status }
      );
    }

    this.cache = {
      accessToken,
      expiresAt: this.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000
    };
    return accessToken;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerCode(payload: unknown) {
  if (!isRecord(payload)) return undefined;
  const direct = payload.code;
  const nested = isRecord(payload.response) ? payload.response.code : undefined;
  return direct === undefined && nested === undefined ? undefined : String(direct ?? nested);
}

function providerMessage(payload: unknown) {
  if (!isRecord(payload)) return undefined;
  const direct = payload.message;
  const nested = isRecord(payload.response) ? payload.response.message : undefined;
  return typeof (direct ?? nested) === "string" ? String(direct ?? nested) : undefined;
}

function classifyProviderError(response: Response, payload: unknown): ZohoApiError {
  const code = providerCode(payload);
  const message = sanitizeProviderMessage(providerMessage(payload) ?? `Zoho request failed (${response.status}).`);
  const retryAfter = Number(response.headers.get("retry-after"));
  const options = {
    providerCode: code,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    status: response.status
  };

  if (response.status === 401 || code === "401") return new ZohoApiError(message, "UNAUTHORIZED", options);
  if (response.status === 429 || code === "2008") return new ZohoApiError(message, "RATE_LIMIT", options);
  if (["2501", "2502"].includes(code ?? "")) return new ZohoApiError(message, "INVALID_LIST", options);
  if (code === "2004" || code === "5004") return new ZohoApiError(message, "INVALID_EMAIL", options);
  if (code === "2005" || code === "5003") return new ZohoApiError(message, "GROUP_EMAIL", options);
  if (["900", "903", "9007"].includes(code ?? "")) return new ZohoApiError(message, "MISSING_FIELD", options);
  if (["9001", "9002"].includes(code ?? "")) return new ZohoApiError(message, "INVALID_JOURNEY", options);
  if (code === "9006") return new ZohoApiError(message, "INACTIVE_JOURNEY", options);
  if (code === "9008") return new ZohoApiError(message, "INVALID_TRIGGER", options);
  if (/topic/i.test(message) && /invalid|missing|not found/i.test(message)) {
    return new ZohoApiError(message, "INVALID_TOPIC", options);
  }
  return new ZohoApiError(message, "PROVIDER", options);
}

export type ZohoLeadField = {
  allowedValues: string[] | null;
  dataType: string | null;
  displayName: string;
  fieldId: string | null;
  fieldName: string;
};

export type ZohoMailingList = {
  isPublic: boolean | null;
  listKey: string;
  listName: string;
  owner: string | null;
};

export type ZohoTopic = {
  primaryList: string | null;
  topicId: string;
  topicName: string;
};

export type ZohoJourney = {
  journeyKey: string;
  journeyName: string;
  triggerKey: string;
};

export type ZohoListLead = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type ZohoSubscribeResult = {
  classification: "PENDING_CONFIRMATION" | "ACCEPTED_UNCONFIRMED";
  code: string;
  message: string;
};

export type ZohoTriggerResult = {
  classification: "TRIGGERED" | "ALREADY_TRIGGERED" | "IGNORED";
  code: string;
};

function emailList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase());
}

export function parseTriggerResult(payload: unknown, recipientEmail: string): ZohoTriggerResult {
  if (!isRecord(payload)) throw new ZohoApiError("Zoho trigger response is invalid.", "INVALID_RESPONSE");
  const code = String(payload.code ?? "");
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  if (code !== "200" || status !== "success") {
    throw classifyProviderError(new Response(null, { status: 400 }), payload);
  }
  const recipient = recipientEmail.trim().toLowerCase();
  const matches = [
    ["TRIGGERED", emailList(payload.triggered_leads)],
    ["ALREADY_TRIGGERED", emailList(payload.already_triggered)],
    ["IGNORED", emailList(payload.ignored_leads)]
  ].filter(([, emails]) => (emails as string[]).includes(recipient));
  if (matches.length !== 1) {
    throw new ZohoApiError("Zoho did not return one unambiguous result for the requested lead.", "INVALID_RESPONSE");
  }
  return { classification: matches[0][0] as ZohoTriggerResult["classification"], code };
}

export function classifyZohoListMembership(
  statuses: Array<"active" | "unsub" | "bounce">,
  truncated: boolean
) {
  if (statuses.includes("unsub") || statuses.includes("bounce")) return "INELIGIBLE" as const;
  if (statuses.length === 1 && statuses[0] === "active" && !truncated) return "MANUAL_REVIEW" as const;
  return "MANUAL_REVIEW" as const;
}

export function parseLeadFields(payload: unknown): ZohoLeadField[] {
  if (!isRecord(payload)) throw new ZohoApiError("Zoho field response is invalid.", "INVALID_RESPONSE");
  const response = isRecord(payload.response) ? payload.response : payload;
  const fields = response.fieldname;
  if (!Array.isArray(fields)) throw new ZohoApiError("Zoho field response has no field list.", "INVALID_RESPONSE");

  return fields.map((item) => {
    if (!isRecord(item) || typeof item.DISPLAY_NAME !== "string" || typeof item.FIELD_NAME !== "string") {
      throw new ZohoApiError("Zoho returned an invalid field entry.", "INVALID_RESPONSE");
    }
    const dataType = item.DATA_TYPE ?? item.FIELD_TYPE ?? item.type;
    const rawAllowedValues = item.PICKLIST_VALUES ?? item.picklist_values ?? item.VALUES ?? item.values;
    return {
      allowedValues: Array.isArray(rawAllowedValues)
        ? rawAllowedValues
            .map((value) => isRecord(value) ? value.value ?? value.display_value ?? value.label : value)
            .filter((value): value is string => typeof value === "string")
        : null,
      dataType: typeof dataType === "string" ? dataType : null,
      displayName: item.DISPLAY_NAME,
      fieldId: item.FIELD_ID === undefined ? null : String(item.FIELD_ID),
      fieldName: item.FIELD_NAME
    };
  });
}

export function parseMailingLists(payload: unknown): ZohoMailingList[] {
  if (!isRecord(payload) || !Array.isArray(payload.list_of_details)) {
    throw new ZohoApiError("Zoho mailing-list response has no list details.", "INVALID_RESPONSE");
  }
  return payload.list_of_details.map((item) => {
    if (!isRecord(item) || typeof item.listkey !== "string" || typeof item.listname !== "string") {
      throw new ZohoApiError("Zoho returned an invalid mailing-list entry.", "INVALID_RESPONSE");
    }
    const publicValue = item.is_public;
    return {
      isPublic:
        typeof publicValue === "boolean"
          ? publicValue
          : typeof publicValue === "string" && ["true", "false"].includes(publicValue.toLowerCase())
            ? publicValue.toLowerCase() === "true"
            : null,
      listKey: item.listkey,
      listName: item.listname,
      owner: typeof item.owner === "string" ? item.owner : null
    };
  });
}

export function parseTopics(payload: unknown): ZohoTopic[] {
  if (!isRecord(payload) || !Array.isArray(payload.topicDetails)) {
    throw new ZohoApiError("Zoho topic response has no topic details.", "INVALID_RESPONSE");
  }
  return payload.topicDetails.map((item) => {
    if (!isRecord(item) || item.topicId === undefined || typeof item.topicName !== "string") {
      throw new ZohoApiError("Zoho returned an invalid topic entry.", "INVALID_RESPONSE");
    }
    return {
      primaryList: item.primaryList === undefined || item.primaryList === null ? null : String(item.primaryList),
      topicId: String(item.topicId),
      topicName: item.topicName
    };
  });
}

export function parseJourneys(payload: unknown): ZohoJourney[] {
  if (!isRecord(payload) || !Array.isArray(payload.journeys)) {
    throw new ZohoApiError("Zoho journey response has no journey list.", "INVALID_RESPONSE");
  }
  return payload.journeys.map((item) => {
    if (!isRecord(item)) throw new ZohoApiError("Zoho returned an invalid journey entry.", "INVALID_RESPONSE");
    const triggerKey = item.triggerkey ?? item.trigger_key;
    if (
      typeof item.journey_key !== "string" ||
      typeof item.journey_name !== "string" ||
      typeof triggerKey !== "string"
    ) {
      throw new ZohoApiError("Zoho returned an incomplete journey entry.", "INVALID_RESPONSE");
    }
    return {
      journeyKey: item.journey_key,
      journeyName: item.journey_name,
      triggerKey
    };
  });
}

export function parseListLeads(payload: unknown): ZohoListLead[] {
  if (!isRecord(payload) || !Array.isArray(payload.list_of_details)) {
    throw new ZohoApiError("Zoho list-lead response has no lead list.", "INVALID_RESPONSE");
  }
  return payload.list_of_details.map((item) => {
    if (!isRecord(item) || typeof item.lead_email !== "string") {
      throw new ZohoApiError("Zoho returned an invalid lead entry.", "INVALID_RESPONSE");
    }
    return {
      email: item.lead_email,
      firstName: typeof item.firstname === "string" ? item.firstname : null,
      lastName: typeof item.lastname === "string" ? item.lastname : null
    };
  });
}

export function parseSubscribeResult(payload: unknown): ZohoSubscribeResult {
  if (!isRecord(payload)) throw new ZohoApiError("Zoho subscribe response is invalid.", "INVALID_RESPONSE");
  const code = String(payload.code ?? "");
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  if (!(code === "0" || code === "200") || status !== "success") {
    throw classifyProviderError(new Response(null, { status: 400 }), payload);
  }
  return {
    classification: /confirmation/i.test(message) ? "PENDING_CONFIRMATION" : "ACCEPTED_UNCONFIRMED",
    code,
    message: sanitizeProviderMessage(message || "Zoho accepted the contact request.")
  };
}

export class ZohoApiClientCore {
  constructor(
    private readonly tokenManager: ZohoOAuthTokenManager,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 10_000
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
    allowAuthRetry = true,
    baseUrl = ZOHO_API_BASE_URL
  ): Promise<unknown> {
    const accessToken = await this.tokenManager.getAccessToken();
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${baseUrl}${path}`,
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Zoho-oauthtoken ${accessToken}`
        }
      },
      this.timeoutMs
    );
    const payload = await parseJsonResponse(response);

    const code = providerCode(payload);
    if ((response.status === 401 || code === "401") && allowAuthRetry) {
      this.tokenManager.invalidate();
      await this.tokenManager.getAccessToken(true);
      return this.request(path, init, false, baseUrl);
    }
    if (!response.ok || (code && !["0", "200"].includes(code))) {
      throw classifyProviderError(response, payload);
    }
    return payload;
  }

  async getAllLeadFields() {
    const payload = await this.request("/api/v1/lead/allfields?type=json");
    return parseLeadFields(payload);
  }

  async getOpenJourneys() {
    const details = encodeURIComponent(
      JSON.stringify({ page: "1", limit: "100", sort_order: "asc", user: "all", trigger_type: "open" })
    );
    const payload = await this.request(`/api/v1/journeys?details=${details}`);
    return parseJourneys(payload);
  }

  async getMailingLists() {
    const body = new URLSearchParams({ fromindex: "1", range: "200", resfmt: "JSON", sort: "asc" });
    const payload = await this.request("/api/v1/getmailinglists", {
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    });
    return parseMailingLists(payload);
  }

  async getTopics() {
    const details = encodeURIComponent(JSON.stringify({ from_index: 0, range: 200 }));
    const payload = await this.request(`/api/v1/topics?details=${details}`, {}, true, ZOHO_TOPICS_API_BASE_URL);
    return parseTopics(payload);
  }

  async getListLeads(input: {
    fromIndex: number;
    listKey: string;
    range: number;
    status: "active" | "unsub" | "bounce";
  }) {
    const query = new URLSearchParams({
      fromindex: String(input.fromIndex),
      listkey: input.listKey,
      range: String(input.range),
      resfmt: "JSON",
      sort: "asc",
      status: input.status
    });
    const payload = await this.request(`/api/v1/getleads?${query.toString()}`);
    return parseListLeads(payload);
  }

  async subscribeLead(input: {
    leadInfo: Record<string, string | number>;
    listKey: string;
    topicId: string;
  }) {
    const body = new URLSearchParams({
      leadinfo: JSON.stringify(input.leadInfo),
      listkey: input.listKey,
      resfmt: "JSON",
      sources: "Onboarding Portal",
      topic_id: input.topicId
    });
    const payload = await this.request("/api/v1/json/listsubscribe", {
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    });
    return parseSubscribeResult(payload);
  }

  async triggerJourney(input: {
    journeyKey: string;
    leadEmail: string;
    listKey: string;
    triggerKey: string;
  }) {
    const details = encodeURIComponent(JSON.stringify({
      lead_email: input.leadEmail,
      listkey: input.listKey,
      triggerkey: input.triggerKey
    }));
    const payload = await this.request(
      `/api/v1/journeys/${encodeURIComponent(input.journeyKey)}/action/trigger?details=${details}`,
      { headers: { "content-type": "application/x-www-form-urlencoded" }, method: "POST" }
    );
    return parseTriggerResult(payload, input.leadEmail);
  }
}
