# Zoho Marketing Automation Phase 2 API integration

Status: implemented and dormant; field payload verified in Postman, but not yet through the portal

Organization: `org859403413`

Data center: US

Phase 2 adds a server-only Zoho Marketing Automation API layer, read-only discovery, subscription verification support, and one tightly controlled test-contact write path. It does not add a dispatcher, journey triggers, scheduled jobs, bulk synchronization, production enrollment, or automatic external calls.

The Phase 1A migration must be rehearsed and applied before any deployment containing the Phase 1B or Phase 2 database-dependent routes. Do not deploy this code against the pre-Phase-1A production schema.

## Architecture

- `lib/zoho-api-core.ts` contains the transport-independent OAuth token manager, bounded API request behavior, typed parsers, and sanitized provider errors.
- `lib/zoho-api.ts` is the server-only singleton wrapper. One warm server instance shares a cached access token and concurrent callers share one refresh request.
- `lib/zoho-config.ts` reads server-only environment configuration and exposes only presence/status information to the admin UI.
- `lib/zoho-contact-mapping.ts` owns the exact portal-to-Zoho picklist and snapshot mapping.
- `lib/zoho-contact-snapshot.ts` reads only persisted Prisma plan, task, contact, and SaaS application data. It does not use mock records.
- `lib/zoho-field-mapping.ts` defines the 24 required custom fields, parses field discovery, and builds the supported `listsubscribe` payload with Zoho display names.
- `lib/zoho-phase2.ts` implements field/journey discovery, list-membership checks, manual subscription verification, and the allowlisted test-sync workflow.
- `lib/zoho-test-policy.ts` is the pure safety policy for test-mode, plan/email allowlists, context ownership, conflicts, and eligibility.

All Zoho calls originate from authenticated admin API routes. Access tokens and refresh credentials are never returned to the browser or written to audit records.

## Configuration

Required server-only OAuth variables:

```text
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
```

Required portal/list configuration:

```text
PORTAL_PUBLIC_BASE_URL=https://the-approved-production-domain.example
ZMA_LIST_KEY=
ZMA_TOPIC_ID=
```

Journey discovery comparison:

```text
ZMA_J1_JOURNEY_KEY=
ZMA_J1_TRIGGER_KEY=
ZMA_J3_JOURNEY_KEY=
ZMA_J3_TRIGGER_KEY=
ZMA_J5_JOURNEY_KEY=
ZMA_J5_TRIGGER_KEY=
ZMA_J8_JOURNEY_KEY=
ZMA_J8_TRIGGER_KEY=
```

Production safety settings:

```text
ZOHO_DISPATCH_ENABLED=false
ZOHO_EVENT_EMISSION_ENABLED=false
ZMA_PRIVATE_LIST_VERIFIED=false
ZMA_FIELD_MAPPING_VERIFIED=false
```

`ZMA_PRIVATE_LIST_VERIFIED` may become `true` only after an authorized Zoho administrator confirms the KZero Partner Onboarding list is private and the controlled test proves existing-contact updates. `ZMA_FIELD_MAPPING_VERIFIED` may become `true` only after discovery plus a controlled write prove the discovered identifiers update all required custom fields. These settings are explicit readiness evidence; discovery alone does not change them.

The code accepts the Phase 1B legacy aliases `ZOHO_MA_LIST_KEY` and `ZOHO_MA_TOPIC_ID` so an existing valid environment is not silently broken. New configuration should use `ZMA_LIST_KEY` and `ZMA_TOPIC_ID`.

## OAuth scopes

Generate the refresh token with only:

```text
ZohoMarketingAutomation.lead.CREATE-UPDATE
ZohoMarketingAutomation.lead.READ
ZohoMarketingAutomation.journey.READ
```

Justification:

- `lead.CREATE-UPDATE` covers `listsubscribe` and the Get All Lead Fields endpoint, which Zoho documents as requiring lead update access.
- `lead.READ` covers Get List Leads.
- `journey.READ` covers Get Open Journeys.

Do not grant `ZohoMarketingAutomation.journey.CREATE` in Phase 2. It is reserved for the separately approved journey-trigger phase. Do not use `lead.ALL`, CRM scopes, or Campaigns scopes.

OAuth refresh uses `POST https://accounts.zoho.com/oauth/v2/token` with form-encoded credentials. Access tokens are cached until 60 seconds before expiry. A rejected API token is refreshed and retried once; other failures do not enter an automatic retry loop. Requests have a bounded timeout. Provider messages are sanitized before they are returned.

Official references:

- [ZMA OAuth scopes](https://www.zoho.com/marketingautomation/help/developers/v1/access-token.html)
- [Zoho access-token refresh](https://www.zoho.com/connect/api/oauth-authentication-refreshing-access-tokens.html)
- [Get All Lead Fields](https://www.zoho.com/marketingautomation/help/developers/v1/get-all-leads-fields.html)
- [Subscribe](https://www.zoho.com/marketingautomation/help/developers/v1/lead-subscribe.html)
- [Get List Leads](https://www.zoho.com/marketingautomation/help/developers/v1/get-list-leads.html)
- [Get Open Journeys](https://www.zoho.com/marketingautomation/help/developers/v1/get-open-journeys.html)

## Contact snapshot

Every upsert keeps a 27-value portal snapshot: built-in Lead Email, First Name, and Last Name plus all 24 custom fields. The current `listsubscribe` payload sends the 24 values proven compatible in the controlled Postman test: the three built-ins plus 21 custom fields. Zoho requires exact display names as the JSON keys; discovered internal identifiers such as `CONTACT_CF32` are metadata and are not sent as `leadinfo` keys.

`Next Task Since`, `Last SE Touch`, and `Last MSP Activity` remain persisted and included in field discovery, but are temporarily excluded from `listsubscribe`. Zoho returns application error `2001` when any of these correctly defined Date/Time fields is submitted, including when tested individually. Do not activate a journey that depends on those Zoho values until Zoho confirms a supported Date/Time write format or endpoint.

Optional unavailable supported values are sent empty so stale Zoho values are not retained. Numeric zero is sent as the number `0`. Zoho displays a submitted zero for `Apps Submitted` or `Apps Approved` as a blank field; that blank is the provider representation of the synchronized zero and is not, by itself, a synchronization failure. The portal continues to retain the actual numeric zero.

The snapshot uses:

- the persisted PlanContact email/name/role;
- plan tenant type, stage, progress, state, next-task timestamp, activity timestamp, kickoff timestamp, nudge state, and assigned-SE fields;
- the first persisted non-complete task ordered by the plan, or the final completed task for a completed plan;
- `OnboardingTask.templateKey` as Next Task ID;
- actual persisted SaaS submission rows for submitted and approved counts;
- the existing application time-estimate and guide mappings.

Variable KZero work and per-application implementation time produce no numeric Next Task Minutes. No historical timestamp, first name, email, booking URL, task tip, or Last SE Touch is fabricated. The current schema has no truthful Last SE Touch or task-tip field, so both remain empty.

Task links use:

```text
/portal/{planId}?tab=tasks&task={templateKey}
```

The portal now recognizes this authenticated deep link, opens the Tasks tab, expands the correct phase, and scrolls to the stable task key. No temporary-access token or admin backdoor is included.

## Exact picklists

- Tenant Type: `NFR`, `Customer`
- Current Phase: `Kickoff`, `Tenant Setup`, `App Review`, `SSO Rollout`, `First Customer Pilot`, `Onboarding Complete`
- Onboarding Role: `Onboarding Owner`, `Executive Sponsor`, `Technical Admin`
- Onboarding State: `Active`, `Paused`, `Complete`
- Next Task Owner: `MSP`, `KZero SE`, `Shared`
- Next Task Status: `Action Required`, `In Progress`, `KZero Working`, `Upcoming`, `Complete`
- Nudge Status: `Waiting`, `Done`

Kickoff booking maps the stable `book-kickoff` task to `Upcoming` without changing the persisted task status.

## Field discovery

`POST /api/admin/zoho/discover` with `{"operation":"fields"}` calls:

```text
GET https://marketingautomation.zoho.com/api/v1/lead/allfields?type=json
```

The sanitized report includes expected display field, found/missing state, field identifier, field ID, reported data type, expected type, and mapping status. Duplicate display names are ambiguous. Missing identifiers block test and production upserts. If Zoho omits type metadata, the identifier is reported with `FOUND_IDENTIFIER_TYPE_UNVERIFIED`.

Fields are not created or modified automatically. Discovery verifies the unique field metadata and types. The controlled Postman test established that `listsubscribe` accepts exact `DISPLAY_NAME` values as `leadinfo` keys, not the internal `FIELD_NAME` values. `Next Task Tip` resolves to the text field `CONTACT_CF32`; the old date field `CONTACT_CF29` (`Next Task Tip (Old - Date)`) is ignored.

## Subscription verification

The API client supports Get List Leads for `active`, `unsub`, and `bounce`. The admin check scans bounded pages and reports truncation rather than claiming a complete result.

- `unsub` or `bounce` recommends `INELIGIBLE`.
- active membership still recommends `MANUAL_REVIEW` because the API does not prove Partner Onboarding topic association, Marketing-lead classification, or deliverability.
- a `listsubscribe` success that mentions confirmation sets `PENDING_CONFIRMATION`, never `CONFIRMED`.
- an accepted but ambiguous success sets `MANUAL_REVIEW`.

Manual verification is available through the authenticated verification route. It requires an evidence reference, reason, actor label, and explicit `CONFIRMED`, `INELIGIBLE`, or `MANUAL_REVIEW` selection. The current shared admin session cannot identify a person; until named admin authentication exists, the audit actor remains the accurate configured `ADMIN_AUDIT_ACTOR` or `admin-session` label.

No code bypasses double opt-in or resubscribes a suppressed contact.

## Journey discovery

`POST /api/admin/zoho/discover` with `{"operation":"journeys"}` calls Get Open Journeys with page 1, limit 100, ascending order, all users, and `trigger_type=open`.

Both `triggerkey` and `trigger_key` response variants are supported. J1, J3-R1, J5, and J8 are compared by configured keys and exact intended names and reported as found, missing, configured, inactive/unavailable, or unverified. No key is invented or written automatically.

Phase 2 contains no Trigger Leads call.

## Controlled test-contact synchronization

Test-only variables:

```text
ZOHO_TEST_SYNC_ENABLED=false
ZOHO_TEST_EMAIL_ALLOWLIST=test.user@kzero.com
ZOHO_TEST_PLAN_IDS=approved-test-plan-id
```

Keep test mode false until an authorized test window. Before enabling it:

1. Apply Phase 1A only to an isolated database or approved environment.
2. Create or identify a non-production test plan and populate truthful persisted tasks, plan contact, SE details, and stable task mappings.
3. Explicitly set that test plan automation-active through an approved database/admin procedure. Do not activate a historical production case.
4. Create an ACTIVE communication context owned by the test plan and the allowlisted email.
5. Confirm no other automation-active plan references that email.
6. Configure the test email and plan ID allowlists exactly; do not use customer/MSP addresses.
7. Keep production dispatch and event emission false.
8. In the admin case preview, run read-only discovery and inspect missing/ambiguous fields and journey keys.
9. Select the persisted allowlisted contact and choose **Preview Test Sync**. Review the recipient, plan, field count, snapshot, warnings, and preview fingerprint.
10. Check the explicit authorization box and select **Upsert Allowlisted Test Contact** only after approval. This makes one `listsubscribe` call and may send a double-opt-in confirmation email.
11. Inspect the contact in ZMA. Confirm custom-field values, list privacy/update behavior, topic association, Marketing classification, and confirmation behavior.
12. Use **Check List Membership**, then manually record topic/Marketing evidence with the verification API. Active membership alone is insufficient.
13. Disable `ZOHO_TEST_SYNC_ENABLED` when testing finishes.

The server rejects the write unless test mode, both allowlists, automation eligibility, context ownership, conflict checks, field discovery, preview fingerprint, and explicit confirmation all pass. There is no startup call, bulk path, arbitrary-email input, journey trigger, or public endpoint.

## Admin API routes

- `GET /api/admin/zoho/status`
- `POST /api/admin/zoho/discover`
- `POST /api/admin/zoho/subscription-check`
- `POST /api/admin/zoho/verify-subscription`
- `POST /api/admin/zoho/test-sync/preview`
- `POST /api/admin/zoho/test-sync`

Every route validates the existing admin session server-side.

## Phase 3 blockers

- Rehearse and apply the Phase 1A migration before deployment.
- Retain the successful controlled field discovery and Postman write evidence with the release record.
- Confirm the list is private and existing contacts update.
- Run one controlled portal write to verify that the display-name payload matches the successful Postman request.
- Complete the double-opt-in, Partner Onboarding topic, and Marketing classification test.
- Launch only approved test journeys; production journeys remain Draft.
- Obtain marketing approval for journey keys, J8 scope/recipients, sender/Reply-To, and context-release operations.
- Add named administrator identity if individual actors are required.
- Add the dispatcher, durable retry processing, journey trigger adapter, event integration, and cron only in their separately approved phases.
- Keep `ZOHO_DISPATCH_ENABLED=false`, `ZOHO_EVENT_EMISSION_ENABLED=false`, and journey triggering disabled until launch approval.
