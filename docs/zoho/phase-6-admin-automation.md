# Phase 6 — Zoho Automation Admin Center

Phase 6 adds read-only operational monitoring to the authenticated Sales Engineer dashboard. It does not enable event emission, contact writes, journey triggering, dispatch, nudge evaluation, cron, or production approval.

## Phase 5 eligibility correction

`automationOrigin` records history; it is not the authorization gate. Legacy plans remain `EXCLUDED` after migration, but a legacy plan that is separately reviewed and explicitly moved to `ACTIVE` may qualify for a future reminder. It must still pass every normal readiness, subscription, context, stable-task, ownership, and plan-state check. `nextTaskSince` must be a truthful, explicitly approved timestamp. Missing timestamps block the reminder; the system does not infer them from `createdAt`, `updatedAt`, or activity. No historical task, welcome, or reminder event is replayed.

## Pages and components

- `/admin/zoho` is the Zoho Automation Admin Center. It uses the existing admin session, shared KZero header/logo, theme system, and responsive surface/card styles.
- The Sales Engineer Dashboard header includes a `Zoho Automation` link.
- Existing case preview integration status now adds enrollment, readiness, subscription, context, latest contact sync, latest journey result, nudge state, held/failed counts, and `View Automation History`. Existing contacts, kickoff, and test diagnostics are not duplicated.
- The center uses five compact tabs: Overview, Event History, Reminders, Contacts & Conflicts, and Configuration.

Tables are contained in horizontal overflow regions instead of forcing page-level overflow. Controls wrap on narrow screens. Dialog content is height-bounded and scrollable. Existing theme tokens provide light/dark rendering; no theme styles or defaults changed.

## Admin APIs

All monitoring endpoints validate the existing admin session on the server:

- `GET /api/admin/zoho/automation/overview`
- `GET /api/admin/zoho/automation/events`
- `GET /api/admin/zoho/automation/contacts`
- `GET /api/admin/zoho/automation/plans/{planId}`
- existing `GET /api/admin/zoho/nudges/preview`

Event queries support bounded page sizes, search, plan/recipient/journey/type/status/date filters, sort direction, and pagination. Contact queries use a bounded normalized-email page. Immutable outbox payload snapshots are deliberately not returned. Errors, hold reasons, and evidence text are length-limited and scrub common authorization/token patterns.

`POST /api/admin/zoho/automation/actions` is the common Phase 6 authorization boundary for future context, event, subscription, reconciliation, and enrollment actions. It always returns `403 INDIVIDUAL_ADMIN_IDENTITY_REQUIRED` under the current shared access-code session. Existing manual subscription verification and uncertain-trigger reconciliation endpoints now use the same boundary.

## Monitoring behavior

Overview reports real persisted counts for pending, held, retrying, dead/failed, processing, and uncertain events. It shows current nudge counts, urgent stop-sync failures, last successful contact synchronization, last nudge evaluation, feature posture, and configuration presence for J1, J3-R1, J5, and J8.

Operational wording deliberately distinguishes:

- queued event;
- successful contact synchronization/provider acceptance;
- accepted journey trigger;
- email delivery, which this integration does not prove.

Stop-state monitoring lists unresolved `isStopState` events in pending, processing, held, retry, or dead state. A locally completed task is never labelled “Reminder Stopped.” Only provider-supported synchronization evidence may be described as synchronized, and even that is not email-delivery evidence.

## Event history

The table combines outbox identity/status with the latest matching journey-ledger outcome. `UNKNOWN` attempted journey results are visually distinct from success. Details include only plan/event identifiers, stable task or handoff identity, status, attempt timing, sanitized hold/error/provider outcome, and journey classification. The UI contains no blind retry for uncertain triggers and no bulk-send action.

## Reminder preview

The Reminders tab reuses the Phase 5 `previewZohoNudges` service and endpoint. It does not duplicate eligibility logic. It displays current persisted plan/task facts, Toronto business-day timing, threshold, next eligible instant, recipient, decision, reason, nudge state, and latest journey outcome. The last persisted daily evaluation is separate from the current read-only preview.

## Contacts, conflicts, and subscription evidence

The Contacts & Conflicts tab groups plan contacts by normalized email and shows all referenced plans, active-enrollment competition, the single communication context, state/owner, held count/reason, subscription status/evidence source/date, last successful sync, and uncertain journey results.

The interface displays disabled controls for Assign Context, Request Release, Confirm ZMA Clear and Release, Requeue Held Events, Cancel Event, Verify Subscription, and Enroll Historical Plan. This exposes the intended operational workflow without implying it is authorized.

A future release implementation must enforce: request release; prepare and confirm stop-state sync; move to `RELEASE_PENDING`; independently verify no ZMA wait/journey conflict; record evidence/reason under an authenticated person; release; then revalidate held events before requeue. Elapsed journey time alone is never evidence. Subscription verification must retain source, evidence, time, and individually authenticated actor and must not override unsubscribed, bounced, or suppressed provider evidence.

Historical enrollment must run readiness against the exact plan, preserve `LEGACY`, require contacts/SE/task mappings/context/subscription, record approval, establish a truthful future timing boundary, and prepare no historical events. J1 must remain a separate unchecked decision and may only be approved when current J1 requirements pass.

## Administrator identity blocker

The current cookie proves possession of a shared access code. `ADMIN_AUDIT_ACTOR` is a server label, not proof of a person, and a typed actor name would not be authentication. Therefore high-impact writes remain blocked.

Minimum enhancement for Phase 7:

1. authenticate the admin area with the existing OIDC provider;
2. retain a server-validated immutable subject and display identity (email/name);
3. authorize an explicit internal admin/automation role from trusted token claims;
4. bind sensitive POST requests to that session and apply the established origin/CSRF protection;
5. store the immutable subject plus display identity in automation audit evidence;
6. test embedded Zoho Web Tab cookie/session behavior without falling back to entered actor names.

## Configuration and feature safety

Configuration shows only presence/boolean state: OAuth, fields, private list, topic, journeys, portal URL, test/production mode, emission, sync, triggers, dispatch, nudge evaluator, kill switch, `CRON_SECRET`, and production approval. It exposes no values and no activation toggle.

Required dormant posture remains:

```text
ZMA_NUDGE_EVALUATION_ENABLED=false
ZOHO_EVENT_EMISSION_ENABLED=false
ZOHO_GLOBAL_KILL_SWITCH=true
ZOHO_JOURNEY_TRIGGERING_ENABLED=false
ZOHO_AUTOMATIC_DISPATCH_ENABLED=false
ZOHO_PRODUCTION_DISPATCH_APPROVED=false
ZOHO_DISPATCH_MODE=disabled
```

## Schema and migrations

No Phase 6 schema change or migration is required. The center reuses `PlanContact`, `ZohoCommunicationContext`, `ZohoOutboxEvent`, `ZohoJourneySend`, `ZohoAutomationAudit`, `ZohoNudgeEvaluationRun`, and existing plan/task fields. No production migration was applied.

## Testing and limitations

The Phase 6 suite covers the legacy eligibility regression, required page structure, authenticated monitoring routes, shared-session sensitive-write denial, bounded/sanitized services, event filters and uncertainty, stop-state/conflict language, case-history linking, and dormant flags.

Static/unit validation cannot prove database query performance, concurrency, migrated data behavior, browser layout, embedded third-party-cookie behavior, or provider evidence. These require an approved isolated migrated PostgreSQL database and actual browser/device testing. No Zoho API call was made.

## Phase 7 prerequisites

- Implement attributable OIDC admin identity and role authorization.
- Define and approve CSRF/origin policy for embedded sensitive writes.
- Rehearse all migrations against an isolated production-like database and review query/index performance.
- Implement context assignment/release, event actions, subscription verification, and historical enrollment behind the new identity boundary with transactional audits.
- Complete Zoho list/topic/private-list/field/journey test verification and resolve uncertain outcomes.
- Test the Admin Center at 1920, 1440, 1366, 1024, 768, and 390 pixels plus the Zoho CRM Web Tab.
- Keep production launch controls disabled until the company Vercel transfer, secrets, cron, journey approval, and operational runbooks are complete.
