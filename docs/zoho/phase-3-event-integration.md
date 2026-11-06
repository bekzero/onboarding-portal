# Zoho Marketing Automation Phase 3 event integration

Status: implemented, dormant, and not database-runtime-tested

Phase 3 connects persisted onboarding mutations to the Phase 1A transactional outbox. It records immutable contact-sync and approved journey-event intent only. It contains no Zoho write call, journey trigger adapter, dispatcher, cron schedule, or email sending.

The Phase 1A migration is still not applied to production. Do not deploy Phase 1B, Phase 2, or Phase 3 code against the old production schema.

## Safety configuration

```text
ZOHO_EVENT_EMISSION_ENABLED=false
ZOHO_DISPATCH_ENABLED=false
ZMA_J8_NFR_RULE_APPROVED=false
ZOHO_TEST_FIXTURE_ENABLED=false
ZOHO_TEST_DATABASE_CONFIRMED=false
```

With event emission false, business mutations retain their existing behavior and no lifecycle outbox event or plan-created readiness audit is written. No flag defaults to enabled.

`ZMA_J8_NFR_RULE_APPROVED` keeps prepared J8 rows held until marketing approves the NFR-only rule. It does not activate or trigger a journey.

## Central event architecture

`lib/zoho-lifecycle-events.ts` is the central transactional writer. Every state-changing caller supplies its existing `Prisma.TransactionClient`, a stable occurrence identity, and the event reason. The writer:

1. requires event emission to be explicitly enabled;
2. requires an automation-`ACTIVE` plan, except for an explicitly requested paused/completed stop-state sync;
3. loads automation-enabled role recipients from persisted plan contacts;
4. builds the complete Phase 2 contact snapshot from database state inside the same transaction;
5. checks communication-context ownership and subscription status;
6. creates a recipient sequence and outbox row through the Phase 1B foundation;
7. creates a journey-send ledger row for journey intent; and
8. relies on unique event and dedupe keys plus transaction advisory locks for replay/concurrency protection.

Snapshot validation, missing contexts, competing contexts, ineligible recipients, unverified journey subscriptions, and missing marketing approval produce durable `HELD` events. They do not silently choose a plan and do not make an external call. A snapshot failure is stored as a sanitized reason; request-body values are never substituted for authoritative persisted state.

Contact-upsert events can remain pending for an owned context while subscription is unknown because the later upsert is the operation used to create/update membership. Journey events require `CONFIRMED` subscription eligibility.

## Lifecycle integrations

| Mutation | Existing entry point | Phase 3 behavior |
|---|---|---|
| New NFR/Customer plan | `createMsp` / `POST /api/admin/msps` | Evaluates readiness in the creation transaction. Current plans remain `PENDING`, owner automation is disabled, and automatic J1 is false, so no event is emitted; missing readiness is audited only when emission is enabled. A future explicitly active/approved creation can record sync then J1 only when `book-kickoff` is `waiting_on_msp` (`Action Required`). |
| Kickoff booking/correction/cancellation | `updateKickoffBooking` | Booking state, audit, and a complete contact snapshot commit together. Cancellation also syncs but never replays J1. The Phase 2 mapping changes only an active `book-kickoff` task to `Upcoming`. |
| MSP task completion | `completePortalTask` | Task timestamps, plan metrics, nudge stop state, contact sync, and milestone intent commit together. No general journey is created for an MSP completion. |
| KZero task completion | `completeCurrentKzeroTaskForMsp` | Creates J5 only for a real stable-key transition from a completed KZero-owned task to an MSP/Shared next task. KZero-to-KZero transitions do not qualify. |
| Admin rollback | `rollbackPortalTaskForMsp` | Preserves normal status behavior, records real status changes, recalculates the next-task timestamp only when the active stable key changes, and queues sync. J1/J8 are not replayed and J5 uses the original handoff dedupe identity. A no-op rollback writes nothing. |
| SaaS submission | `submitPortalSaasApp` | The application row, count/activity update, and sync event commit together. |
| First Customer Pilot submission | `submitFirstCustomerPilot` | Changed persisted pilot fields and sync commit together. An identical resubmission is a no-op. |
| Document upload | `uploadOnboardingDocuments` | Blob upload occurs first. The document database row and sync event then commit together. If that transaction fails, the uploaded Blob is deleted using the existing cleanup path. |
| Contact add/edit/remove | Phase 1B contact services | Contact mutation, audit, and relevant sync commit together. Identical edits are no-ops. No subscription or enrollment is performed. |
| Sales Engineer update | Phase 1B SE service | Changed merge-field data, audit, and sync commit together. Identical edits are no-ops. |
| Plan state/relevant admin edit | `updateMsp` | Relevant stage/progress/status/tenant/SE/count changes queue sync. Paused/completed plans finish an active nudge and move to the matching automation stop state; only previously paused plans resume to `ACTIVE`. PENDING/EXCLUDED plans are never activated. |

The current application has no independent task-owner edit endpoint and no persisted SaaS approval mutation. Those event hooks cannot be attached until such business mutations exist; task progression ownership changes are captured by the completion transition.

## Journey identities

- J1: `plan + normalized recipient + J1`; only an explicitly approved, active, ready plan with kickoff in `Action Required` qualifies.
- J5: `plan + normalized recipient + J5 + completed KZero task -> next stable task`.
- J8: `plan + normalized recipient + J8 + complete-first-customer-rollout`.

J8 is prepared only for an NFR plan when `complete-first-customer-rollout` changes from non-complete to complete. It targets the enabled Onboarding Owner and enabled Executive Sponsor if one truthfully exists. Customer Plan completion, generic plan completion, rollback, and replay do not create a new J8 identity. The journey remains held unless `ZMA_J8_NFR_RULE_APPROVED=true` and the other eligibility gates pass.

Phase 3 does not create J3. The scheduled nudge evaluator is explicitly outside this phase. It does set `Nudge Status = Done` transactionally when the nudged task completes, the plan stops, or the represented active work passes away from the nudged task.

## Timestamp behavior

- `statusChangedAt` changes only when a task status actually changes.
- `completedAt` is set only on the first transition to complete and is retained through rollback/re-completion.
- `nextTaskSince` changes only when the active task's stable template key changes. Plan visits, documents, applications, pilot metadata, and no-op updates do not reset it.
- Existing historical null timestamps remain untouched unless a real post-Phase-3 transition occurs.

Retaining the first `completedAt` makes rollback/re-completion use the same milestone occurrence identity. The journey ledger provides the second dedupe boundary.

## Multi-plan handling

Every event contains plan ID, normalized recipient, stable event key, event type, and relevant task/handoff key. The recipient sequence is allocated atomically rather than inferred from timestamps.

No event writer acquires or releases a communication context. If the email has no assigned context, or another plan owns it, the event is held with `COMMUNICATION_CONTEXT_REQUIRED` or `COMMUNICATION_CONTEXT_CONFLICT`. Events remain visible and durable for the later admin/dispatcher phase; no plan wins implicitly.

## Stale-event contract for Phase 4

Outbox payloads contain immutable occurrence metadata, the full snapshot observed in the business transaction, and `revalidateBeforeDispatch=true`. The Phase 4 dispatcher must re-read state before any provider call and classify rows as follows:

- `CANCELLED`: plan/recipient was deliberately disabled, trigger no longer represents the current task, or an administrator cancels with a reason;
- `HELD`: context, subscription, mapping, journey availability, or manual approval is unresolved;
- `SUCCEEDED`: only after a classified provider result;
- `RETRY`/`DEAD`: retryable/exhausted provider failures;
- stale contact sync: coalesce safely to the newest recipient sequence only after proving no intervening trigger depends on it;
- stale journey trigger: never send when the expected task is already complete, ownership no longer qualifies, the plan/context changed, or the ledger already has a terminal/uncertain remote result.

A queued J5/J8 identity remains immutable even when dispatch is later refused as stale. Rows are never hard-deleted to hide a conflict.

## Isolated test prerequisite operation

Authenticated endpoint:

```text
POST /api/admin/zoho/test-fixture
```

Required body:

```json
{
  "planId": "allowlisted-native-test-plan",
  "contactId": "persisted-owner-contact-id",
  "confirmation": "ACTIVATE ISOLATED ZOHO TEST PLAN"
}
```

The operation is rejected in production and requires all of:

- `ZOHO_TEST_FIXTURE_ENABLED=true`;
- `ZOHO_TEST_DATABASE_CONFIRMED=true`;
- plan ID and internal email on the existing Phase 2 allowlists;
- a `NATIVE` plan (never a legacy plan);
- an automation-enabled Onboarding Owner with a valid complete snapshot;
- no competing active plan for the email; and
- an absent/unassigned/already-owned context, never a blocked/release-pending/foreign context.

It transactionally activates only that selected native test plan, assigns its real context, and writes an audit entry. It does not allow J1, create historical events, call Zoho, or bypass context checks. Disable both test-fixture flags after isolated testing.

## Deep-link verification

`/portal/{planId}?tab=tasks&task={templateKey}` is resolved through `lib/portal-deep-link.ts`. A known stable key activates Tasks, expands its real phase, and focuses/scrolls the mounted task. Unknown or absent keys do nothing and do not crash. Locked tasks may be viewed/focused but no completion action is invoked. NFR and Customer Plans use the same stable-key resolver.

The server loads and authorizes the portal before the client reads query parameters; query parameters do not grant admin access. Browser automation was not available, so scroll/focus behavior was verified by code inspection and pure resolution tests, not an actual browser session.

## Verification completed

- `npx prisma generate` — passed.
- `npx prisma validate` — passed.
- `npm run test:zoho-phase-2` — 14 passed.
- `npm run test:zoho-phase-3` — 7 passed.
- `npm run build` — passed.
- `git diff --check` — required after final documentation review.

The Phase 3 tests cover handoff qualification, NFR-only J8, stable-key nudge/next-task rules, context conflict holds, subscription holds, marketing-approval holds, deep-link resolution/unknown keys, dormant/no-network source checks, and production/legacy test-fixture guards.

No approved isolated Phase 1A database was available. Database integration, concurrent recipient allocation, rollback-on-outbox-failure, actual row dedupe, document Blob/database failure handling, and runtime route tests were not performed. No live Zoho API or browser test was performed.

## Remaining Phase 4 blockers

- Rehearse and apply the Phase 1A migration before deploying any database-dependent Phase 1B–3 code.
- Run the required transaction/concurrency suite against an approved isolated migrated database.
- Complete controlled field/list/topic/double-opt-in testing and manual subscription verification.
- Approve the NFR-only J8 rule and recipients before releasing held J8 events.
- Approve production context assignment/release and conflict administration.
- Implement a dispatcher that revalidates stale state, serializes recipients, sends upsert before trigger, handles uncertain provider outcomes, and never treats persistence as exactly-once delivery.
- Add the separately approved J3 business-day nudge evaluator and cron only in its scheduled-job phase.
- Keep all production automation and external dispatch disabled until journeys, sender/Reply-To, test results, migration, and operational ownership are approved.
