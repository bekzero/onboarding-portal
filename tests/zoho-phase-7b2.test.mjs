import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ZohoApiClientCore,
  ZohoApiError,
  ZohoOAuthTokenManager,
  parseBulkAddResult
} from "../lib/zoho-api-core.ts";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status
  });
}

function tokenManager(overrides = {}) {
  return {
    getAccessToken: async () => "test-access-token",
    invalidate: () => undefined,
    ...overrides
  };
}

test("getleads uses the verified GET request and parses list contacts", async () => {
  const calls = [];
  const client = new ZohoApiClientCore(tokenManager(), async (url, init) => {
    calls.push({ init, url: String(url) });
    return response({
      code: "0",
      list_of_details: [{ firstname: "Test", lastname: "User", lead_email: "Test.User@kzero.com" }],
      status: "success"
    });
  });

  const leads = await client.getListLeads({
    fromIndex: 1,
    listKey: "secret-list-key",
    range: 20,
    status: "active"
  });

  assert.deepEqual(leads, [{ email: "Test.User@kzero.com", firstName: "Test", lastName: "User" }]);
  assert.equal(calls[0].init.method, undefined);
  assert.match(calls[0].url, /^https:\/\/marketingautomation\.zoho\.com\/api\/v1\/getleads\?/);
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get("listkey"), "secret-list-key");
  assert.equal(query.get("resfmt"), "JSON");
  assert.equal(query.get("range"), "20");
  assert.equal(query.get("fromindex"), "1");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Zoho-oauthtoken test-access-token");
});

test("getleads accepts the Zoho MA 2.0 contact_email response field", async () => {
  const client = new ZohoApiClientCore(tokenManager(), async () => response({
    code: "0",
    list_of_details: [{ contact_email: "contact@kzero.com", firstname: "Contact", lastname: "User" }],
    status: "success"
  }));

  assert.deepEqual(await client.getListLeads({
    correlationId: "contact-field-test",
    fromIndex: 1,
    listKey: "secret-list-key",
    range: 20,
    status: "active"
  }), [{ email: "contact@kzero.com", firstName: "Contact", lastName: "User" }]);
});

test("empty unsubscribed and bounced category code 2502 is handled narrowly", async () => {
  const diagnostics = [];
  const originalWarn = console.warn;
  console.warn = (...args) => diagnostics.push(args);
  try {
    const client = new ZohoApiClientCore(tokenManager(), async () =>
      response({ code: "2502", message: "No records", status: "error" })
    );
    assert.deepEqual(await client.getListLeads({
      correlationId: "empty-unsub-test",
      fromIndex: 1,
      listKey: "secret-list-key",
      range: 20,
      status: "unsub"
    }), []);
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0][1], {
      classification: "EMPTY_NON_ACTIVE_CATEGORY",
      correlationId: "empty-unsub-test",
      httpStatus: 200,
      providerCode: "2502",
      stage: "getleads"
    });
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret-list-key|contact@/i);
  } finally {
    console.warn = originalWarn;
  }
});

test("code 2502 for active membership remains fail-closed", async () => {
  const diagnostics = [];
  const originalError = console.error;
  console.error = (...args) => diagnostics.push(args);
  try {
    const client = new ZohoApiClientCore(tokenManager(), async () =>
      response({ code: "2502", message: "List key is not found", status: "error" })
    );
    await assert.rejects(client.getListLeads({
      correlationId: "active-2502-test",
      fromIndex: 1,
      listKey: "secret-list-key",
      range: 20,
      status: "active"
    }), (error) => error instanceof ZohoApiError && error.kind === "INVALID_LIST");
    assert.equal(diagnostics[0][1].stage, "getleads");
    assert.equal(diagnostics[0][1].providerCode, "2502");
  } finally {
    console.error = originalError;
  }
});

test("getleads logs sanitized HTTP, application, and parsing failures", async () => {
  const diagnostics = [];
  const originalError = console.error;
  console.error = (...args) => diagnostics.push(args);
  try {
    const cases = [
      response({ code: "INVALID_OAUTHSCOPE", message: "Denied", status: "error" }),
      response({ code: "SERVER_ERROR", message: "Failed", status: "error" }, 503),
      new Response("not-json", { status: 200 })
    ];
    for (const providerResponse of cases) {
      const client = new ZohoApiClientCore(tokenManager(), async () => providerResponse);
      await assert.rejects(client.getListLeads({
        correlationId: "failure-test",
        fromIndex: 1,
        listKey: "secret-list-key",
        range: 20,
        status: "active"
      }));
    }
    assert.deepEqual(diagnostics.map((entry) => entry[1].stage), ["getleads", "getleads", "parsing"]);
    assert.deepEqual(diagnostics.map((entry) => entry[1].httpStatus), [200, 503, 200]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret-list-key|Zoho-oauthtoken|authorization/i);
  } finally {
    console.error = originalError;
  }
});

test("OAuth refresh failures are identified as the OAuth diagnostic stage", async () => {
  const diagnostics = [];
  const originalError = console.error;
  console.error = (...args) => diagnostics.push(args);
  try {
    const fetcher = async () => response({ error: "invalid_code", error_description: "Rejected" });
    const manager = new ZohoOAuthTokenManager({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh"
    }, fetcher);
    const client = new ZohoApiClientCore(manager, fetcher);
    await assert.rejects(client.getListLeads({
      correlationId: "oauth-failure-test",
      fromIndex: 1,
      listKey: "secret-list-key",
      range: 20,
      status: "active"
    }), (error) => error instanceof ZohoApiError && error.kind === "OAUTH");
    assert.deepEqual(diagnostics[0][1], {
      classification: "OAUTH",
      correlationId: "oauth-failure-test",
      httpStatus: 200,
      providerCode: null,
      stage: "OAuth"
    });
    assert.doesNotMatch(JSON.stringify(diagnostics), /clientSecret|refresh|secret-list-key/i);
  } finally {
    console.error = originalError;
  }
});

test("addleadsinbulk validates, de-duplicates, and batches at ten emails", async () => {
  const calls = [];
  const emails = Array.from({ length: 21 }, (_, index) => `USER${index}@example.com`);
  emails.push("user0@example.com", "not-an-email");
  const client = new ZohoApiClientCore(tokenManager(), async (url, init) => {
    calls.push({ init, url: String(url) });
    return response({ code: "0", status: "success", url: "/api/v1/addleadsinbulk" });
  });

  const result = await client.addLeadsInBulk({ emails, listKey: "secret-list-key" });

  assert.equal(result.batchCount, 3);
  assert.equal(result.acceptedCount, 21);
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.results.find((item) => item.reason === "DUPLICATE_INPUT")?.classification, "IGNORED");
  assert.equal(result.results.find((item) => item.reason === "INVALID_EMAIL")?.classification, "ERROR");
  for (const call of calls) {
    assert.equal(call.url, "https://marketingautomation.zoho.com/api/v1/addleadsinbulk");
    assert.equal(call.init.method, "POST");
    assert.equal(new Headers(call.init.headers).get("content-type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(call.init.body));
    assert.equal(body.get("listkey"), "secret-list-key");
    assert.equal(body.get("resfmt"), "JSON");
    assert.ok((body.get("emailids") ?? "").split(",").length <= 10);
  }
});

test("bulk response parsing distinguishes existing and ignored contacts", () => {
  assert.deepEqual(parseBulkAddResult({
    added_leads: ["new@example.com"],
    code: "0",
    existing_leads: ["existing@example.com"],
    ignored_leads: ["ignored@example.com"],
    status: "success"
  }, ["new@example.com", "existing@example.com", "ignored@example.com"]), [
    { classification: "ACCEPTED", email: "new@example.com", providerCode: "0", reason: "PROVIDER_ACCEPTED" },
    { classification: "EXISTING", email: "existing@example.com", providerCode: "0", reason: "ALREADY_IN_LIST" },
    { classification: "IGNORED", email: "ignored@example.com", providerCode: "0", reason: "PROVIDER_IGNORED" }
  ]);
});

test("HTTP-200 OAuth scope errors are rejected and malformed successes fail closed", async () => {
  const scopeClient = new ZohoApiClientCore(tokenManager(), async () =>
    response({ Code: "INVALID_OAUTHSCOPE", message: "", status: "error" })
  );
  await assert.rejects(
    scopeClient.addLeadsInBulk({ emails: ["test@example.com"], listKey: "list" }),
    (error) => error instanceof ZohoApiError && error.kind === "UNAUTHORIZED"
  );

  const malformedClient = new ZohoApiClientCore(tokenManager(), async () => response({ unexpected: true }));
  await assert.rejects(
    malformedClient.addLeadsInBulk({ emails: ["test@example.com"], listKey: "list" }),
    (error) => error instanceof ZohoApiError && error.kind === "INVALID_RESPONSE"
  );
});

test("bulk requests use the shared bounded timeout convention", async () => {
  const client = new ZohoApiClientCore(tokenManager(), (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }), 5);
  await assert.rejects(
    client.addLeadsInBulk({ emails: ["test@example.com"], listKey: "list" }),
    (error) => error instanceof ZohoApiError && error.kind === "TIMEOUT"
  );
});

test("a rejected access token is refreshed once before the bulk write succeeds", async () => {
  const calls = [];
  const responses = [
    response({ access_token: "old", expires_in: 3600 }),
    response({ code: "401", message: "expired", status: "error" }, 401),
    response({ access_token: "new", expires_in: 3600 }),
    response({ code: "0", status: "success" })
  ];
  const fetcher = async (url, init) => {
    calls.push({ init, url: String(url) });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return next;
  };
  const manager = new ZohoOAuthTokenManager({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" }, fetcher);
  const client = new ZohoApiClientCore(manager, fetcher);
  const result = await client.addLeadsInBulk({ emails: ["test@example.com"], listKey: "list" });
  assert.equal(result.acceptedCount, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/oauth/v2/token")).length, 2);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/addleadsinbulk")).length, 2);
});

test("Phase 7B.2 manual controlled sync remains email-only while lifecycle dispatch is full-field", async () => {
  const phase2 = await readFile(new URL("../lib/zoho-phase2.ts", import.meta.url), "utf8");
  const provider = await readFile(new URL("../lib/zoho-dispatch-provider.ts", import.meta.url), "utf8");
  assert.match(phase2, /\.addLeadsInBulk\s*\(/);
  assert.doesNotMatch(phase2, /\.subscribeLead\s*\(/);
  assert.doesNotMatch(phase2, /getZohoTopicId/);
  assert.match(provider, /\.subscribeLead\s*\(/);
  assert.match(provider, /synchronizeFullFieldContact/);
});
