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

export type ZohoOAuthRefreshDiagnostic = {
  apiDomain: string | null;
  grantedScope: string | null;
  responseKeys: string[];
  tokenType: string | null;
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
  private lastRefreshDiagnostic: ZohoOAuthRefreshDiagnostic | null = null;
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

  getLastRefreshDiagnostic() {
    return this.lastRefreshDiagnostic;
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
    this.lastRefreshDiagnostic = {
      apiDomain: typeof record.api_domain === "string" ? record.api_domain : null,
      grantedScope: typeof record.scope === "string" ? record.scope : null,
      responseKeys: Object.keys(record)
        .filter((key) => !/token|secret|authorization/i.test(key))
        .sort(),
      tokenType: typeof record.token_type === "string" ? record.token_type : null
    };
    return accessToken;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerCode(payload: unknown) {
  if (!isRecord(payload)) return undefined;
  const direct = payload.code ?? payload.Code;
  const nested = isRecord(payload.response) ? payload.response.code ?? payload.response.Code : undefined;
  return direct === undefined && nested === undefined ? undefined : String(direct ?? nested);
}

function providerMessage(payload: unknown) {
  if (!isRecord(payload)) return undefined;
  const direct = payload.message ?? payload.Message;
  const nested = isRecord(payload.response) ? payload.response.message ?? payload.response.Message : undefined;
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
  if (code === "INVALID_OAUTHSCOPE") return new ZohoApiError("Zoho rejected the OAuth scope.", "UNAUTHORIZED", options);
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

export type ZohoMailingListsPageDiagnostic = {
  code: string | null;
  containerKey: string | null;
  httpStatus: number;
  listCount: number;
  message: string | null;
  status: string | null;
  topLevelKeys: string[];
};

export type ZohoTopic = {
  primaryList: string | null;
  topicId: string;
  topicName: string;
};

export type ZohoTopicsPageDiagnostic = {
  code: string | null;
  containerKey: string | null;
  httpStatus: number;
  message: string | null;
  topicCount: number;
  topLevelKeys: string[];
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

function mailingListCollection(payload: unknown) {
  if (!isRecord(payload)) return { containerKey: null, items: null };
  const response = isRecord(payload.response) ? payload.response : null;
  const candidates: Array<[string, unknown]> = [
    ["list_of_details", payload.list_of_details],
    ["lists", payload.lists],
    ["response.list_of_details", response?.list_of_details],
    ["response.lists", response?.lists]
  ];
  const match = candidates.find(([, candidate]) => Array.isArray(candidate));
  return match
    ? { containerKey: match[0], items: match[1] as unknown[] }
    : { containerKey: null, items: null };
}

export function parseMailingLists(payload: unknown): ZohoMailingList[] {
  const collection = mailingListCollection(payload);
  if (!collection.items) {
    throw new ZohoApiError("Zoho mailing-list response has no list details.", "INVALID_RESPONSE");
  }
  return collection.items.map((item) => {
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

export function buildMailingListsPageDiagnostic(
  payload: unknown,
  httpStatus: number
): ZohoMailingListsPageDiagnostic {
  const record = isRecord(payload) ? payload : {};
  const collection = mailingListCollection(payload);
  return {
    code: record.code === undefined && record.Code === undefined ? null : String(record.code ?? record.Code),
    containerKey: collection.containerKey,
    httpStatus,
    listCount: collection.items?.length ?? 0,
    message: typeof (record.message ?? record.Message) === "string"
      ? sanitizeProviderMessage(String(record.message ?? record.Message))
      : null,
    status: typeof record.status === "string" ? sanitizeProviderMessage(record.status) : null,
    topLevelKeys: Object.keys(record).sort()
  };
}

function topicCollection(payload: unknown) {
  if (!isRecord(payload)) return { containerKey: null, items: null };
  const response = isRecord(payload.response) ? payload.response : null;
  const candidates: Array<[string, unknown]> = [
    ["topicDetails", payload.topicDetails],
    ["topics", payload.topics],
    ["topic_details", payload.topic_details],
    ["response.topicDetails", response?.topicDetails],
    ["response.topics", response?.topics],
    ["response.topic_details", response?.topic_details]
  ];
  const match = candidates.find(([, candidate]) => Array.isArray(candidate));
  return match
    ? { containerKey: match[0], items: match[1] as unknown[] }
    : { containerKey: null, items: null };
}

export function parseTopics(payload: unknown): ZohoTopic[] {
  const collection = topicCollection(payload);
  if (!collection.items) {
    throw new ZohoApiError("Zoho topic response has no topic details.", "INVALID_RESPONSE");
  }
  return collection.items.map((item) => {
    const topicId = isRecord(item) ? item.topicId ?? item.topic_id : undefined;
    const topicName = isRecord(item) ? item.topicName ?? item.topic_name : undefined;
    const primaryList = isRecord(item) ? item.primaryList ?? item.primary_list : undefined;
    if (!isRecord(item) || topicId === undefined || typeof topicName !== "string") {
      throw new ZohoApiError("Zoho returned an invalid topic entry.", "INVALID_RESPONSE");
    }
    return {
      primaryList: primaryList === undefined || primaryList === null ? null : String(primaryList),
      topicId: String(topicId),
      topicName
    };
  });
}

export function buildTopicsPageDiagnostic(payload: unknown, httpStatus: number): ZohoTopicsPageDiagnostic {
  const record = isRecord(payload) ? payload : {};
  const collection = topicCollection(payload);
  return {
    code: record.code === undefined ? null : String(record.code),
    containerKey: collection.containerKey,
    httpStatus,
    message: typeof record.message === "string" ? sanitizeProviderMessage(record.message) : null,
    topicCount: collection.items?.length ?? 0,
    topLevelKeys: Object.keys(record).sort()
  };
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

  private async requestResult(
    path: string,
    init: RequestInit = {},
    allowAuthRetry = true,
    baseUrl = ZOHO_API_BASE_URL,
    acceptProviderError = false
  ): Promise<{ payload: unknown; status: number }> {
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
      return this.requestResult(path, init, false, baseUrl, acceptProviderError);
    }
    if (!acceptProviderError && (!response.ok || (code && !["0", "200"].includes(code)))) {
      throw classifyProviderError(response, payload);
    }
    return { payload, status: response.status };
  }

  private async request(
    path: string,
    init: RequestInit = {},
    allowAuthRetry = true,
    baseUrl = ZOHO_API_BASE_URL
  ): Promise<unknown> {
    return (await this.requestResult(path, init, allowAuthRetry, baseUrl)).payload;
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

  async inspectMailingListsPage(input: { fromIndex: number; range: number }) {
    const query = new URLSearchParams({
      fromindex: String(input.fromIndex),
      range: String(input.range),
      resfmt: "JSON",
      sort: "asc"
    });
    const result = await this.requestResult(
      `/api/v1/getmailinglists?${query.toString()}`,
      { method: "GET" },
      true,
      ZOHO_API_BASE_URL,
      true
    );
    const diagnostic = buildMailingListsPageDiagnostic(result.payload, result.status);
    const code = providerCode(result.payload);
    if (code && !["0", "200"].includes(code)) {
      const providerError = classifyProviderError(new Response(null, { status: result.status }), result.payload);
      return {
        diagnostic,
        lists: null,
        parseError: { kind: providerError.kind, message: providerError.message }
      };
    }
    try {
      return { diagnostic, lists: parseMailingLists(result.payload), parseError: null };
    } catch (error) {
      return {
        diagnostic,
        lists: null,
        parseError: error instanceof ZohoApiError ? {
          kind: error.kind,
          message: error.message
        } : { kind: "UNEXPECTED", message: "The mailing-list response could not be parsed." }
      };
    }
  }

  async getMailingListsPage(input: { fromIndex: number; range: number }) {
    const result = await this.inspectMailingListsPage(input);
    if (!result.lists) {
      throw new ZohoApiError(result.parseError?.message ?? "Zoho mailing-list response is invalid.", "INVALID_RESPONSE");
    }
    return { diagnostic: result.diagnostic, lists: result.lists };
  }

  async discoverMailingLists(input: { maxPages?: number; pageSize?: number } = {}) {
    const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 10);
    const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 100);
    const lists = new Map<string, ZohoMailingList>();
    const pages: ZohoMailingListsPageDiagnostic[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.getMailingListsPage({
        fromIndex: 1 + page * pageSize,
        range: pageSize
      });
      pages.push(result.diagnostic);
      result.lists.forEach((list) => lists.set(list.listKey, list));
      if (result.lists.length < pageSize) return { lists: [...lists.values()], pages };
    }

    throw new ZohoApiError("Zoho mailing-list discovery exceeded the bounded pagination limit.", "INVALID_RESPONSE");
  }

  async getMailingLists() {
    return (await this.discoverMailingLists()).lists;
  }

  async getTopicsPage(input: { baseUrl?: string; fromIndex: number; range: number }) {
    const details = encodeURIComponent(`{from_index:${input.fromIndex},range:${input.range}}`);
    const result = await this.requestResult(
      `/api/v1/topics?details=${details}`,
      {},
      true,
      input.baseUrl ?? ZOHO_TOPICS_API_BASE_URL
    );
    return {
      diagnostic: buildTopicsPageDiagnostic(result.payload, result.status),
      topics: parseTopics(result.payload)
    };
  }

  async discoverTopics(input: { baseUrl?: string; maxPages?: number; pageSize?: number } = {}) {
    const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 10);
    const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 100);
    const pages: ZohoTopicsPageDiagnostic[] = [];
    const topics = new Map<string, ZohoTopic>();

    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.getTopicsPage({
        baseUrl: input.baseUrl,
        fromIndex: page * pageSize,
        range: pageSize
      });
      pages.push(result.diagnostic);
      result.topics.forEach((topic) => topics.set(topic.topicId, topic));
      if (result.topics.length < pageSize) {
        return { pages, topics: [...topics.values()] };
      }
    }

    throw new ZohoApiError("Zoho topic discovery exceeded the bounded pagination limit.", "INVALID_RESPONSE");
  }

  async getTopics() {
    return (await this.discoverTopics()).topics;
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
