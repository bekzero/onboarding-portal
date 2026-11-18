# Phase 7B.6A — controlled enrollment-contact pilot preparation

## Administrative readiness controls

The MSP Case Preview now exposes three narrowly scoped controls for the configured single-contact pilot. They require an individually authenticated Staff SSO `ADMIN`, an exact server-side plan/email target match, and existing individually attributable permission evidence.

- **Approve Plan & Owner** uses the existing `automationEnrollmentState` and `PlanContact.automationEnabled` fields. It is limited to native plans and records `msp_pilot.automation_approved` in `ZohoAutomationAudit`.
- **Assign Context** uses the existing one-context-per-normalized-email `ZohoCommunicationContext` ledger. It refuses blocked, release-pending, foreign-owned, competing, or ineligible contexts and records `msp_pilot.communication_context_assigned`.
- **Verify List Privacy** uses the documented, bounded, read-only Get Mailing Lists discovery. It requires one exact configured list-name/key match with `is_public=false`, then records sanitized evidence as `zoho.mailing_list.privacy_verified`. It never stores or returns the ListKey.

All actions are idempotent and re-read persisted readiness after completion. They do not create/release outbox events, subscribe contacts, trigger journeys, change feature flags, or bypass the global kill switch. The privacy API may return no authoritative `is_public` value for some portals; in that case verification fails closed and requires investigation with Zoho Support.

## Outcome

Phase 7B.6A adds a read-only, MSP-specific pilot-readiness preview. It does not add a contact-sync action, create or release outbox events, call Zoho, or enable any production automation control.

## Current eligibility and preparation gates

The existing enrollment preparation path requires documented permission with a nonempty evidence reference, an individually attributable staff identity, a valid primary contact that matches the Onboarding Owner, an automation-active plan and contact, active communication-context ownership, event emission, and enrollment-sync preparation enablement. Dispatch independently revalidates the current plan, contact, permission audit, subscription state, context, provider configuration, and all dispatch controls.

The pilot preview is narrower. A future candidate must additionally match exactly one server-side plan/email pair, be viewed by an individually authenticated `ADMIN`, have no unresolved enrollment event, have OAuth and the ListKey configured, and have approved list-privacy evidence. Phase 7B.6A also requires the global kill switch to remain enabled and automatic dispatch disabled.

## Primary-contact formatting finding

`Msp.primaryContactEmail` and the initially created Onboarding Owner were previously persisted using whitespace trimming only. The Case Preview displays the persisted value directly. It does not append a semicolon. Therefore a displayed trailing semicolon is consistent with stored/API data, not UI formatting. This phase does not rewrite historical records. New MSP creation and changed primary-contact values now use the existing strict email validator, so punctuation such as a trailing semicolon is rejected instead of silently removed. An unrelated edit may preserve an unchanged historical malformed value, but that value remains invalid and blocked from Zoho readiness.

The observed Production row was not queried or modified during this implementation. An authorized administrator must review and correct it through the existing administrative workflow if the semicolon is present in persisted data.

## Provider-readiness distinction

The email-only bulk-list path uses OAuth, the configured KZero Partner Onboarding ListKey, `getleads`, and `addleadsinbulk`. It does not submit custom fields, require a Topic ID, or trigger a journey.

The older broad readiness warning also required `ZMA_FIELD_MAPPING_VERIFIED` and `ZMA_PRIVATE_LIST_VERIFIED`, because the general dispatcher and journey integration were designed around full automation readiness. The pilot preview now reports these layers separately:

- Email-only API configuration: OAuth plus ListKey.
- List safety evidence: approved private-list verification.
- Full automation configuration: field mappings, topics where applicable, and journey keys/readiness.

No dispatcher gate was weakened in Phase 7B.6A.

## Proposed Phase 7B.6B mechanism

The safe design is a separate, explicit, one-time administrative operation, not release of a normal or historical outbox event. It should require:

1. Individually authenticated Staff SSO `ADMIN` authorization and trusted same-origin validation.
2. An exact match against `ZOHO_MSP_ENROLLMENT_PILOT_PLAN_ID` and `ZOHO_MSP_ENROLLMENT_PILOT_EMAIL`.
3. A fresh re-read of the persisted MSP, Onboarding Owner, permission audit, context, subscription state, and prior outbox/audit outcomes.
4. Explicit confirmation naming the selected MSP and masked recipient.
5. A unique one-time audit claim preventing duplicate submission.
6. Pre-write `getleads` verification, suppression protection, one email-only `addleadsinbulk` call, and post-write verification.
7. Verification-only retries after an accepted-but-not-visible result.
8. No journey trigger, topic operation, historical HELD-event release, or automatic dispatcher execution.

Because the production global kill switch must remain enabled and Phase 7B.6A has no live action, the precise authorization relationship between that kill switch and a future test-only call must receive separate approval before Phase 7B.6B. This phase does not introduce a bypass.

## Configuration placeholders

```text
ZOHO_MSP_ENROLLMENT_PILOT_PLAN_ID=
ZOHO_MSP_ENROLLMENT_PILOT_EMAIL=
```

Both are server-only and must identify exactly one approved pair. Populating them only affects the read-only preview; it does not enable synchronization.

## Remaining live-pilot blockers

- Approve the permission-evidence standard as sufficient for this operational list-add test; the portal record is not independent proof of marketing consent.
- Correct and revalidate any malformed persisted primary contact through an authorized workflow.
- Configure one approved pilot pair server-side.
- Confirm list privacy and the exact list identity.
- Resolve any existing enrollment outbox event for the pair without bulk releasing HELD work.
- Approve and implement a one-time Phase 7B.6B endpoint and audit claim.
- Decide how the test-only operation remains subject to the global kill switch; it may not silently bypass it.
- Perform an authorized live Staff SSO `ADMIN` session test.

Phase 7B.6B is not yet authorized to perform a live synchronization.
