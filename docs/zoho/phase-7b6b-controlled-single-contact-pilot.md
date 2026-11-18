# Phase 7B.6B — Controlled Single-Contact Pilot

## Status

Implemented but dormant. No live Zoho request, production database mutation, Vercel configuration change, deployment, or migration was performed during implementation.

The operation reads the exact plan and contact from `ZOHO_MSP_ENROLLMENT_PILOT_PLAN_ID` and `ZOHO_MSP_ENROLLMENT_PILOT_EMAIL`. Browser input cannot select a recipient or mailing list. `ZOHO_SINGLE_CONTACT_PILOT_ENABLED` defaults to `false` when absent.

## Authorization and execution gates

Execution requires all of the following at the time of the request and again while the durable reservation lock is held:

- individually authenticated Staff SSO `ADMIN`;
- trusted same-origin request and exact confirmation phrase;
- exact server-side pilot plan and primary-contact match;
- valid matching Onboarding Owner;
- individually attributable permission evidence;
- active native plan and automation-enabled owner;
- active communication context owned by the selected plan;
- subscription status explicitly verified as `CONFIRMED`;
- OAuth and the server-side ListKey configured;
- persisted private-list verification and a fresh read-only list lookup returning exactly one `KZero Partner Onboarding` list with `is_public=false`;
- manually recorded evidence that the Zoho list has no unintended active journey, workflow, campaign, or email side effect;
- no unresolved enrollment contact-sync outbox event;
- `ZOHO_SINGLE_CONTACT_PILOT_ENABLED=true`;
- `ZOHO_GLOBAL_KILL_SWITCH=false` for the separately approved maintenance window;
- dispatch mode `disabled` and every automatic or test write path disabled.

The global kill switch is authoritative. With it enabled, execution is blocked. Releasing it alone is also insufficient: enrollment sync, event emission, general contact sync, automatic dispatch, production approval, journey triggering, nudge evaluation, and existing test-write modes must all remain disabled. The pilot does not create or release outbox events.

## Subscription and suppression handling

The preview and execution use the existing bounded `getleads` scanner for active, unsubscribed, and bounced categories.

- Any incomplete scan returns `UNABLE_TO_VERIFY`.
- Unsubscribed or bounced membership returns `BLOCKED` without a write.
- Active membership returns `ALREADY_EXISTS` without a write.
- Local `UNKNOWN`, `PENDING_CONFIRMATION`, or `MANUAL_REVIEW` subscription state blocks execution even when the contact is absent from the list.
- Deletion from the list is not treated as consent to resubscribe.

The current BenMSP diagnostic reported `UNKNOWN`; therefore a separately reviewed, evidence-backed subscription verification remains a live-pilot blocker. Permission attestation is not automatically treated as independent marketing-subscription proof.

## Durable one-shot behavior

The append-only `ZohoAutomationAudit` ledger is reused; no schema migration is required.

Before the provider write, the server acquires a PostgreSQL advisory transaction lock for the exact plan/email pair, re-reads consequential state, and commits one `msp_pilot.execution_reserved` audit record. The audit record ID is the unique execution request ID. Every process and restart checks this reservation. Once it exists, the provider add operation can never run again for that pilot identity; later requests perform membership verification only.

A timeout or lost response after the reservation is classified `UNABLE_TO_VERIFY` and consumes the single attempt. It must not be retried. Provider acceptance is `ACCEPTED_PENDING_VERIFICATION` until a complete read-only scan finds active membership. The UI never reports `VERIFIED` from acceptance alone.

## Auditing

The ledger records the plan, normalized recipient, Staff SSO actor, unique request ID, timestamps, authorization or execution stage, whether a provider write may have occurred, provider outcome classification, verification outcome, and final classification. Tokens, ListKeys, authorization headers, and raw provider bodies are not stored.

## Admin experience

`Case Preview → Zoho Automation → Controlled Contact Sync Pilot` shows the server-selected MSP/contact, destination list name, execution authorization, fresh membership status, previous reservation/outcome, verification time, and blockers.

- **Preview Sync** is read-only. It may call Zoho read APIs but creates no reservation or audit/outbox event.
- **Run Single-Contact Pilot** is disabled until the local readiness gates and a fresh complete preview pass. It requires the exact confirmation phrase.
- **Record Review** records an individually attributable, evidence-referenced Zoho UI review of downstream automation. It does not call Zoho or authorize subscription consent.

## Safe deployment

1. Deploy code with `ZOHO_SINGLE_CONTACT_PILOT_ENABLED` absent or `false` and the global kill switch still `true`.
2. Confirm all existing automatic, dispatch, journey, nudge, and test-write flags remain disabled.
3. Confirm the Case Preview shows the configured target and execution is not authorized.
4. Use **Preview Sync** only when an approved read-only provider check is desired.

Deployment alone cannot execute the pilot.

## Separately authorized live-pilot procedure

Do not proceed until a change owner separately approves the maintenance window.

1. Verify subscription eligibility as `CONFIRMED` using authoritative evidence; retain `UNKNOWN` if that evidence is unavailable.
2. In Zoho, verify the exact private list has no active list-entry journey, workflow, campaign, autoresponder, or other email side effect. Record the approved evidence reference while the global kill switch remains on.
3. Confirm there is no prior reservation and no unresolved enrollment event.
4. Confirm all non-pilot flags remain false, nudge/test-write modes are disabled, and dispatch mode is `disabled`.
5. Set only the manual pilot flag to true while the kill switch remains on; deploy and confirm execution is still blocked.
6. At the approved maintenance window, release only the global kill switch. Reconfirm the complete flag matrix and run **Preview Sync**.
7. Continue only if the scan is complete, finds no active/unsubscribed/bounced membership, and the UI reports execution authorized.
8. Use **Run Single-Contact Pilot** once and enter the exact confirmation phrase. Do not retry an uncertain or pending result.
9. Use read-only preview for later verification if required.
10. Restore `ZOHO_GLOBAL_KILL_SWITCH=true` and `ZOHO_SINGLE_CONTACT_PILOT_ENABLED=false`, then verify all other safeguards are unchanged.

If any prerequisite cannot be established, keep execution disabled. Zoho Topics and journey triggering remain outside this pilot and blocked.
