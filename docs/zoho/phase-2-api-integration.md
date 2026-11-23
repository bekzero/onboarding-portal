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

Optional unavailable supported values are serialized as empty strings to preserve the verified 24-field request contract. The first controlled Production upsert proved that `listsubscribe` may retain an existing Zoho value when an empty string is submitted. An empty outbound value must therefore **not** be treated as proof that the provider field was cleared. Zoho's Subscribe API documents private-list updates, but it does not document an explicit empty-field clearing operation. Do not invent a sentinel or undocumented clearing request.

Numeric zero is sent as the JSON number `0`. Zoho displays a submitted zero for `Apps Submitted` or `Apps Approved` as a blank/dash field; that provider presentation is not, by itself, a synchronization failure. The portal remains authoritative for the actual numeric zero.

The snapshot uses:

- the persisted PlanContact email/name/role;
- plan tenant type, stage, progress, state, next-task timestamp, activity timestamp, kickoff timestamp, nudge state, and assigned-SE fields;
- the first persisted non-complete task ordered by the plan, or the final completed task for a completed plan;
- `OnboardingTask.templateKey` as Next Task ID;
- actual persisted SaaS submission rows for submitted and approved counts;
- the existing application time-estimate and approved guide mappings;
- the first sentence of the persisted task description as the task-specific tip, provided it fits the verified 300-character Zoho text field.

Variable KZero work and per-application implementation time produce no numeric Next Task Minutes. No historical timestamp, first name, email, booking URL, guide URL, or Last SE Touch is fabricated. A task with no persisted description has no tip. A task with no approved guide mapping has no guide URL.

Task links use:

```text
/portal/{planId}?tab=tasks&task={templateKey}
```

The portal now recognizes this authenticated deep link, opens the Tasks tab, expands the correct phase, and scrolls to the stable task key. No temporary-access token or admin backdoor is included.

### Field lifecycle and provider freshness

KZero's persisted plan/task/application state is authoritative. Provider state is classified as follows:

| Portal state | Outbound representation | Provider freshness meaning |
|---|---|---|
| Known populated value | Exact string or positive number | Current after an accepted upsert, subject to read/UI verification |
| Known zero | JSON number `0` | Authoritative in KZero; Zoho may display blank/dash |
| Unknown / not applicable | Empty string for a supported optional field | Does not prove an existing Zoho value was cleared |
| Populated to empty | Empty string | Intentional clear requested, but provider clearing remains unverified; stale provider data may remain |
| Missing supported snapshot field | No request | Fail closed before the provider boundary |
| Unsupported Date/Time field | Omitted | Remains authoritative only in KZero until Zoho documents a compatible write format |

The portal never reads a stale optional Zoho field back as onboarding truth. Rendered Zoho previews were reviewed on November 23, 2026. They establish visible content, but not every subject, HTML attribute, hidden/conditional block, or reminder-node setting. `PARTIAL_REVIEW_NO_VISIBLE_REFERENCE` therefore remains a freshness requirement until the missing evidence is checked:

| Journey | Established fields | Tip / guide decision |
|---|---|---|
| J1 Welcome and Kickoff Booking | Rendered J1-1/J1-2: First Name, SE identity, booking and portal links. Waits use Next Task Status/Current Phase. | Tip and Guide were not visible, but subjects/HTML/conditional elements remain unverified. Both retain a safety hold. |
| J3-R1 Next Action Nudge | Rendered J3-R1/J3-R2: Current Phase, Next Task Title/Minutes/Tip, next-task button, guide link, SE identity. Waits use Nudge Status. | Tip and Guide are confirmed required. |
| J5 Your Next Step Is Ready | Rendered template: First Name, Current Phase, Next Task Title/Minutes/Tip, next-task and portal links, SE identity. | Tip is confirmed required. Guide was not visible, but subjects/HTML/conditional elements remain unverified, so Guide retains a safety hold. |
| J8 Completion and Expansion | Rendered completion template and journey design use First Name, SE identity, feedback and portal links, not current-task guidance. | Tip and Guide do not block J8. |

`Next Task Link` is always generated from the current persisted plan/task and fulfills the primary portal-navigation requirement. It cannot, however, make a retained stale `Next Task Guide URL` safe if a Zoho template renders that separate merge field. J1, J3-R1, and J5 therefore remain held before any provider workflow when either field is unavailable. All journey feature flags remain independently required and disabled by default.

### Link contract

| Template link | Expected source | Verification still required |
|---|---|---|
| J1 booking button | `SE Booking URL`, rebuilt from the assigned Sales Engineer stored on the plan | Inspect the button `href` in J1-1 and J1-2 |
| J1 portal link | `Portal URL`, rebuilt as `/portal/{planId}` | Inspect the rendered anchor target and any hidden/conditional variant |
| J3 next-step button | `Next Task Link`, rebuilt as `/portal/{planId}?tab=tasks&task={templateKey}` | Inspect both J3-R1 and J3-R2 button `href` values |
| J3 guide link | `Next Task Guide URL` from the approved `getTaskGuides` mapping | Inspect both guide-link `href` values and conditional behavior when unavailable |
| J5 next-step button | Current `Next Task Link` | Inspect the button `href` |
| J5 portal link | Current `Portal URL` | Inspect the portal-link `href` |
| J8 feedback button | Zoho-template configuration; not part of the 24-field KZero contract | Replace the known portal placeholder with the approved feedback destination and verify it manually |
| J8 portal link | Current `Portal URL` if implemented as a merge field | Inspect the anchor `href`; do not infer it from visible link text |

KZero never accepts a Zoho-stored link as authoritative. `Portal URL`, `Next Task Link`, `SE Booking URL`, and approved guide URLs are rebuilt from current persisted KZero state for every upsert.

### Wait and exit safety

- **Kickoff booked during J1's three-day wait:** KZero stores `kickoffBookedAt` and emits a prioritized stop-state upsert that changes `Next Task Status` to `Upcoming`. The Zoho journey must re-evaluate `Next Task Status`/`Current Phase` before J1-2. The dispatcher cannot retract an email already sent.
- **Nudged task completed during J3's two-day wait:** the task transition and `Nudge Status = Done` commit with a stop-state upsert. The Zoho journey must re-evaluate that field before J3-R2. The dispatcher prioritizes stop-state events but cannot cancel a message already accepted by Zoho.
- **Task changes before a reminder:** KZero cancels an untriggered stale J3 event when the authoritative task no longer matches. Once J3 is already running in Zoho, cancellation depends on the `Done` upsert and the journey's wait/exit configuration.
- **Recipient becomes unsubscribed or otherwise ineligible:** new KZero journey triggers are blocked. An already-running Zoho journey must independently honor current topic/list suppression; this requires an isolated TEST verification and cannot be inferred from KZero's hold.
- **Reminder already sent:** it cannot be recalled. The send ledger prevents a duplicate KZero trigger, while later journey nodes remain governed by Zoho's configured exit checks.

Before any isolated journey trigger, inspect every wait node and confirm that its early-exit condition is evaluated before the following email, including the exact comparison value and branch ordering. A documented field update is necessary but is not proof that Zoho cancelled the next node.

### Verified first controlled Production upsert

At approximately `2026-11-21T23:33:48Z`, exact event `cmwpz7q920001jx07nhzr1yc7` sent one allowlisted `UPSERT_CONTACT` request for plan `benmsp-nfr` and recipient `b.eakin@kzero.com`. The provider accepted application code `0` with status `success`; the event reached `SUCCEEDED` on attempt 1. No KZero journey send was recorded. Production was immediately restored to the global-kill-switch/disabled-dispatch configuration.

The event established:

- all 24 supported display-name keys are accepted together;
- the three Date/Time fields remain excluded;
- empty strings do not reliably clear pre-existing custom-field values;
- numeric zero may display as blank/dash;
- API acceptance alone does not prove field rendering, topic eligibility, email delivery, or absence of Zoho-native automation.

### Manual Zoho audit after a controlled write

For the first event, use `2026-11-21 23:33:48 UTC` as the reference time:

1. Open **Contacts**, select `b.eakin@kzero.com`, then inspect **Timeline** with a custom range around the reference time and filter to **Field Update**.
2. Inspect the contact's **Engagement** tab for campaigns, forms, or messages near the reference time.
3. Open every onboarding journey and use **Trace Contact Path** for the recipient. Confirm there is no entry, execution, or exit at the reference time.
4. Review sent campaigns, scheduled campaigns, autoresponders, and list-entry workflows for the private `KZero Partner Onboarding` list.
5. Check the recipient inbox, spam, and deleted items for subscription confirmations or automated messages.

The documented read-only APIs expose list membership, list/campaign summaries, field metadata, and open journey configuration, but they do not provide the same complete recipient-level Timeline/Engagement/Trace Contact Path evidence as the Zoho UI. Absence from an API response is not proof that no communication occurred.

### Remaining blockers before general automation

- obtain a documented provider operation for clearing an existing custom field, or design journey content that never consumes fields whose freshness is unverified;
- approve a guide URL for every task whose journey template uses `Next Task Guide URL`, or remove that merge-field dependency from the reviewed test journey;
- manually verify Zoho Timeline, Engagement, journey trace, campaign/autoresponder history, and the recipient inbox;
- keep unsupported Date/Time-dependent journey logic disabled;
- complete isolated test-journey validation, topic/deliverability verification, sender/return-path decisions, and scheduler/hosting approval;
- retain all existing tenant isolation, permission, suppression, private-list, topic, field-metadata, outbox ordering, idempotency, uncertain-outcome, retry, Staff SSO, kill-switch, and feature-flag gates.

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
