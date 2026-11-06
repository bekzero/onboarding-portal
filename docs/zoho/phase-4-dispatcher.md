# Phase 4: Zoho outbox dispatcher

## Safety status

Phase 4 is implemented but dormant. No production database migration, Zoho write, journey trigger, cron schedule, deployment, or email occurred during implementation. The global kill switch defaults to on, dispatch mode defaults to `disabled`, and contact, journey, automatic-dispatch, and production-approval gates all default to false.

## Dispatcher design

The scheduler-independent dispatcher processes a bounded batch of due `PENDING` or `RETRY` events. It selects the oldest unblocked event for a recipient, atomically claims the outbox event and its communication context, reloads authoritative plan/contact/task state, applies subscription and context gates, builds a fresh persisted contact snapshot, synchronizes the contact, and only then submits a valid journey trigger. Network requests are never made inside database transactions.

Events retain their immutable key, sequence, original payload snapshot, and transition identity. Dispatch uses current database state rather than trusting the snapshot. Provider outcome, last attempt, sanitized error, retry time, and processing duration are persisted.

## Claim, lease, and concurrency strategy

The additive Phase 4 migration adds:

- a recipient-wide processing lease to `ZohoCommunicationContext`;
- `version`-based fencing for that lease;
- stop-state priority and attempt/outcome observability fields on `ZohoOutboxEvent`;
- `ZohoApiThrottle`, a shared PostgreSQL-backed counter for contact and journey API limits.

Candidate rows use `FOR UPDATE SKIP LOCKED`. Earlier unfinished recipient sequences block later sequences. The communication-context lease remains owned for the complete external processing window, so two workers cannot perform plan-specific writes for the same email. Final event and journey-ledger writes require the same claim ID and context version. An expired/stale worker therefore cannot overwrite a newer worker's result.

Expired processing leases are conservatively moved to `HELD` with `PROCESSING_LEASE_EXPIRED_OUTCOME_UNCERTAIN`; they are not automatically retried. This favors duplicate prevention over speculative delivery.

## Contact sync and journey triggering

Every journey operation performs contact synchronization first. The dispatcher requires verified field mapping, verified private-list configuration, current communication-context ownership, and a non-suppressed recipient. Journey triggering additionally requires `CONFIRMED` subscription eligibility and current event applicability.

The Trigger Leads implementation uses:

`POST /api/v1/journeys/{journey_key}/action/trigger?details={encoded JSON}`

The details contain `lead_email`, `triggerkey`, and `listkey`. The required scope is `ZohoMarketingAutomation.journey.CREATE`. A 200 response is not sufficient: the requested email must appear in exactly one of `triggered_leads`, `already_triggered`, or `ignored_leads`.

Test mode requires separate `ZMA_TEST_*` journey and trigger keys. A test key matching its production counterpart is rejected. The test plan and normalized recipient email must be explicitly allowlisted.

## Idempotency and stale events

Per-recipient sequence order, unique outbox event keys, and the existing journey dedupe ledger are all checked. A ledger result of `TRIGGERED` or `ALREADY_TRIGGERED` completes a replay without another call. An attempted `UNKNOWN` result is held for reconciliation and is never retried automatically.

Before Trigger Leads, the dispatcher cancels obsolete events with specific reasons:

- J1 when kickoff is booked or kickoff is no longer current;
- J3-R1 when the nudged task is complete, changed, or no longer MSP/Shared-owned;
- J5 when the handed-off task is complete, changed, or no longer MSP/Shared-owned;
- J8 unless it is the approved NFR `complete-first-customer-rollout` milestone and marketing approval is present.

Cancellation preserves the event. A newer stop-state contact event can then advance in recipient order.

## Stop-state behavior

Events created when a nudge finishes, a plan pauses/completes, J8 completes, or kickoff is booked/corrected are explicitly marked as stop-state synchronization. Plan pause/completion and task changes do not make those contact updates stale. They still require the same communication-context owner.

An `INELIGIBLE` recipient is never resubscribed. A required stop update for such a recipient is held as `CRITICAL_STOP_STATE_RECIPIENT_SUPPRESSED`; operations must verify the Zoho journey state manually. The portal does not claim that reminders stopped.

## Retry and throttling

Confirmed transient failures use bounded delays of 1, 5, 15, and 60 minutes, with at most five attempts. `Retry-After` takes precedence. Database-shared five-minute limits are 500 contact-sync calls and 100 Trigger Leads calls. Exhaustion or a provider rate-limit response blocks that API for a conservative 30-minute period (or longer `Retry-After`). There is no infinite loop.

A timeout, invalid response, or network loss after Trigger Leads begins is `UNKNOWN`, not retryable. A failure before Trigger Leads (including contact synchronization) does not falsely mark the journey as attempted.

## Unknown-outcome reconciliation

An authenticated administrator can reconcile a held uncertain journey event through the dedicated route only after reviewing Zoho evidence. A reason and evidence reference are mandatory. Available outcomes are:

- `CONFIRM_TRIGGERED`: mark the ledger accepted and the event succeeded;
- `CONFIRM_NOT_TRIGGERED_RETRY`: record verified non-triggering and explicitly requeue;
- `CANCEL`: retain the history and cancel the event.

Each action writes `ZohoAutomationAudit`. This is manual reconciliation; the portal does not claim exactly-once provider delivery.

## Secure execution endpoints

- `GET /api/cron/zoho-dispatch` requires `Authorization: Bearer <CRON_SECRET>`, a secret of at least 16 characters, and the automatic-dispatch flag. It returns counts only.
- `POST /api/admin/zoho/dispatch` requires the existing admin session, test mode, and the exact confirmation `DISPATCH ALLOWLISTED ZOHO TEST EVENTS`.
- `GET /api/admin/zoho/dispatch` returns aggregate server-side queue status.
- `POST /api/admin/zoho/dispatch/{eventId}/reconcile` performs the audited uncertain-result workflow.

No query-string secret and no `vercel.json` cron schedule were added.

## Environment variables

Existing Phase 2 variables remain required. Phase 4 adds:

```text
ZOHO_GLOBAL_KILL_SWITCH=true
ZOHO_CONTACT_SYNC_ENABLED=false
ZOHO_JOURNEY_TRIGGERING_ENABLED=false
ZOHO_AUTOMATIC_DISPATCH_ENABLED=false
ZOHO_PRODUCTION_DISPATCH_APPROVED=false
ZOHO_DISPATCH_MODE=disabled
ZOHO_DISPATCH_BATCH_SIZE=10
ZOHO_DISPATCH_LEASE_SECONDS=120
CRON_SECRET=
ZMA_TEST_J1_JOURNEY_KEY=
ZMA_TEST_J1_TRIGGER_KEY=
ZMA_TEST_J3_JOURNEY_KEY=
ZMA_TEST_J3_TRIGGER_KEY=
ZMA_TEST_J5_JOURNEY_KEY=
ZMA_TEST_J5_TRIGGER_KEY=
ZMA_TEST_J8_JOURNEY_KEY=
ZMA_TEST_J8_TRIGGER_KEY=
```

To run an approved isolated test, apply Phases 1A and 4 to the isolated database, configure separate test journeys, allowlist one internal email and test plan, enable Phase 2 test sync plus contact/journey gates, set mode to `test`, and only then turn the global kill switch off. Use the preview/test fixture process before manually dispatching a single event. Never copy these flags to production as a group.

## Validation completed

- Prisma client generation and schema validation.
- Phase 2 tests (14 passing).
- Phase 3 tests (7 passing).
- Phase 4 mocked/parser/rule/security tests, including contact-before-trigger, short-circuit on contact failure, accepted/already/ignored responses, stale J1/J3/J5/J8 rules, retry schedule, kill switch, allowlists, claim/fence source invariants, and endpoint authorization.
- Next.js production build.
- `git diff --check`.

No live Zoho tests were authorized or performed. No approved isolated migrated database was available, so PostgreSQL runtime tests for concurrent claims, lease recovery, sequence ordering, transaction rollback, context contention, and shared throttling remain unverified. Static implementation and mocked provider checks do not replace those tests.

## Launch blockers and Phase 5 prerequisites

1. Back up production and test the Phase 1A and Phase 4 additive migrations against an approved production-like copy.
2. Run concurrent dispatcher integration tests against PostgreSQL, including deliberately expired and fenced workers.
3. Verify all 24 field identifiers and private-list behavior with controlled Zoho test evidence.
4. Confirm Partner Onboarding topic/Marketing eligibility for test recipients.
5. Create and verify separate test journeys, then validate all four journeys without production recipients.
6. Reconfirm the marketing approval for the NFR-only J8 rule.
7. Transfer and validate the company Vercel project, Prisma Postgres, Blob, domains, GitHub deployment, and environment variables.
8. Configure a strong `CRON_SECRET`; only on the supported company plan add the eventual `*/5 * * * *` schedule.
9. Obtain explicit production sending approval before changing any dormant flag.

Phase 5 should add the operational admin dashboard, held/conflict resolution controls, production context assignment/release workflows, alerting for critical stop failures and unknown outcomes, and the fully tested scheduler rollout procedure.
