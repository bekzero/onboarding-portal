# Phase 5: stalled-task and J3-R1 nudge engine

## Safety status

Phase 5 prepares durable J3-R1 intent but does not contact Zoho. Production dispatch, journey triggering, automatic scheduling, and the new evaluator are disabled by default. No production migration, deployment, email, journey trigger, or Zoho API request was performed.

## Eligibility rules

The evaluator prepares J3-R1 only when all of the following remain true at transaction time:

- the plan is explicitly automation `ACTIVE` and not paused or complete; origin alone is not an eligibility gate, so a reviewed legacy plan may qualify while legacy plans remain `EXCLUDED` by default;
- the current phase is post-Kickoff and has an approved threshold;
- the real first non-complete task has a stable key, an MSP/Shared owner, and status `waiting_on_msp` or `in_progress`;
- `nextTaskSince` exists and the phase threshold has elapsed;
- no plan nudge is `WAITING` and no J3 ledger identity exists for this plan/task/recipient;
- the automation-enabled Onboarding Owner exists and has `CONFIRMED` subscription eligibility;
- the communication context is `ACTIVE` and owned by this plan;
- no other automation-active plan references the same enabled recipient;
- stable task mapping is verified; and
- both `ZMA_NUDGE_EVALUATION_ENABLED` and `ZOHO_EVENT_EMISSION_ENABLED` permit the write evaluator.

Kickoff returns `KICKOFF_HANDLED_BY_J1`. KZero ownership returns `WAITING_ON_KZERO`. Missing timestamps or mappings, subscription uncertainty, context conflicts, and uncertain provider history are blocked rather than guessed. Legacy/excluded plans remain excluded.

Every daily-run decision is stored with a machine-readable reason. Preview evaluates the same rules without storing anything.

## Thresholds and business-day boundary

| Phase | Threshold |
|---|---:|
| Kickoff | No J3; J1 owns this phase |
| Tenant Setup | 4 business days |
| App Review | 4 business days |
| SSO Rollout | 4 business days |
| First Customer Pilot | 7 business days |

`nextTaskSince` is the only clock origin. Plan creation, login, refresh, uploads, generic activity, and `updatedAt` are not used.

The boundary is conservative and inclusive: a task becomes eligible at the instant obtained by advancing the configured number of Monday-Friday local calendar days while preserving the Toronto wall-clock time. It is not eligible one second earlier. If that instant falls after today's 9 AM evaluation, the next business-day run can pick it up.

The pure calculator uses `Intl.DateTimeFormat` with `America/Toronto`, calendar-date advancement, and timezone offset re-evaluation for each boundary. It therefore does not multiply by fixed UTC days and handles weekends, month/year/leap-year boundaries, and daylight-saving changes. Holidays are intentionally not excluded because marketing has not approved a holiday calendar; the calculator accepts a timezone so future policy can be added without changing persisted timestamps.

## Transactional nudge preparation

For an eligible plan, one Prisma transaction:

1. takes a plan/task-specific PostgreSQL advisory lock;
2. reloads plan, task, owner, context, competing plans, and J3 history;
3. re-runs all rules;
4. writes `nudgeTaskKey`, `nudgeStartedAt`, and `nudgeStatus=WAITING`;
5. queues the full contact snapshot;
6. queues J3-R1 through the existing stable journey-dedupe helper;
7. allocates the existing recipient sequences;
8. stores the durable evaluation decision; and
9. records an automation audit.

Any failure rolls back the nudge state, outbox events, ledger intent, sequences, decision, and audit together. `WAITING` means the portal prepared a sequence and supplies the Zoho wait-control field; it is not proof that Zoho accepted or sent anything. Provider truth remains in `ZohoJourneySend` and the outbox.

The occurrence identity is stable for plan + stable task key + normalized recipient. A prior ledger row blocks reopening, refresh, job replay, retry, or task edits from generating another sequence.

## Existing and uncertain sequences

Any plan-level `WAITING` nudge blocks a new nudge. A J3 ledger identity blocks the same task permanently under the current approved rule. A sequence older than ten days always requires review: missing/`UNKNOWN` evidence is `UNCERTAIN_SEQUENCE`, failed/ignored evidence is `FAILED_SEQUENCE_REVIEW_REQUIRED`, and an accepted trigger with no confirmed completion is `STALE_SEQUENCE_REVIEW_REQUIRED`. Time alone never releases or restarts it.

## Stop-state behavior

Existing task, plan, and rollback transactions retain the original `nudgeTaskKey`, set `nudgeStatus=DONE`, and queue a stop-state contact synchronization when:

- the nudged task completes;
- another task becomes current;
- rollback moves current work away from the nudged task;
- the plan pauses or completes; or
- the normal transition otherwise invalidates the nudge.

Stop events use the Phase 4 urgent flag and recipient sequence. An older pending J3 trigger is revalidated and cancelled before the newer stop event advances. Normal new-journey eligibility is not required for the stop snapshot. Suppressed recipients and unsafe provider outcomes remain held/failed and are exposed as critical; the portal does not claim that Zoho stopped the journey.

## Durable daily run and concurrency

The additive migration creates:

- `ZohoNudgeEvaluationRun`, unique by Toronto `YYYY-MM-DD`, with a ten-minute lease and version fence;
- `ZohoNudgeEvaluationDecision`, unique by run + plan, with reason, task, recipient identifier, elapsed days, threshold, and next eligible instant.

Only one worker can claim a local business date. Failed or expired runs can be reclaimed with compare-and-set fencing. Plans are read in bounded pages (default 50, maximum 100), and the run lease is renewed after each page. A second invocation for a succeeded or actively leased day is harmless. Plan advisory locks and the journey ledger provide the second concurrency boundary.

No migration backfills plans, task timestamps, contacts, decisions, events, or runs.

## APIs

### Read-only preview

`GET /api/admin/zoho/nudges/preview?take=50&cursor=<planId>`

Requires the existing admin session. It returns the MSP/customer, plan, phase, current task, owner/status, normalized recipient, `nextTaskSince`, elapsed days, threshold, next eligible time, decision/reason, current nudge state, last attempted journey outcome, and reusable summary counts. It performs no writes and imports no Zoho provider client.

### Dormant evaluator endpoint

`GET /api/cron/zoho-nudges`

Requires `Authorization: Bearer <CRON_SECRET>` with a configured secret of at least 16 characters. The handler additionally requires the nudge and event-emission flags, a Toronto business day, and Toronto local hour 09. It returns aggregate counts only. No recipient data or secrets are returned.

No `vercel.json` schedule was added.

## DST-safe future schedule

Vercel Cron is UTC, while Toronto changes offsets. The proposed future configuration is two candidate invocations on weekdays:

```text
0 13,14 * * 1-5
```

At 13:00 UTC, Toronto is 09:00 during daylight time; at 14:00 UTC, it is 09:00 during standard time. The handler rejects the non-09:00 candidate. The unique local-date ledger makes the two invocations harmless and also protects manual/replayed requests. This schedule must not be added until the company Vercel environment, migrations, `CRON_SECRET`, test journeys, and production approval are complete.

## Feature flags

```text
ZMA_NUDGE_EVALUATION_ENABLED=false
ZMA_NUDGE_EVALUATION_BATCH_SIZE=50
ZOHO_EVENT_EMISSION_ENABLED=false
ZOHO_GLOBAL_KILL_SWITCH=true
ZOHO_CONTACT_SYNC_ENABLED=false
ZOHO_JOURNEY_TRIGGERING_ENABLED=false
ZOHO_AUTOMATIC_DISPATCH_ENABLED=false
ZOHO_PRODUCTION_DISPATCH_APPROVED=false
ZOHO_DISPATCH_MODE=disabled
```

The preview is available to authorized admins regardless of sending flags. Evaluation writes require the first two applicable emission gates. Dispatch and journey triggering remain independent and disabled. The global kill switch continues to block every external Zoho call.

## Admin summary support

The server summary reports:

- eligible/prepared decisions from the latest run;
- blocked decisions;
- prepared `WAITING` nudges;
- provider-confirmed active J3 nudges only (`TRIGGERED`/`ALREADY_TRIGGERED`);
- uncertain J3 provider results;
- critical held/dead stop synchronization;
- last run timestamp and outcome.

It does not turn a portal `WAITING` value into a provider-success claim.

## Validation and limitations

Automated Phase 5 coverage includes all requested phase thresholds, owners, paused/complete/legacy states, missing timestamps, prior/unknown sequences, context/subscription conflicts, exact threshold boundaries, Friday-to-Monday, DST, month/year/leap-year changes, scheduler windows, run uniqueness/fencing, transactional source invariants, stop-state preservation, authorization, dry-run isolation, empty results, and disabled defaults.

No approved isolated migrated PostgreSQL database was available. Transaction rollback, concurrent run claims, duplicate prevention under real contention, recipient sequencing, durable decisions/nudge state, context conflicts, stop-event persistence, and dispatcher interaction have not been runtime-tested against PostgreSQL. No live Zoho API, email, browser, production database, or cron test was performed.

## Phase 6 prerequisites

1. Back up production and rehearse Phase 1A, Phase 4, and Phase 5 additive migrations on an approved production-like copy.
2. Run concurrent evaluator/dispatcher integration tests, including lease expiry and transaction-failure injection.
3. Validate an allowlisted test plan through preview, preparation, dispatch, task completion, and urgent stop synchronization. If testing approved legacy enrollment, set `nextTaskSince` only from a truthful, explicitly approved start point and do not replay historical events.
4. Resolve all Phase 4 field/list/topic/test-journey and provider-uncertainty blockers.
5. Add the Phase 6 admin operational interface for decisions, conflicts, uncertain sequences, critical stop failures, run history, and authorized remediation.
6. Complete the company Vercel transfer and approve the dual-UTC cron configuration.
7. Obtain explicit production journey and sending approval before changing any dormant flag.
