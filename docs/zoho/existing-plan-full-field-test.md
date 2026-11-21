# Existing-plan full-field Zoho test

This procedure prepares and dispatches one full-field `UPSERT_CONTACT` event for the exact server-configured MSP pilot target. It does not create a journey event. Preparation is safe only while the global kill switch is enabled and all sending paths are disabled.

## Dormant deployment and preparation

1. Deploy the reviewed code without changing any Zoho environment value.
2. Verify the Production configuration still has the global kill switch enabled and event emission, contact synchronization, automatic dispatch, production approval, journeys, nudges, enrollment sync, the single-contact pilot, and test-contact writes disabled. Dispatch mode must be `disabled`.
3. Sign in through Staff SSO as an individually authenticated `ADMIN`.
4. Open **BenMSP → Case Preview → Zoho Automation**.
5. Confirm the server-selected target is `benmsp-nfr` and `b.eakin@kzero.com`.
6. If **Full-field lifecycle test** already shows an event, do not prepare another one. Record its event ID, status, attempt count, and Event History row.
7. Otherwise select **Prepare Full-Field Intent** and enter exactly:

   ```text
   PREPARE ONE FULL-FIELD ZOHO TEST INTENT
   ```

8. Preparation performs fresh active/unsubscribed/bounced membership reads, loads the persisted contact snapshot, and creates one `PENDING` event. It makes no Zoho write.
9. In **Zoho Automation → Event History**, filter by plan `benmsp-nfr`, recipient `b.eakin@kzero.com`, and type **Contact sync**. Record the event ID and confirm `attempts=0`.
10. Confirm the audit ledger contains `test_j1.existing_plan_contact_intent_prepared` with the same plan, recipient, Staff SSO actor, and event ID evidence reference.

## Separately authorized one-event maintenance window

Do not start this window until the prepared event and the current Production environment have been independently reviewed.

1. Save the safe Production environment evidence and current safe deployment ID.
2. Configure the already established test-dispatch window so that:
   - `ZOHO_GLOBAL_KILL_SWITCH=false`;
   - `ZOHO_DISPATCH_MODE=test`;
   - `ZOHO_CONTACT_SYNC_ENABLED=true`;
   - `ZOHO_TEST_SYNC_ENABLED=true`;
   - the test plan allowlist contains only `benmsp-nfr`;
   - the test email allowlist contains only `b.eakin@kzero.com`;
   - `ZMA_TOPIC_ID=1329658000000062845` and the approved private ListKey remain configured;
   - field mapping and private-list verification evidence are enabled only after their separate approvals;
   - event emission, automatic dispatch, production approval, journeys, nudges, enrollment sync, test-contact writes, and the single-contact email-only pilot remain disabled.
3. Create a temporary maintenance deployment and verify its configuration status in the portal before dispatch.
4. Reopen the exact event in the BenMSP case. The **Dispatch Exact Test Event** button is enabled only for the isolated posture above.
5. Select it and enter exactly:

   ```text
   DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT
   ```

6. The server verifies the submitted event ID against the server-configured plan/email intent and claims only that row. It then runs the normal dispatcher revalidation and fresh membership scan.
7. Do not invoke the generic batch confirmation during this test.
8. Restore the safe environment values immediately through a new safe deployment, verify the Production alias, and retire the temporary maintenance deployment according to the approved Vercel runbook.

## Evidence to review

In KZero, record the event status, attempt count, sanitized provider outcome, audit actor, and timestamps. `SUCCEEDED` means the provider accepted the contact operation; it is not proof of delivery or journey execution.

In Zoho, verify the exact contact and list, topic association, and all 24 supported outbound display-name fields. Confirm that `Next Task Since`, `Last SE Touch`, and `Last MSP Activity` were not sent. For `Apps Submitted` and `Apps Approved`, a blank Zoho field may represent an intentionally synchronized numeric zero; compare against the KZero snapshot. Confirm no journey, campaign, autoresponder, workflow, or email was triggered.

If the response is not application code `0` with `status=success`, treat the operation as failed or uncertain according to the recorded outbox state. Never prepare a second event to retry a timeout or uncertain provider outcome.
