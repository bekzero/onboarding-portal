# Zoho Marketing Automation implementation decisions

Status: implementation-readiness assessment only
Assessment date: November 4, 2026
Sources of intent: `Zoho_MA_Setup_Handoff.md` and `Portal_Zoho_Integration_Spec.md` (October 30, 2026)

This document resolves the known portal-side gaps for these four intended Zoho Marketing Automation (ZMA) journeys:

- J1 — Welcome and Kickoff Booking
- J3-R1 — Next Action Nudge
- J5 — Your Next Step Is Ready
- J8 — Completion and Expansion

No Zoho write API was called during this assessment. No email was sent, no production record was queried or changed, and no Vercel transfer was performed. ZMA account/list/topic/journey configuration described by the handoffs was not independently inspected in the live ZMA UI; items requiring that inspection are explicitly marked as manual verification.

## Executive decisions

1. V1 supports **one active communication context per normalized recipient email**. The context is owned by one plan until an authorized administrator releases it. Competing plan events are held durably and shown as conflicts; the dispatcher never picks among multiple eligible plans.
2. Every current plan is backfilled as a **legacy, automation-excluded** plan. Existing timestamps remain null. Migration creates no historical `plan.created` events and sends no historical J1.
3. A successful `listsubscribe` response is **not proof of deliverability**. The dispatcher must hold journey triggers until subscription eligibility is confirmed. The initial confirmation requires a controlled ZMA test and, where the supported read API cannot prove topic/marketing eligibility, manual ZMA verification.
4. V1 kickoff booking is an authorized Sales Engineer action stored separately from task completion. It immediately queues an upsert with `Next Task Status = Upcoming` and does not complete the kickoff task.
5. J8 is defined narrowly as completion of stable task key `complete-first-customer-rollout` on an **MSP NFR plan**. Customer-plan completion is not a J8 trigger without separate marketing approval.
6. Sender and Reply-To addresses remain ZMA journey configuration. The portal supplies assigned-SE merge data but never changes a journey sender.
7. A five-minute Vercel cron requires a Pro or Enterprise destination team. Project transfer, Prisma Postgres resource transfer, and private Blob store transfer are separate controlled operations. The KZero destination team's actual plan and access must be verified manually before transfer.

## 1. Confirmed existing functionality

### Persistence and enrollment

- The portal is already Prisma/PostgreSQL-backed in production code. Models exist for `Msp`, `OnboardingPlan`, `OnboardingTask`, `SaaSAppSubmission`, `Document`, `OidcConfig`, and `AdminNotification`.
- `POST /api/admin/msps` calls `createMsp`, which creates one `Msp`, one associated plan, and its template-derived tasks in a nested Prisma create.
- The Prisma relation permits multiple plans per `Msp`, but the current creation path creates one. Several dashboard/admin helpers select the first plan by creation time. In practice, an NFR plan and a Customer plan may therefore be separate `Msp` rows sharing the same `primaryContactEmail`.
- `primaryContactEmail` is stored on `Msp`; there is no plan-contact model, contact role, first/last name, or per-plan recipient eligibility.
- Production routes persist task completion, SaaS app submissions, first-customer-pilot details, documents, OIDC settings, and admin notifications.

### Task workflow

- Partner task completion is handled by `POST /api/portal/plans/[planId]/tasks/[taskId]/complete`.
- KZero task completion is handled by `POST /api/admin/msps/[mspId]/complete-kzero-step`.
- `advanceOnboardingPlanTask` updates every task status plus plan progress/current stage/status in one Prisma transaction. The partner completion notification is created afterward and is not part of that transaction.
- Tasks have `createdAt` and `updatedAt`, but no `templateKey`, `statusChangedAt`, or `completedAt`. Plans have no `nextTaskSince`.
- The API receives a template-derived task ID, but persisted `OnboardingTask.id` is a generated CUID. Existing task-to-template reconciliation relies on title first and order second.
- There is no durable outbox, journey-send ledger, communication context, Zoho sync state, dispatcher, daily nudge job, or `vercel.json` cron definition.

### Kickoff and Sales Engineer data

- The kickoff task is `task-1` in the generated template and is titled “Book Setup Call with Your KZero Sales Engineer.”
- The UI provides a Microsoft Bookings link and a separate task-completion action. There is no persisted “booked” event or timestamp.
- `Msp.assignedSalesEngineer` stores a name only and defaults to `Ben Eakin`. The database has no assigned-SE email or booking URL. Mock data is not reliable enough for merge fields and contains an email inconsistent with the handoff.

### J8 task

- The source template defines `stableId: "task-13"`, title “Complete First Customer Rollout,” and owner `shared`.
- Runtime template IDs are currently `${tenantSlug}-task-13`; there is no stable key in the database.
- The same `baseTasks` template is used for both NFR and Customer plans, so the task currently exists in **both** plan types.
- Consequently, task title, order, or a generic “Customer plan completed” condition is not a safe long-term J8 event definition.

### Hosting and storage

- Runtime database access uses `DATABASE_URL`; `DIRECT_URL` is documented for Prisma CLI/migrations.
- Documents use a server-side `BLOB_READ_WRITE_TOKEN` and Vercel Blob. Document rows retain both `storageUrl` and `storageKey`.
- No checked-in Vercel project metadata identifies the current or destination team. The actual KZero team plan therefore cannot be verified from this repository.

## 2. Issue decisions

### Issue 1 — Multiple plans, one email address

#### V1 policy

Treat normalized Lead Email as a globally serialized ZMA resource. One plan owns that recipient's active communication context. Only that plan may update plan-specific ZMA contact fields or trigger a journey.

The context should normally remain with the same plan for the plan's communication lifecycle. Do not automatically switch it merely because another plan has an older event or a higher-priority event.

#### Required constraints

- Normalize recipient emails as `trim().toLowerCase()` before every lookup or insert.
- Store one `ZohoCommunicationContext` row per normalized email, using `recipientEmailNormalized` as the primary key. This is the database-enforced one-context rule.
- `activePlanId` is nullable and references `OnboardingPlan` with `onDelete: Restrict`. A context with an active plan cannot be acquired by another plan or silently orphaned by plan deletion.
- Add a database check ensuring stored normalized emails equal `lower(btrim(email))`.
- Add `OnboardingTask.templateKey` and `@@unique([onboardingPlanId, templateKey])` so event identities do not depend on title/order/CUID.
- Give every outbox event an immutable, globally unique `eventKey`.
- Give every journey attempt an immutable, globally unique `dedupeKey`, for example:
  - J1: `J1:{planId}:{recipient}`
  - J3-R1: `J3:{planId}:{templateTaskKey}:{recipient}`
  - J5: `J5:{planId}:{completedTaskKey}:{nextTaskKey}:{recipient}`
  - J8: `J8:{planId}:{recipient}`
- Do not use a nullable composite uniqueness trick to enforce context ownership. A single row keyed by normalized email is simpler and unambiguous.
- Add an immutable monotonically increasing plan/event sequence to outbox rows and index `[recipientEmailNormalized, sequence]`; the dispatcher must not overtake an earlier nonterminal event for the same email/context.
- Require at least one automation-enabled `ONBOARDING_OWNER` before a plan can enter `ACTIVE`. This is a transactional service invariant because an ordinary row check cannot enforce “at least one related row.”

#### Dispatcher rules

1. Claim outbox rows with a database transaction and `FOR UPDATE SKIP LOCKED` or an equivalent atomic Prisma pattern.
2. Serialize all work per normalized email by locking its `ZohoCommunicationContext` row.
3. Before acquiring an unowned context, query all ready events for that email:
   - If exactly one plan is eligible, acquire the context for that plan.
   - If more than one plan is eligible, hold every competing event with `MULTIPLE_ELIGIBLE_PLANS`; do not choose by event age, plan type, or journey.
4. If the context belongs to the event's plan, process that plan's events in sequence order.
5. If the context belongs to another plan, set the event to `HELD` with `CONTEXT_OWNED_BY_OTHER_PLAN`. Do not call `listsubscribe` and do not trigger a journey.
6. Within an owning plan, send the full contact-field upsert before its trigger. A trigger cannot pass a failed, pending, held, or retrying upsert.
7. Subscription eligibility is a separate gate. `UNKNOWN`, `PENDING_CONFIRMATION`, `INELIGIBLE`, or `MANUAL_REVIEW` holds triggers.
8. Persist `already_triggered`, `ignored_leads`, HTTP errors, rate locks, and ambiguous responses. None is silently treated as delivered.
9. Held events remain in the database indefinitely until an authorized action resolves or cancels them. Retention cleanup must exclude `HELD` and unresolved `DEAD` rows.
10. Never release or reassign a context merely because the portal's expected wait duration elapsed. If ZMA cannot confirm that active waits/journeys have ended, require manual ZMA verification and an audited admin release.

#### Context release rule

Use a two-step release:

1. **Request release:** portal queues a final state upsert for the owning plan (`Nudge Status = Done`, and other applicable stop fields), then marks the context `RELEASE_PENDING`.
2. **Confirm and release:** an authorized admin checks ZMA for active journey/wait membership, records the verification time and reason, and releases the context. Only then can another plan be assigned and its held events requeued.

If ZMA later exposes a documented journey-run completion API or webhook, it can replace the manual confirmation. Until then, elapsed time is not evidence.

#### Admin controls

Add a “Marketing Automation” admin area with:

- conflict count and held-event queue;
- recipient email, owning plan, competing plans, tenant types, next actions, oldest-held age, and hold reason;
- subscription eligibility and how/when it was verified;
- last successful upsert, last trigger result, outstanding retry, and unresolved journey runs;
- “Assign context” when no owner exists and exactly one plan is selected explicitly;
- “Request release” and separate “Confirm ZMA clear and release” actions;
- mandatory reason, actor, timestamp, and optional Zoho evidence/reference for manual release;
- “Requeue held events” after assignment;
- “Cancel event” with a required reason (never hard-delete);
- no one-click force switch that overwrites an active plan's fields.

Context assignment/release should require `admin`; an assigned `sales_engineer` may view conflicts but should not reassign context unless KZero explicitly grants that permission.

#### Future parallel per-plan communications

Portal schema changes alone cannot make parallel sends safe while ZMA identifies one contact by Lead Email and journeys read mutable contact-level plan fields. Marketing would need one of these externally validated designs:

- a ZMA-supported contact identity that includes plan ID, while still delivering to the same address;
- journey event payloads or another immutable per-enrollment data object so emails and waits do not read shared mutable contact fields;
- separate, consented, deliverable email aliases per plan; or
- a different transactional/orchestration service designed for per-event payloads.

Only after the marketing platform isolates per-plan data should the portal change context uniqueness from email to `[email, planId]` and allow concurrent journey runs. Duplicating the same Lead Email or rapidly swapping fields is not an acceptable parallel design.

### Issue 2 — Existing production records

#### Migration/backfill policy

1. Take and verify a production database backup; rehearse the migration against a restored snapshot.
2. Add tables/columns without rewriting existing business state.
3. Backfill every existing plan with:
   - `automationOrigin = LEGACY`
   - `automationEnrollmentState = EXCLUDED`
   - `automaticJ1Allowed = false`
4. Leave these new historical fields null:
   - task `statusChangedAt`
   - task `completedAt`
   - plan `nextTaskSince`
   - plan `automationEnrolledAt`
   - plan `kickoffBookedAt`
5. Do not infer timestamps from `createdAt`, `updatedAt`, plan progress, task order, or `lastActivityAt`.
6. Backfill `templateKey` only when title/order maps unambiguously to the versioned portal template. Produce a migration report for missing, duplicate, and ambiguous mappings; leave ambiguous rows null and block automation for those plans.
7. Do not generate `plan.created` outbox events during migration. Do not create J1 `journey_sends` rows as a substitute; absence of a send is intentional.
8. New plans created after the automation feature is enabled use `automationOrigin = NATIVE` and the configured new-plan policy. Keep dispatch globally disabled until launch approval.

#### Manual historical enrollment

Add an authorized admin action that:

- validates contacts, assigned-SE merge fields, stable task keys, current next action, and communication-context conflicts;
- records who approved enrollment and when;
- changes the plan from `EXCLUDED` to `ACTIVE` in the same transaction as any initial outbox events;
- presents a separate unchecked “Send J1 welcome” decision with impact text;
- creates J1 only when that explicit approval is true;
- otherwise enrolls current-state synchronization and future eligible events without retroactive J1 or retroactive nudges;
- does not backdate `nextTaskSince`; an admin must set a truthful “automation timing starts at” value or allow timing to begin at enrollment.

### Issue 3 — Subscription eligibility

#### Confirmed API behavior

Zoho's official `listsubscribe` documentation says the API can add a lead and pass `topic_id`, but its documented success response says a confirmation email was sent and the user must confirm before successful subscription. It also says existing lead details are updateable through this API only in a private list. Therefore a success code confirms request acceptance—not active subscription or deliverability. [Zoho Subscribe API](https://www.zoho.com/marketingautomation/help/developers/v1/lead-subscribe.html)

Zoho's Get List Leads API can query list members by `active`, `unsub`, or `bounce` and requires lead read scope. It can support an active-list check, but its documented response does not establish topic membership, Marketing/Non-marketing state, or inbox deliverability. [Zoho Get List Leads API](https://www.zoho.com/marketingautomation/help/developers/v1/get-list-leads.html)

Zoho states that campaigns require the selected topic and can send only to Marketing leads associated with that topic. It also describes double opt-in as optional in the newer topic model, but the handoff specifically says double opt-in is enabled for this account. The actual account/list path must be tested; neither statement permits a code bypass. [Zoho Topic Management](https://www.zoho.com/marketingautomation/topics-update.html)

#### V1 eligibility state machine

- `UNKNOWN`: no subscription attempt/verification.
- `PENDING_CONFIRMATION`: `listsubscribe` accepted or explicitly reported confirmation mail; no journey trigger.
- `CONFIRMED`: authorized verification shows active list membership, Marketing eligibility, and Partner Onboarding topic association.
- `INELIGIBLE`: unsubscribed, bounced, do-not-mail, non-marketing, topic declined, or invalid/group email.
- `MANUAL_REVIEW`: API and UI evidence conflict or the API cannot prove required attributes.

The portal may use Get List Leads to find active/unsub/bounce membership. For initial V1, topic association and Marketing eligibility require manual verification in the ZMA contact record unless a supported API response is demonstrated in the test account. Record verification source, actor, and timestamp.

Do not trigger a journey for `PENDING_CONFIRMATION`. Do not interpret Trigger Leads `triggered_leads` as proof the message was delivered. `already_triggered` and `ignored_leads` are operational results, not subscription evidence.

#### Required manual Zoho test

Nicholas or a ZMA administrator must use a controlled test address to establish:

1. whether this configured list/account sends a double-opt-in confirmation for `listsubscribe`;
2. whether confirmation is required before the lead appears as active;
3. whether `topic_id` actually associates Partner Onboarding;
4. whether the contact is marked Marketing and eligible for the four journey emails;
5. whether an unsubscribed or topic-declined contact remains correctly suppressed;
6. whether the KZero Partner Onboarding list is private and existing custom fields update;
7. whether custom fields accept display names or require API/merge-tag names.

### Issue 4 — Kickoff booking

#### V1 event definition

`kickoff.booked` occurs only when an authorized Sales Engineer or admin selects “Mark kickoff booked” for the plan. The action records `kickoffBookedAt`, `kickoffBookedBy`, and an audit event. An optional scheduled meeting time may be stored, but it is not required to stop J1.

In the same database transaction:

- persist the booking state;
- append an outbox `UPSERT_CONTACT` event with the latest plan snapshot;
- map the kickoff's ZMA `Next Task Status` to `Upcoming` exactly as the handoff specifies.

The dispatcher attempts that upsert immediately (and the five-minute cron remains the retry safety net). No journey trigger is required. Booking does **not** mark the kickoff task complete, advance progress, or mean the meeting occurred.

“Immediately” means: commit booking state and the outbox event first, then make a best-effort post-commit dispatch of that event before the admin request finishes (or via the platform's post-response work primitive). A Zoho failure cannot roll back booking state; it leaves the event retryable for the five-minute dispatcher.

Add a separately authorized correction/cancellation action. If booking is cancelled before the meeting, record a new audit event and decide with marketing whether J1 can safely resume; do not silently set `Action Required` and assume a prior J1 wait can be re-entered.

Do not build a Microsoft Bookings webhook in V1.

### Issue 5 — J8 completion event

#### Decision

Introduce stable task key `complete-first-customer-rollout` and use this exact event:

> Trigger J8 once when an `NFR` plan's task with `templateKey = complete-first-customer-rollout` transitions from any non-complete status to `complete`, the plan is automation-active, and the recipient owns or can acquire the communication context.

The outbox event and task transition must be in the same transaction. The J8 dedupe key is per plan and recipient. Replays, rollback/re-completion, and duplicate requests cannot produce another J8.

This corresponds to current generated template suffix `task-13`, but code must stop using that suffix or title as the event contract. Although the current template includes the task in both NFR and Customer plans, **Customer plan completion is excluded** from J8 pending marketing approval.

#### Alternative requiring approval

Marketing may approve a separate “Customer plan completed” milestone. If so, define a distinct event and either a separate journey/template or explicitly approved copy/recipient rules. Do not overload J8 silently, because completing each customer tenant is different from the NFR plan's “first customer live” expansion milestone.

### Issue 6 — Sender and reply ownership

- The current handoff says branded journey emails send as Nicholas `<n.tsoukas@kzero.com>`. That From configuration belongs to each ZMA email/journey node.
- J1/J3 internal alerts currently target Ben, and Ben sends the drafted follow-up from Outlook. ZMA internal-alert recipients are fixed org users according to the handoff; portal SE fields can populate alert content but do not dynamically change that fixed recipient.
- Portal fields `SE Name`, `SE Email`, and `SE Booking URL` populate merge tags and alert content. They do not authorize the portal to modify From or Reply-To.
- The portal must not carry a default sender address, rewrite sender settings, or infer Reply-To from assigned SE data.

For the desired future `onboarding@kzero.com` approach, marketing/IT must first:

1. create and secure the mailbox or shared mailbox in Microsoft 365;
2. decide who owns and monitors replies and define response SLAs;
3. verify the address as a ZMA sender and complete domain/custom-return-path requirements;
4. explicitly set From and Reply-To on each journey email and test replies end to end;
5. decide whether J1/J3 internal alerts go to Ben, a backup, or the shared mailbox.

Changing to `onboarding@kzero.com` is a ZMA/Outlook configuration change, not a portal deployment. The portal should expose assigned-SE data accurately and display configuration health, but it should never silently change sender ownership.

### Issue 7 — Company Vercel transfer

#### Cron plan

Vercel currently documents a once-per-day minimum on Hobby and a once-per-minute minimum on Pro and Enterprise. Therefore a five-minute dispatcher is supported only if the destination KZero team is Pro or Enterprise. The actual destination plan is not represented in this repository and remains a manual launch blocker. [Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)

Vercel does not retry failed cron invocations. The durable outbox is therefore mandatory; a later invocation must resume retryable rows. [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

#### Transfer runbook decisions

- **Project:** Vercel says deployments, project settings, project-level environment variables, domains/aliases, Git repository link, and cron jobs transfer. Integrations, monitoring/log history, and Blob do not transfer with the project. [Vercel project transfer](https://vercel.com/docs/projects/transferring-projects)
- **Prisma Postgres:** Treat it as a Marketplace integration/resource, not as part of project transfer. The destination team must install the Prisma integration, then transfer the Prisma resource from its resource settings and reconnect it to the transferred project. Vercel lists Prisma databases among supported cross-team Marketplace resource transfers. [Vercel Marketplace resource transfer](https://vercel.com/changelog/transfer-marketplace-resources-between-teams)
- **Database validation:** Before and after transfer, record database/resource identifiers without exposing credentials; verify row counts/read-only health checks; verify production and migration connection variables point to the same intended database; run no migration as part of the transfer itself.
- **Private Blob:** Transfer the Blob store separately from Storage → Store → Settings → Transfer Store, reconnect it to the project, and replace/rotate `BLOB_READ_WRITE_TOKEN`. Verify the store remains private and test authenticated reads for existing `storageKey` records. [Vercel storage transfer](https://vercel.com/docs/storage)
- **Environment variables:** Inventory names and environment scopes before transfer, then compare after transfer. Project-level variables should copy, but integration-owned database/Blob credentials may be regenerated when resources reconnect. Required inventory includes Auth/OIDC, database, Blob, admin/session secrets, base URL, Zoho OAuth/list/topic/journey keys, dispatcher feature flags, and `CRON_SECRET`. Never copy values into source control.
- **Domain/URL:** Transfer the custom production domain with the project and keep it stable. Verify `AUTH_URL`, Keycloak redirect URIs, portal deep links stored in ZMA, and any Zoho OAuth redirect URI after transfer. A renamed `*.vercel.app` project URL must not become the canonical URL.
- **GitHub:** The repository link transfers, but verify that the Vercel GitHub App still has repository access and that deployment authors are members permitted by the destination team. Run a no-op preview and controlled production deployment after transfer. [Vercel Git deployments](https://vercel.com/docs/git) and [Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github)
- **`CRON_SECRET`:** Generate a new random value of at least 16 characters in the destination team's Production environment. The cron route must reject requests unless `Authorization` exactly equals `Bearer ${CRON_SECRET}`. Vercel automatically supplies that header for configured cron calls. Rotate it after transfer and test 401/200 behavior. [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)

Do not transfer until the database and Blob resource owners, destination team plan, target-domain owner, GitHub permissions, rollback owner, and maintenance window are confirmed.

## 3. Required Prisma and API changes

The following is the minimum V1 shape; names may be adjusted during implementation, but constraints and semantics should remain.

### Existing model additions

`OnboardingPlan`:

- `automationOrigin`: `LEGACY | NATIVE`
- `automationEnrollmentState`: `EXCLUDED | PENDING | ACTIVE | PAUSED | COMPLETE`
- `automaticJ1Allowed Boolean`
- `automationEnrolledAt DateTime?`
- `automationEnrolledBy String?`
- `nextTaskSince DateTime?`
- `kickoffBookedAt DateTime?`
- `kickoffBookedBy String?`
- `assignedSeName String?`
- `assignedSeEmail String?`
- `assignedSeBookingUrl String?`
- `nudgeTaskKey String?`
- `nudgeStartedAt DateTime?`
- `nudgeStatus`: `NONE | WAITING | DONE`

`OnboardingTask`:

- `templateKey String?`
- `statusChangedAt DateTime?`
- `completedAt DateTime?`
- unique `[onboardingPlanId, templateKey]` (PostgreSQL permits multiple nulls during backfill)

### New models

`PlanContact`:

- plan relation;
- original and normalized email;
- first/last name;
- role: `ONBOARDING_OWNER | EXECUTIVE_SPONSOR | TECHNICAL_ADMIN`;
- automation enabled flag;
- subscription eligibility, verification source/actor/time;
- unique `[onboardingPlanId, recipientEmailNormalized, role]`.

`ZohoCommunicationContext`:

- `recipientEmailNormalized` primary key;
- nullable `activePlanId`;
- state: `UNASSIGNED | ACTIVE | RELEASE_PENDING | BLOCKED`;
- acquired/release/verification timestamps and actors;
- optimistic `version` or row-lock discipline.

`ZohoOutboxEvent`:

- unique `eventKey`;
- plan, recipient, kind (`UPSERT_CONTACT | TRIGGER_JOURNEY`), journey, task key;
- immutable JSON payload snapshot;
- immutable per-recipient sequence number;
- status (`PENDING | HELD | PROCESSING | SUCCEEDED | RETRY | DEAD | CANCELLED`);
- hold reason, attempt count, next attempt, last error, timestamps;
- indexes on `[status, nextAttemptAt, createdAt]` and `[recipientEmailNormalized, status]`.
- unique `eventKey` and unique `[recipientEmailNormalized, sequence]`;
- plan/contact foreign keys use `onDelete: Restrict` while audit/outbox data exists.

`ZohoJourneySend`:

- unique `dedupeKey`;
- plan, recipient, journey, task/handoff key;
- trigger result (`TRIGGERED | ALREADY_TRIGGERED | IGNORED | UNKNOWN | FAILED`);
- timestamps and sanitized response metadata;
- journey-run state remains `UNKNOWN` unless a supported confirmation exists.

`ZohoAutomationAudit`:

- actor, action, plan, recipient/context, reason, evidence/reference, timestamp;
- covers legacy enrollment, J1 approval, context assignment/release, subscription verification, kickoff booked/corrected, event cancellation/requeue.

### APIs and jobs

- `POST /api/admin/plans/[planId]/automation/enroll`
  - admin-only; explicit `sendWelcome`; audited; transactional outbox.
- `POST /api/admin/plans/[planId]/kickoff-booking`
  - authorized admin/SE; idempotent; booking is not task completion.
- `POST /api/admin/zoho/contexts/[email]/assign`
- `POST /api/admin/zoho/contexts/[email]/request-release`
- `POST /api/admin/zoho/contexts/[email]/confirm-release`
- `POST /api/admin/zoho/outbox/[eventId]/requeue`
- `POST /api/admin/zoho/outbox/[eventId]/cancel`
- `POST /api/admin/zoho/contacts/[contactId]/verify-subscription`
- `GET /api/admin/zoho/conflicts`
- `GET /api/cron/zoho-dispatch` every five minutes, protected by `CRON_SECRET`.
- `GET /api/cron/zoho-nudges` once per business day, or one daily scheduler that creates J3 events and lets the five-minute dispatcher send them.

State-changing portal/admin routes must append outbox events inside the same Prisma transaction as business state. The Zoho adapter must never be called inside the user request transaction.

## 4. Marketing and operations decisions still outstanding

1. Confirm the actual double-opt-in behavior for the configured KZero Partner Onboarding list.
2. Confirm the list is private and existing contact fields update through `listsubscribe`.
3. Confirm how Partner Onboarding topic association and Marketing eligibility can be inspected; approve the manual verification procedure if no supported API proves both.
4. Approve the one-active-plan-per-email V1 policy and the manual context-release SOP.
5. Approve J8 as NFR-only, or provide separate approved Customer-plan completion copy/event rules.
6. Confirm recipients: Onboarding Owner for J1/J3/J5 and Onboarding Owner plus Executive Sponsor for J8.
7. Confirm Nicholas remains branded sender at launch and specify Reply-To for every journey node.
8. Decide whether/when to move to `onboarding@kzero.com`; confirm mailbox owner and reply SLA.
9. Verify Ben's sender status only if branded mail might send from Ben; it is irrelevant to Outlook follow-up sent directly by Ben.
10. Replace the J8 feedback URL, host the logo on an approved KZero/ZMA asset host, and complete the custom return path.
11. Confirm internal-alert backup coverage and ownership.
12. Launch only test copies first; production journey keys must not be configured as enabled while journeys remain Draft.
13. Confirm destination Vercel team is Pro or Enterprise and identify transfer owners for project, Prisma resource, Blob store, domain, GitHub, and secrets.

## 5. Safe implementation sequence

1. **Resolve launch decisions:** subscription test, V1 context policy, J8 scope, recipients, sender/Reply-To, destination Vercel plan.
2. **Add schema with dispatch off:** additive migration, backup/rehearsal, outbox/context/audit tables, nullable timestamps, stable task keys, legacy exclusion backfill.
3. **Audit the backfill:** resolve every ambiguous task mapping manually; confirm no existing state or timestamp changed and no outbox event was created.
4. **Add contact/SE/admin controls:** plan contacts, assigned-SE fields, historical enrollment approval, kickoff booking, conflicts/context UI.
5. **Emit events transactionally in dry-run mode:** create outbox events from plan creation and state transitions, but keep `ZOHO_DISPATCH_ENABLED=false`.
6. **Implement dispatcher and nudge evaluator:** context/subscription gates, per-email serialization, idempotency, rate-lock handling, sanitized observability. Test against a fake adapter first.
7. **Transfer hosting separately:** project, Prisma resource, Blob store, domains, GitHub access, secrets, then validate the application before enabling cron.
8. **Run controlled ZMA tests:** test contacts and launched test journeys only; confirm fields, double opt-in, topics, stops, sender/replies, ignored/already-triggered behavior.
9. **Pilot one native plan:** manually approve one recipient/context, monitor every outbox/trigger/journey result, and verify no historical plan enrolled.
10. **Production launch:** marketing launches approved journeys; configure production keys; enable dispatcher; retain a one-switch kill flag that stops external calls without deleting events.

## 6. Explicit launch blockers

- Double-opt-in behavior for the configured list is untested.
- Partner Onboarding topic association and Marketing lead eligibility are not yet verifiable by the proposed integration.
- KZero Partner Onboarding list privacy and existing-contact updates are unconfirmed.
- Production journeys are Draft; Trigger Leads cannot be treated as available until approved journeys are live.
- Journey/list/topic keys and custom-field API names are unverified.
- No plan-contact roles or reliable first/last names exist in the current schema.
- Assigned-SE email and booking URL are not persisted reliably.
- Stable task keys and truthful task/next-task timestamps do not exist.
- No outbox, send ledger, context lock, conflict UI, or audited manual release exists.
- J8 NFR-only scope and recipient policy need marketing approval.
- Sender, Reply-To, feedback URL, logo host, return path, and internal-alert backup are unresolved.
- Destination Vercel team plan and owners are unverified.
- Prisma Postgres and private Blob transfer/reconnection plans are not approved or rehearsed.
- No `CRON_SECRET`, cron route, or five-minute cron configuration exists.

## 7. Acceptance tests

### Issue 1 — Context ownership

- Create NFR and Customer plans with the same normalized recipient email. Confirm only one context row exists.
- With no owner and one eligible plan, confirm that plan acquires the context atomically.
- With no owner and two eligible plans, confirm both events become held and no Zoho adapter method is called.
- With plan A owning the context, emit plan B upsert/J5/J8 events. Confirm they remain held and plan A fields are unchanged.
- Run two dispatchers concurrently. Confirm row locking produces no duplicate upsert or trigger.
- Request release while a journey state is unknown. Confirm reassignment remains blocked.
- After audited manual verification, release, assign plan B, and requeue. Confirm plan B upsert precedes its trigger.
- Confirm held events survive restarts and retention jobs.

### Issue 2 — Legacy records

- Restore a production snapshot and record row counts/checksums before migration.
- Run migration and confirm every pre-existing plan is `LEGACY`, `EXCLUDED`, and `automaticJ1Allowed=false`.
- Confirm task statuses, progress, plan status, `createdAt`, `updatedAt`, and `lastActivityAt` are unchanged.
- Confirm historical `statusChangedAt`, `completedAt`, `nextTaskSince`, and `kickoffBookedAt` remain null.
- Confirm no outbox or journey-send rows are created by migration.
- Confirm ambiguous task mappings are reported and automation-blocked.
- Manually enroll a legacy plan without J1 and confirm no J1 event exists.
- Repeat with explicit J1 approval and confirm exactly one audited J1 event exists.

### Issue 3 — Subscription eligibility

- Call `listsubscribe` only against the approved test account/contact. Capture whether the response reports confirmation mail.
- Before confirmation, confirm trigger events remain held as `PENDING_CONFIRMATION`.
- Confirm Get List Leads distinguishes active, unsubscribed, and bounced test contacts.
- Verify Partner Onboarding topic and Marketing status in ZMA; record the portal verification evidence.
- Confirm a topic-declined, unsubscribed, bounced, invalid, and group email cannot trigger a journey.
- Confirm `triggered_leads` alone does not change eligibility to confirmed or delivered.
- Confirm an existing contact updates only after list privacy/custom-field naming is verified.

### Issue 4 — Kickoff booking

- As an unauthorized user, confirm the booking endpoint returns 401/403 and changes nothing.
- As an authorized SE, mark kickoff booked once. Confirm timestamp/actor/audit and one upsert event are committed together.
- Repeat the request and confirm idempotency: no duplicate event.
- Confirm task status/progress and meeting-completion state do not change.
- Confirm the outgoing field snapshot maps `Next Task Status` to `Upcoming`.
- Simulate Zoho failure and confirm the durable event retries; J1 stop update is not lost.
- Correct/cancel a booking and confirm an audited action; confirm J1 is not silently restarted.

### Issue 5 — J8

- Confirm `templateKey=complete-first-customer-rollout` is unique within each plan after backfill.
- Complete the task on an active NFR plan and confirm exactly one J8 event.
- Replay completion and rollback/re-complete; confirm the J8 dedupe key prevents another trigger.
- Complete the equivalent task and then the entire Customer plan; confirm no J8 event.
- Confirm an excluded legacy NFR plan does not emit J8 until manually enrolled.

### Issue 6 — Sender and replies

- Inspect each test journey node and record From and Reply-To; confirm portal payload contains no sender override.
- Confirm merge fields use the assigned plan SE name/email/booking URL.
- Send test mail and reply; confirm the reply reaches the approved mailbox and assigned owner.
- Confirm internal alerts reach Ben/backup as configured and the draft content uses the correct plan/SE fields.
- If adopting `onboarding@kzero.com`, repeat sender verification, return-path, mailbox access, and reply tests before changing production journey nodes.

### Issue 7 — Vercel transfer

- Confirm destination team is Pro or Enterprise and accepts `*/5 * * * *` at deployment.
- Inventory production domains, env-var names/scopes, Git link, Prisma resource, Blob store ID/access mode, and current deployment before transfer.
- Transfer in a rehearsal/non-production project where practical.
- After transfer, confirm read-only database row counts and no migration occurred.
- Upload and authenticated-download a new private test blob; open an existing stored document; confirm the store remains private.
- Confirm the custom production domain, `AUTH_URL`, OIDC callbacks, portal links, and TLS continue working.
- Push a test commit and confirm GitHub preview/production deployment permissions.
- Call the cron route without/wrong secret and receive 401; invoke with the Vercel Bearer secret and receive 200.
- Force one cron invocation to fail and confirm Vercel does not retry it, then confirm the next scheduled run processes the durable pending row.
- Rotate `CRON_SECRET` after transfer and confirm the old value no longer works.
