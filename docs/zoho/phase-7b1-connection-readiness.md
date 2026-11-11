# Phase 7B.1 — controlled Zoho connection readiness

Status: **offline guardrails implemented; live Zoho verification remains explicitly gated**
Assessment date: November 6, 2026

No Zoho token request, contact subscription, contact update, journey trigger, journey change, email, cron execution, production database connection, migration, or deployment was performed.

## 1. Files and architecture

Phase 7B.1 reuses the Phase 2 OAuth/token manager and API client. It adds only read operations and a separate local runner:

- `lib/zoho-api-core.ts`: read-only parsers and client methods for mailing lists and topics, plus richer field metadata parsing.
- `lib/zoho-field-mapping.ts`: reports field type mismatches instead of treating any reported type as valid.
- `lib/zoho-phase7b1-readiness.ts`: pure configuration, scope, key-collision, recipient, field, list, topic, and journey readiness decisions.
- `scripts/zoho-phase-7b1-readonly.mjs`: fail-closed local runner exposing only field, list, topic, and open-journey discovery.
- `tests/zoho-phase-7b1.test.mjs`: focused Phase 7B.1 safety and discovery tests.
- `.env.zoho-readonly.local`: ignored local placeholders for Zoho credentials and evidence; not committed.

The runner loads both `.env.zoho-test.local` and `.env.zoho-readonly.local`. The Phase 7A safety contract must first identify `kzero-onboarding-zoho-testing`; generic production database variables are not accepted as its target.

### Topic ID bootstrap

The full discovery check intentionally requires `ZMA_TOPIC_ID`, but the guarded topic bootstrap does not. It uses Zoho's documented read-only Get Topics endpoint (`GET https://ma.zoho.com/api/v1/topics`) with `ZohoMarketingAutomation.lead.READ`, then requires exactly one case-sensitive topic named `Partner Onboarding`. The returned `topicId` must contain digits only and is retained as a string so a large Zoho identifier is not rounded by JavaScript.

Before any network call, the bootstrap still requires:

- the verified Phase 7A isolated database target and fingerprints;
- `ZOHO_PHASE7B1_EXPECTED_ORGANIZATION=org859403413`;
- a non-empty `ZOHO_PHASE7B1_ORGANIZATION_VERIFICATION_REFERENCE` recorded from the approved Zoho organization;
- the existing OAuth credentials and declared `ZohoMarketingAutomation.lead.READ` scope;
- `ZOHO_PHASE7B1_READ_ONLY_AUTHORIZATION=I_AUTHORIZE_PHASE7B1_READ_ONLY_ZOHO_CALLS`;
- the global kill switch enabled and every write/dispatch/nudge feature dormant.

Run the offline gate first:

```powershell
npm.cmd run check:zoho-phase-7b1-topic-bootstrap
```

Only after it reports `readyForTopicBootstrap: true`, run the explicitly authorized read-only lookup:

```powershell
npm.cmd run discover:zoho-phase-7b1-topic
```

Copy the returned digits into the ignored local file as:

```text
ZMA_TOPIC_ID=<returned topicId>
```

Do not include quotes or copy the ID into `.env`, `.env.example`, Vercel production settings, or documentation. The endpoint does not return the organization ID, so the manual organization evidence requirement remains fail-closed; a configured expected-organization string alone is not treated as provider proof.

If the exact topic is not returned, run the sanitized diagnostic:

```powershell
npm.cmd run diagnose:zoho-phase-7b1-topic
```

This makes bounded GET requests against both the officially documented `https://ma.zoho.com` host and the standard `https://marketingautomation.zoho.com` API host. It reports only HTTP status, application code/message, top-level response keys, detected topic container, page/topic counts, and exact-match IDs. It does not print OAuth tokens or raw payloads.

The corrected request follows Zoho's documented object-literal parameter shape:

```text
details={from_index:0,range:100}
```

Pagination is capped at ten pages of no more than 100 topics each. Parsing supports the documented top-level `topicDetails` property plus `topics`, `topic_details`, and the same properties under `response`. Topic entry identifiers support the documented camel-case names and observed snake-case variants. Resolution still requires exactly one case-sensitive `Partner Onboarding` match with a digits-only ID.

### Mailing-list control diagnostic

Use the documented read-only Get Mailing Lists operation to test whether the OAuth connection can see an expected KZero resource:

```powershell
npm.cmd run diagnose:zoho-phase-7b1-mailing-list
```

The operation is strictly allowlisted even though Zoho documents it as a POST. It sends only `resfmt=JSON`, `sort=asc`, `fromindex`, and `range`, uses bounded pagination, and never prints the returned list key.

Live result on November 6, 2026:

```text
HTTP status: 200
Application status: error
Application code: INVALID_OAUTHSCOPE
Expected list visibility: not tested because Zoho rejected the granted scope
```

The locally declared `ZOHO_PHASE7B1_OAUTH_SCOPES` is not proof of the token grant. A later forced OAuth refresh provided supported response metadata confirming that the actual token grant contains `ZohoMarketingAutomation.lead.READ`, `ZohoMarketingAutomation.lead.UPDATE`, and `ZohoMarketingAutomation.journey.READ`. The Get Mailing Lists operation nevertheless returned `INVALID_OAUTHSCOPE`. This rules out missing `lead.READ` text in the actual grant, but it does not prove that the grant was bound to the intended Marketing Automation portal.

Offline fingerprint verification established:

```text
Client ID fingerprint: sha256:9d85fa3fee885a1b
Refresh token fingerprint: sha256:36596e7108a6bf78
Effective source: .env.zoho-readonly.local
Inherited credential overrides: none
Other local env credential conflicts: none
Persistent token cache: none
```

The OAuth refresh succeeds with this client/token pair and returns `api_domain=https://www.zohoapis.com`, but it does not return an organization or portal ID. Zoho documents selecting the target application and portal when generating the Self Client authorization code; no supported refresh-token introspection endpoint was found that independently returns the selected Marketing Automation portal.

#### Controlled separate-token test

Do not replace `.env.zoho-readonly.local`. In the approved US Zoho API Console:

1. Open the intended existing Self Client and verify its displayed Client ID corresponds to the configured client.
2. Generate a new authorization code with exactly `ZohoMarketingAutomation.lead.READ`.
3. When Zoho prompts for an application/portal, select the KZero Marketing Automation portal associated with `org859403413`.
4. Exchange the short-lived code using that same Self Client's Client ID and secret, following Zoho's documented authorization-code flow.
5. Save the separate Client ID, secret, and newly returned refresh token only in the ignored `.env.zoho-readonly-fallback.local` file. Do not overwrite the primary file.
6. Copy the non-secret organization evidence, authorization phrase, scope declaration, and dormant safety flags from the primary read-only file into the fallback file if they are not already inherited.
7. Confirm the fallback fingerprints and absence of inherited conflicts:

```powershell
npm.cmd run diagnose:zoho-phase-7b1-credentials:fallback
```

8. Run only the controlled read-only list diagnostic:

```powershell
npm.cmd run diagnose:zoho-phase-7b1-mailing-list:fallback
```

If the fallback succeeds, the original grant was bound incorrectly despite containing the scope. If it also returns `INVALID_OAUTHSCOPE`, the strongest remaining causes are Marketing Automation 2.0/v1 API compatibility or an account-level portal role/permission restriction. Escalate both sanitized results, the portal ID, Self Client ID fingerprint, and confirmation of the selected portal to Zoho Support; never send the tokens or client secret.

Zoho's Marketing Automation 2.0 migration guidance says Lists migrate without changes, while Topics need migration to the latest version and become contact-associated rather than legacy list-associated. The public v1 API documentation still describes the older list-associated topic model and does not confirm that `/api/v1/topics` exposes 2.0 topics. If Get Mailing Lists succeeds after correcting the actual OAuth grant but Get Topics still returns zero, record the two sanitized responses and ask Zoho Support whether the v1 Topics API exposes Marketing Automation 2.0 contact topics for this portal.

## 2. OAuth and organization status

Expected endpoints and organization:

```text
OAuth: https://accounts.zoho.com
Marketing Automation: https://marketingautomation.zoho.com
Topics API documented endpoint: https://ma.zoho.com
Organization: org859403413
Data center: US
```

Current local status:

| Item | Status | Evidence |
|---|---|---|
| Client ID | Configured locally | Guarded presence check only; value not printed |
| Client secret | Configured locally | Guarded presence check only; value not printed |
| Refresh token | Configured locally | Guarded presence check only; value not printed |
| Expected organization | Configured as `org859403413` | Local expectation, not provider proof |
| Organization evidence | Missing | Manual evidence required |
| Live OAuth refresh | Not performed | Blocked before network access |
| Data-center token behavior | Not verified | Requires authorized live refresh |
| Granted token scopes | Not verified | Requires controlled permission tests |

Official Zoho documentation currently requires:

- `ZohoMarketingAutomation.lead.UPDATE` for Get All Lead Fields;
- `ZohoMarketingAutomation.lead.READ` for Get Mailing Lists, Get Topics, and Get List Leads;
- `ZohoMarketingAutomation.journey.READ` for Get Open Journeys;
- `ZohoMarketingAutomation.lead.CREATE` or `lead.CREATE-UPDATE` for the later `listsubscribe` test;
- `ZohoMarketingAutomation.journey.CREATE` only for the separately authorized Trigger Leads phase.

The proposed Phase 7B.1 token declaration is:

```text
ZohoMarketingAutomation.lead.READ,
ZohoMarketingAutomation.lead.CREATE-UPDATE,
ZohoMarketingAutomation.journey.READ
```

`lead.CREATE-UPDATE` supplies the documented UPDATE permission needed by field discovery and preserves the later controlled-contact capability. `journey.CREATE` is not needed for Phase 7B.1. If it is already present, the runner reports it as unused extra capability; it still has no journey-trigger code path.

Official references:

- [OAuth scopes](https://www.zoho.com/marketingautomation/help/developers/v1/access-token.html)
- [Get All Lead Fields](https://www.zoho.com/marketingautomation/help/developers/v1/get-all-leads-fields.html)
- [Get Mailing Lists](https://www.zoho.com/marketingautomation/help/developers/v1/get-mailing-lists.html)
- [Get Topics](https://www.zoho.com/marketingautomation/help/developers/v1/get-topics.html)
- [Get Open Journeys](https://www.zoho.com/marketingautomation/help/developers/v1/get-open-journeys.html)
- [Get List Leads](https://www.zoho.com/marketingautomation/help/developers/v1/get-list-leads.html)
- [Subscribe](https://www.zoho.com/marketingautomation/help/developers/v1/lead-subscribe.html)

The documented discovery responses do not return the ZMA organization ID. Before live discovery, an authorized ZMA administrator must record an evidence reference showing the OAuth owner is inside `org859403413`. A configured string alone is not authoritative evidence.

Credential setup procedure:

1. Sign into the US Zoho API Console as the approved administrator of `org859403413` and create/use the approved server-based or self client.
2. Request only the three declared scopes above. Do not add CRM, Campaigns, lead ALL, or journey CREATE for Phase 7B.1.
3. Complete Zoho's authorization-code/refresh-token process under that same approved account.
4. Put `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and `ZOHO_REFRESH_TOKEN` only in `.env.zoho-readonly.local`; never paste them into chat.
5. Add the list key, topic ID, expected list owner, and manual organization evidence reference to the same ignored file.
6. After reviewing the target and evidence, set `ZOHO_PHASE7B1_READ_ONLY_AUTHORIZATION=I_AUTHORIZE_PHASE7B1_READ_ONLY_ZOHO_CALLS` for the approved read-only window.
7. Run `npm run check:zoho-phase-7b1-config` first. Only a clean result permits `npm run verify:zoho-phase-7b1-readonly`.

## 3. Guarded configuration result

`npm run check:zoho-phase-7b1-config` performed no network request and confirmed the Phase 7A endpoint fingerprints:

```text
resource: kzero-onboarding-zoho-testing
pooled fingerprint: 6b6bfeb051eaaf1a
direct fingerprint: 07ed6439cfe2d7d0
host kind: remote-isolated
```

Current full-discovery blockers:

- `ZMA_TOPIC_ID` missing;
- `ZOHO_PHASE7B1_ORGANIZATION_VERIFICATION_REFERENCE` missing;
- exact live read-only authorization phrase absent;

The expected list owner and approved internal test recipient are not yet configured, but those are warnings rather than blockers for the topic bootstrap. The bootstrap itself is blocked only by the missing organization-evidence reference and explicit authorization phrase. OAuth values were checked only for presence and were not printed or transmitted.

All write and automation flags passed the dormant-state check. The runner refused live mode and made no authenticated API call.

## 4. Field verification status

Live field discovery: **not verified**.

The runner is prepared to call only:

```text
GET /api/v1/lead/allfields?type=json
```

It compares the 24 custom fields plus Lead Email, First Name, and Last Name. It reports missing or duplicate display names, missing identifiers, field IDs, absent type metadata, and explicit type mismatches. If Zoho returns picklist values, it compares them to the exact portal values. If the API omits them—as the official sample does—the result remains `MANUAL_VERIFICATION_REQUIRED` rather than inferred.

No field identifier is currently verified through the live API. `ZMA_FIELD_MAPPING_VERIFIED` remains `false`. Discovery alone will not change it; Phase 7B.2 must prove that a controlled full snapshot updates the intended fields.

Manual field-value check:

1. Open ZMA Settings and the contact/lead custom-field management view.
2. Record each display name, API/field name, field ID, type, and picklist values.
3. Resolve every duplicate display name or type mismatch before testing an upsert.
4. Keep the mapping flag false until the Phase 7B.2 contact is inspected after a controlled write.

## 5. List and topic status

Live list/topic discovery: **not verified**.

The new read-only operations can establish:

- configured list key matches a list named `KZero Partner Onboarding`;
- list owner is present and matches an explicitly configured expected owner;
- `is_public=false` for list privacy;
- configured topic ID matches a topic named `Partner Onboarding`;
- topic `primaryList` evidence when returned.

They cannot establish a contact's Marketing classification, contact-topic association, inbox deliverability, or actual double-opt-in behavior.

Manual ZMA checks required:

1. Open **Contacts → Lists → KZero Partner Onboarding**.
2. Record the list key, owner, and private/public setting; confirm the expected owner with marketing.
3. Open **Settings → Subscription → Topics** and select **Partner Onboarding**.
4. Record the topic ID and confirm it is assigned to all four intended journey emails.
5. Inspect the account's signup/double-opt-in settings without changing them.
6. In Phase 7B.2, use one consented internal contact to observe whether `listsubscribe` sends confirmation, whether confirmation is required for active membership, and whether the contact becomes Marketing and topic-associated.

Zoho's Subscribe documentation explicitly describes a confirmation email and says existing-contact details update only for a private list. Therefore listsubscribe acceptance must remain `PENDING_CONFIRMATION` or `MANUAL_REVIEW`, never automatically `CONFIRMED`.

## 6. Journey discovery and test copies

Live Get Open Journeys: **not verified**.

The runner supports both `triggerkey` and `trigger_key` and checks:

- J1 — `ONB J1 Welcome and Kickoff Booking`
- J3-R1 — `ONB J3-R1 Next Action Nudge`
- J5 — `ONB J5 Your Next Step Is Ready`
- J8 — `ONB J8 Completion and Expansion`

Get Open Journeys proves only that an open-trigger journey and keys are discoverable. It does not prove a draft is triggerable. Actual triggerability remains `CONTROLLED_TRIGGER_TEST_REQUIRED`; Phase 7B.1 never calls Trigger Leads.

No production or test journey keys are configured locally, so all four production journeys and four test copies are presently unverified. The runner rejects any production/test journey-key or trigger-key collision.

Required test copies:

| Journey | Recommended test name | Test-only adjustment |
|---|---|---|
| J1 | `TEST ONB J1 Welcome and Kickoff Booking` | Shorten waits only in the copy; retain kickoff stop conditions |
| J3-R1 | `TEST ONB J3-R1 Next Action Nudge` | Shorten waits only in the copy; retain `Nudge Status = Done` checks |
| J5 | `TEST ONB J5 Your Next Step Is Ready` | Preserve one-message handoff logic |
| J8 | `TEST ONB J8 Completion and Expansion` | Preserve NFR milestone and recipient rules |

Marketing must approve internal recipients, sender, Reply-To, internal-alert recipients, shortened delays, feedback URL, and assets. Test copies need unique keys, must not use production distribution lists, and must never enroll production MSP/customer contacts.

## 7. Phase 7B.2 contact plan and preview

No synthetic persisted plan or approved test email currently exists in the isolated database, so the real persisted preview was not run. No real customer portal URL was substituted.

The existing mocked snapshot tests verify all 24 custom fields plus three built-ins, exact picklists, kickoff override, timestamps, task owner/status, nudge state, and the stable deep-link form:

```text
/portal/{planId}?tab=tasks&task={templateKey}
```

This is mocked verification, not an end-to-end deployed deep-link result.

Before the first `listsubscribe` call, all items below are required:

1. Create a synthetic NFR case in the isolated database through the approved fixture/admin process.
2. Add a synthetic Customer Plan only if a cross-plan scenario is being tested.
3. Use a real, consented internal recipient entered in both explicit approval and test allowlists.
4. Populate truthful first/last name, contact role, SE name/email/Bookings URL, current stage/task, and `nextTaskSince`.
5. Ensure every task has a stable template key and the plan mapping state is verified.
6. Make the native test plan explicitly automation-active; do not activate a legacy or production case.
7. Assign the single communication context to that plan and verify no competing active plan.
8. Configure a secure test portal base URL and verify normal authorization for the plan/task deep link.
9. Discover all required field identifiers with no missing, ambiguous, or type-mismatched fields.
10. Verify list identity/privacy, topic identity, and test journey keys.
11. Preview the complete snapshot and retain its fingerprint; do not submit it during Phase 7B.1.
12. Confirm individual ADMIN OIDC authorization and same-origin protection.
13. Obtain explicit approval acknowledging that the Phase 7B.2 call may send a double-opt-in email.
14. Keep global kill switch, dispatch, journey triggers, event emission, nudges, and cron disabled; the eventual approved one-contact operation must be invoked directly through its existing controlled route.

## 8. Staff identity status

The Phase 6.5 OIDC implementation is present and mocked authorization tests pass. Real staff OIDC is **not verified**: no approved issuer/client configuration or real staff login evidence is available locally.

Consequently, the sensitive Phase 7B.2 test-sync route remains blocked to the shared access-code session. Do not add a test bypass. Before Phase 7B.2, verify a real ADMIN login, immutable subject, signed role mapping, session expiry/logout, same-origin enforcement, and top-level behavior. Zoho CRM Web Tab behavior remains separately unverified; use the secure top-level sign-in fallback if iframe cookies are restricted.

## 9. Feature posture

The read-only file preserves:

```text
ZOHO_EVENT_EMISSION_ENABLED=false
ZOHO_GLOBAL_KILL_SWITCH=true
ZOHO_JOURNEY_TRIGGERING_ENABLED=false
ZOHO_AUTOMATIC_DISPATCH_ENABLED=false
ZOHO_PRODUCTION_DISPATCH_APPROVED=false
ZOHO_DISPATCH_MODE=disabled
ZMA_NUDGE_EVALUATION_ENABLED=false
ZOHO_TEST_SYNC_ENABLED=false
ZMA_FIELD_MAPPING_VERIFIED=false
ZMA_PRIVATE_LIST_VERIFIED=false
```

There is no cron schedule and no Phase 7B.1 write operation. The runner explicitly rejects `LISTSUBSCRIBE`, `TRIGGER_JOURNEY`, and every operation outside its four read-only discovery calls.

## 10. Automated verification

Phase 7B.1 tests cover missing credentials, incorrect scopes, wrong/unverified organization, missing and ambiguous fields, type mismatches, picklist evidence, missing list/topic, missing/draft-unavailable journeys, missing test journeys, key collisions, unsafe recipients, absent authorization, and attempted write operations.

Evidence categories:

- **Live API:** none; configuration blocked before authentication.
- **Manual ZMA:** none recorded.
- **Real PostgreSQL:** Phase 7A target identity/preflight previously passed; Phase 7B.1 made no database writes.
- **Mocked/unit/static:** Phase 2–6.5 and Phase 7B.1 suites.

Results:

| Suite | Result |
|---|---:|
| Phase 2 | 14 passed |
| Phase 3 | 7 passed |
| Phase 4 | 19 passed |
| Phase 5 | 20 passed |
| Phase 6 | 9 passed |
| Phase 6.5 | 10 passed |
| Phase 7B.1 | 9 passed |

Total: **88 passed, 0 failed**.

The Phase 7A read-only preflight passed again: both endpoint fingerprints agreed on database `postgres`, schema `public`, the exact 12 successful migrations, zero failed migrations, and zero application data rows. `npx prisma generate`, `npx prisma validate`, `npm run build`, and `git diff --check` passed. No browser test or real staff OIDC login was performed.

## 11. Remaining blockers for Phase 7B.2

1. Configure OAuth credentials locally with the documented minimum scopes; do not share them in chat.
2. Record authoritative evidence tying the OAuth owner to `org859403413`.
3. Configure list key, topic ID, expected list owner, production discovery keys, and separate test keys.
4. Run the explicitly authorized read-only harness and resolve every field/list/topic/journey mismatch.
5. Manually verify list privacy/ownership, topic settings, double opt-in settings, journey sender/Reply-To, and test-copy design.
6. Configure and test real staff ADMIN OIDC.
7. Create the synthetic isolated test case and approved consented internal recipient/context.
8. Deploy or otherwise provide an approved secure test portal URL and verify the deep link end to end.
9. Obtain marketing approval for recipients, test sends, sender/replies, delayed-wait shortening, J8 rule, and internal alerts.
10. Keep `ZMA_FIELD_MAPPING_VERIFIED=false` until controlled value-level upsert verification succeeds.

Phase 7B.1 stops here. The next phase requires separate explicit approval before one allowlisted contact write; journey triggering remains a still-later authorization.
