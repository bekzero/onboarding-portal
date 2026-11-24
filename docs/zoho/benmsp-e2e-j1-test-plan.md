# BenMSP E2E TEST J1 plan

## Scope and current decision

Use `b.eakin@kzero.com` as the Onboarding Owner for a new NFR case named **BenMSP E2E Test**. The address was manually deleted from Zoho Marketing Automation before this plan was written. Ordinary Zoho deletion may retain or restore historical contact data, so deletion is not evidence of a clean contact record, consent, suppression status, or journey re-entry eligibility.

The portal derives this identity from the requested case name:

- MSP name: `BenMSP E2E Test`
- slug: `benmspe2etest`
- plan ID: `benmspe2etest-nfr`
- recipient: `b.eakin@kzero.com`
- destination: private list `KZero Partner Onboarding`
- topic ID: `1329658000000062845`

Do not substitute `benmsp-nfr`; that is the earlier plan with its own completed contact-sync event and audit history. KZero event and journey deduplication include the plan ID, so the new plan receives distinct stable keys. Recipient sequencing remains email-scoped, which is intentional: every earlier event for this address must already be terminal before new work can run.

**Current status: GO for a dormant deployment; the J1 Tip/Guide template-evidence blocker is resolved.** Reusing the address is not demonstrably impossible and a new mailbox is not required. The code provides an audited old-context retirement, a distinct enrollment-only preparation gate, and exact event-ID selection. All remaining provider, consent, suppression, context, freshness, and exact-event gates remain mandatory.

No Production setting, KZero record, Zoho contact, or journey is changed by this plan.

## Blocking prerequisites

### 1. Retire the old KZero communication identity safely

The earlier `benmsp-nfr` contact is automation-enabled and its `ZohoCommunicationContext` owns normalized email `b.eakin@kzero.com`. TEST J1 enrollment rejects both an active context owned by another plan and another automation-active contact using the same normalized email.

The current admin-center release buttons are placeholders and the shared sensitive action route returns `SENSITIVE_WORKFLOW_NOT_IMPLEMENTED`. Do not edit the database directly, delete the old MSP, change its email merely to evade the check, or reuse its context for the new plan. Outbox and journey rows use restrictive relations and must remain auditable.

The Case Preview now provides one narrow Staff SSO ADMIN operation that atomically:

1. locks `zoho-context:b.eakin@kzero.com`;
2. verifies every old recipient event is terminal (`SUCCEEDED`, `CANCELLED`, `DEAD`, or explicitly reconciled) and no processing lease exists;
3. verifies no old journey has an uncertain result;
4. marks the old plan/contact ineligible for future automation without altering its historical audit, event, or journey rows;
5. changes the old context to `UNASSIGNED`, clears `activePlanId`, and records attributable release evidence and reason;
6. writes a non-dispatchable audit record naming the old plan, recipient, Staff SSO actor, and intended successor plan ID;
7. creates no outbox event and calls no Zoho provider.

After that operation, a read-only check must show one `UNASSIGNED` context, no automation-active competing owner, and no unresolved event for the recipient.

### 2. J1 template freshness evidence

The assigned J1-1 HTML asset `1329658000000062164` and J1-2 HTML asset `1329658000000062893` were reviewed in full on November 24, 2026. Neither export contains the `Next Task Tip` or `Next Task Guide URL` display name, merge-field identifier, or a case variant. Both fields are therefore `VERIFIED_NOT_USED` for J1 only. J3-R1/J3-R2 and J5 retain their independent guidance requirements.

### 3. Exact selection for both new lifecycle events

The dedicated exact-event endpoint accepts the new plan-created full-field `UPSERT_CONTACT` and `TRIGGER_JOURNEY/J1` events only when `ZOHO_EXACT_EVENT_IDS` contains exactly the selected event ID and the plan/email allowlists contain exactly the new plan and recipient. Generic dispatch remains unavailable while exact-event maintenance is enabled.

The contact and J1 events use different confirmation phrases and separate maintenance deployments. J1 also requires an individually attributable audit tying independent Zoho field verification to the exact successful contact event, and the persisted KZero snapshot must remain byte-for-byte equivalent at authorization and claim time. The exact J1 path triggers the journey only; it does not silently repeat the already verified contact write.

## Phase A: read-only recipient preflight

Complete these checks immediately before opening the Enroll MSP form:

1. Verify Production remains dormant: global kill switch `true`; dispatch mode `disabled`; contact sync, event emission, automatic dispatch, production approval, journeys, nudges, enrollment sync, legacy/test writes, single-contact pilot, and exact-event maintenance all disabled.
2. In **Zoho Admin Center > Test Contact Sync**, run only **Check Contact** for the already allowlisted email. Require complete bounded scans of `active`, `unsub`, and `bounce` membership for the exact private list.
3. Interpret the result fail-closed:
   - `unsub` or `bounce`: stop; the address is ineligible and must not be resubscribed;
   - incomplete pagination, provider error, or unknown suppression state: stop;
   - active membership: do not write; inspect why deletion did not remove or permanently removed only one representation;
   - absent from all three complete scans: the integration may attempt `listsubscribe` later, subject to independently supported permission/subscription evidence.
4. Search Zoho **All Contacts**, the exact private list, and the contact Timeline. Record whether the deleted contact or archived history remains visible. Do not infer consent from absence.
5. If Zoho exposes the record, capture the existing values for all 24 supported fields. Pay particular attention to `Plan ID`, `Portal URL`, `Next Task ID`, `Next Task Title`, `Next Task Link`, `Next Task Tip`, `Next Task Guide URL`, `Nudge Status`, `Apps Submitted`, and `Apps Approved`.
6. Open the exact isolated TEST J1 journey and use **Trace Contact Path** for `b.eakin@kzero.com`. Record whether the address previously entered, exited, or remains active. J1 is not documented as re-entry-enabled. If the same TEST J1 asset rejects prior participants, use a newly reviewed isolated TEST J1 clone and new test keys rather than requiring another email address.
7. Confirm the private-list setting, numeric topic, field metadata, OAuth presence/scopes, sender, return path, and downstream-automation review remain valid. Read-only API success does not establish recipient-level journey history.
8. In KZero, query the old plan by plan ID and recipient. Confirm its earlier contact event is terminal, no `PENDING`, `RETRY`, `HELD`, or `PROCESSING` row remains, and no journey send is `UNKNOWN`.

## Phase B: prepare the new case without sending

Do not begin until the three blocking prerequisites and Phase A are complete.

1. Create a temporary, reviewed preparation deployment. Keep the global kill switch enabled and every provider-write, journey, nudge, cron, automatic-dispatch, and production-approval path disabled.
2. Configure only the existing TEST J1 preparation inputs for the new identity:
   - exactly one plan allowlist entry: `benmspe2etest-nfr`;
   - exactly one email allowlist entry: `b.eakin@kzero.com`;
   - dispatch mode `test` for preparation validation;
   - the existing private ListKey and topic `1329658000000062845`;
   - verified field mapping and private-list evidence;
   - distinct TEST J1 journey and trigger keys that do not equal Production J1 keys.
3. Set only `ZOHO_TEST_J1_ENROLLMENT_ENABLED=true` for the atomic preparation. Keep legacy `ZOHO_TEST_SYNC_ENABLED=false`, the kill switch on, contact synchronization off, journeys off, automatic dispatch off, and test-contact writes off. The enrollment gate can create the two durable events but cannot call Zoho.
4. Sign in with an individually authenticated Staff SSO `ADMIN` account and open **Enroll MSP**.
5. Enter:
   - MSP Name: `BenMSP E2E Test`;
   - Plan Type: `NFR`;
   - Primary Contact First Name: `Ben`;
   - Primary Contact Last Name: `Eakin`;
   - Primary Contact Email: `b.eakin@kzero.com`;
   - Assigned Sales Engineer Name: the current approved Staff SSO/plan value;
   - Assigned Sales Engineer Email: the current approved assigned-SE value (do not copy from the primary contact field implicitly);
   - Assigned Sales Engineer Booking URL: the current approved Bookings URL;
   - Stage: `Kickoff`, Progress: `0`, Submitted Apps: `0`;
   - current access/OIDC details required for the real test case.
6. Confirm Zoho permission only when genuine evidence supports this exact onboarding/list use. Enter a new evidence reference attributable to the new plan. Do not reuse the old plan's audit row as if it belonged to the new case.
7. Select **Prepare the exact allowlisted full-field contact and isolated TEST J1 intents** and save once.
8. Restore the safe project-level Production configuration immediately after preparation and use a new safe deployment for restoration. Do not dispatch while preparing.

The enrollment transaction must produce:

- plan ID `benmspe2etest-nfr` with native active automation enrollment;
- a new Onboarding Owner contact with subscription status `UNKNOWN`;
- an attributable permission audit for the new plan;
- a communication context owned only by the new plan;
- one plan-created full-field `UPSERT_CONTACT` event;
- one plan-created `TRIGGER_JOURNEY/J1` event, initially `HELD` for subscription when status is not `CONFIRMED`;
- one `test_j1.enrollment_intents_prepared` audit;
- no provider request.

Verify stable keys include `benmspe2etest-nfr`, event payload `Plan ID` equals that value, the first task is `book-kickoff` in `waiting_on_msp`, and no old `benmsp-nfr` event ID is attached to the new plan.

## Phase C: controlled contact upsert and stale-value inspection

This phase needs separate authorization and a reviewed exact contact-event maintenance window.

1. Re-run the complete active/unsubscribed/bounced scan. Stop on suppression or uncertainty.
2. Dispatch only the new plan's exact `UPSERT_CONTACT` event. Do not release J1 in the same operation.
3. Require HTTP success plus Zoho application `code=0` and `status=success`. An accepted-but-unverified or uncertain result must never be repeated automatically.
4. Verify active membership and topic eligibility after acceptance.
5. Reconstruct the current immutable KZero snapshot and compare every supported outbound field against Zoho.
6. Specifically classify historical restoration:
   - a value equal to the new snapshot is current;
   - a nonempty Zoho value where KZero sent empty is retained/restored and not current;
   - a blank/dash for numeric zero is the known Zoho zero representation, not a sync failure;
   - the three unsupported Date/Time fields remain excluded.
7. For `Next Task Tip`, expect only the approved current kickoff-task tip from KZero. For `Next Task Guide URL`, expect unavailable/empty unless an approved kickoff guide exists. If Zoho restores an old Tip or root/old Guide URL, record it as stale and do not retry speculative clearing.
8. Compare `First Name`, `Last Name`, `Lead Email`, Plan ID, portal/task links, assigned-SE identity, and booking URL to the event snapshot. KZero remains authoritative.

Do not proceed to J1 while any template-consumed field is stale or cannot be proven current.

## Phase D: subscription decision and isolated TEST J1

1. Record a new plan-scoped subscription decision only with genuine, independently supportable evidence authorizing the exact private-list addition. Enrollment, the NFR agreement, deletion from the list, absence from suppression lists, and the old plan's permission record are not sufficient by themselves.
2. Use the existing authenticated subscription-verification operation to set the new contact to `CONFIRMED`. The operation must write a new attributable audit and release only the new plan's held J1 event. Preserve all other events and blockers.
3. Re-run readiness. Require current context ownership, permission, subscription, complete suppression scan, private list/topic/field verification, current task snapshot, distinct TEST J1 keys, and no earlier unresolved recipient event.
4. Confirm TEST J1 accepts this recipient. A previous path on the same journey asset may return `ALREADY_TRIGGERED`; that is not acceptance evidence for a new J1 test. Use a newly reviewed TEST J1 clone if provider history blocks re-entry.
5. After the contact event succeeds, compare the current Zoho values with its stored snapshot and record the exact contact-event field-verification audit. A provider acceptance alone is insufficient.
6. Create a separately authorized temporary maintenance deployment that permits only the exact J1 event. Set `ZOHO_EXACT_EVENT_IDS` to that single ID, enable only exact dispatch, contact-sync validation, journey triggering, and the isolated TEST J1 keys. Keep event emission, automatic dispatch, production approval, enrollment sync, nudges, legacy test-contact writes, the single-contact pilot, and every Production journey key disabled.
7. Dispatch the exact J1 event once through the reviewed exact-event operation. The dispatcher revalidates the independently verified contact-event snapshot and triggers only the isolated TEST J1; it does not repeat `listsubscribe`. Hold an uncertain trigger outcome without retrying it.
8. Immediately restore and promote a prebuilt safe deployment, then verify the kill switch and all write gates are disabled across Production traffic.

## Acceptance evidence

The J1 test is successful only when all of the following are recorded:

- the new case and both events belong to `benmspe2etest-nfr`;
- no old BenMSP event was replayed or reassigned;
- contact membership is active, not unsubscribed/bounced, and topic-eligible;
- the 24-field payload matches the current KZero snapshot, with stale restored values explicitly identified;
- unsupported Date/Time fields were omitted and zero counters were interpreted correctly;
- the isolated TEST J1 provider result is `TRIGGERED`, not merely `ALREADY_TRIGGERED` or HTTP 200;
- J1-1 arrives once with the correct first name, assigned-SE identity, booking link, and new plan portal URL;
- the journey trace shows exactly one entry into the isolated TEST J1;
- booking kickoff during the wait updates the stop-state fields and prevents J1-2 in the test journey;
- no Production journey, nudge, campaign, autoresponder, unrelated MSP, or old BenMSP event is affected;
- Production is restored to the dormant configuration.

## Stop conditions

Stop without requiring a new mailbox when any check is uncertain. A new email address is necessary only if Zoho Support or an isolated TEST J1 proves that this exact address cannot be re-added or cannot enter a newly cloned TEST J1 because of irreversible provider-level history. Suppression, missing consent, incomplete scans, stale template-consumed fields, unresolved KZero context ownership, or absent exact-event isolation are blockers to resolve, not reasons to bypass safeguards.
