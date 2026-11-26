# MSP automated-email workflow

## Administrator experience

Case Preview shows one plan-scoped setting: **Automated Emails**. An individually authenticated Staff ADMIN can enable or disable it. Routine onboarding never requires event IDs, Postman, provider keys, Vercel changes, or maintenance deployments.

`GET /api/admin/zoho/automation/plans/{planId}/email-automation` is read-only. It returns the selected plan's recipient, stage, queued/last journey summary, plain-language blockers, and activity.

`POST /api/admin/zoho/automation/plans/{planId}/email-automation` accepts:

```json
{ "action": "ENABLE", "confirmed": true }
```

or:

```json
{ "action": "DISABLE", "confirmed": true }
```

POST requires an individually attributable Staff SSO ADMIN and a trusted same-origin request.

## Enable guarantees

- The immutable legacy cohort is rejected.
- The Onboarding Owner must match the MSP primary email and have a valid first name.
- Individually attributable permission evidence and subscription evidence are required.
- Unsubscribed, bounced, incomplete, or uncertain suppression scans fail closed.
- Sales Engineer identity, task mappings, private-list/field metadata, Topic ID, OAuth, portal URL, J1 configuration, and the latest list-safety review must be valid.
- Communication ownership is acquired only when unassigned; conflicts fail closed under a PostgreSQL advisory lock.
- One transaction activates only the selected plan/contact, writes an audit, and creates a fresh full-field contact event followed by a deduplicated J1 event when the plan is still at kickoff.
- The request never calls a Zoho write API. Recipient sequence ordering prevents J1 from being claimed before contact synchronization succeeds.
- Later portal lifecycle changes continue to use the existing event, sequencing, retry, freshness, and journey-ledger infrastructure.

## Disable guarantees and limitation

Disable pauses only the selected plan, disables its contact, finishes KZero nudge eligibility, cancels its unclaimed `PENDING`, `HELD`, and `RETRY` events, and records an audit. Succeeded history and journey ledgers are preserved, so re-enabling cannot resend J1.

KZero cannot infer that a Zoho journey wait has exited merely because KZero work is cancelled. If a contact is already inside a provider journey, support must independently verify its exit condition. The UI states this limitation instead of claiming delivery or cancellation.

## Support diagnostics

Technical events and diagnostics remain under `/admin/zoho`. The normal Case Preview does not expose raw event IDs, provider errors, keys, pilot controls, or exact-dispatch operations. Sensitive support routes retain their existing Staff ADMIN, same-origin, allowlist, and feature-flag protections.

## Activation boundary

Plan-level enablement never enables global dispatch. The global kill switch, dispatch mode, contact-sync, journey, automatic-dispatch, event-emission, and nudge flags remain authoritative. A dormant deployment can therefore include this workflow without sending provider requests.

`ZMA_FIELD_MAPPING_VERIFIED` and `ZMA_PRIVATE_LIST_VERIFIED` are tenant-wide provider-configuration evidence, not per-MSP administrator steps. They may be set to `true` only after current read-only discovery confirms the complete field contract and the configured list key resolves uniquely to the approved private list. These markers do not enable sending; all global dispatch safeguards remain independently authoritative.

## Controlled Production rollout and automatic dispatch

Routine activation requires the approved plan and email in
`ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS` and `ZOHO_PRODUCTION_ROLLOUT_EMAIL`. The
normalized primary contact, sole Onboarding Owner, and event recipient must
all match. Event creation, batch claiming, and final provider writes also
check that the current owner has the latest individually attributed enable
approval. Old events without the approved owner ID are ineligible. A missing
or mismatched setting permits no routine Production work.
`ZMA_AUTOMATED_JOURNEYS` must be exactly `J1` to allow Welcome journey work.
Other values, including lists with additional journeys, leave journey work blocked.

Vercel Schedules invokes a private `schedule/v1beta` function every 15 minutes,
the fastest cadence supported on Hobby. Hobby applies a 15-minute jitter window,
so execution can arrive later than the nominal cron time. The function has no
public URL and Vercel authenticates schedule delivery; it does not require or
receive `CRON_SECRET`. The retained public cron routes remain fail-closed and
still require `CRON_SECRET` if they are ever invoked separately.

The static `zoho-automatic-dispatch` schedule can be disabled or re-enabled from
Vercel's Schedules dashboard or CLI without a deployment and without changing
any MSP enrollment state. Scheduling never bypasses the global kill switch,
dispatch mode, production approval, contact-sync, journey, consent, suppression,
ownership, legacy, sequencing, or rollout gates.

The first contact request is provider acceptance only. KZero records it as a
retryable pending-verification state and performs a read-only membership scan on
the next dispatch attempt. J1 is eligible only after the explicitly linked
contact event is `SUCCEEDED` with outcome `VERIFIED` and its immutable snapshot
still equals current KZero state. J1 is then triggered without another contact
write. Unknown, delayed, or ambiguous outcomes remain held.

Enrollment may record subscription authorization only when an individually
authenticated ADMIN confirms a genuine evidence reference and explains the
independently supportable authorization basis. This is distinct from general
contact permission. Absence of either record leaves activation blocked, and a
fresh suppression scan still runs when the administrator clicks Enable.

BenMSP E2E Test is outside the approved plan and recipient pair. Leave its
existing KZero state and active Zoho reminder intact during this rollout.

Initial one-plan Production configuration (only after separate authorization):

```text
ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS=kzeroautomatione2etest-nfr
ZOHO_PRODUCTION_ROLLOUT_EMAIL=beneakinkzero@gmail.com
ZMA_AUTOMATED_JOURNEYS=J1
ZOHO_GLOBAL_KILL_SWITCH=false
ZOHO_DISPATCH_MODE=production
ZOHO_CONTACT_SYNC_ENABLED=true
ZOHO_JOURNEY_TRIGGERING_ENABLED=true
ZOHO_AUTOMATIC_DISPATCH_ENABLED=true
ZOHO_PRODUCTION_DISPATCH_APPROVED=true
```

Keep `ZOHO_DISPATCH_ENABLED=false` (legacy alias), exact/test/pilot flags false,
and J3/J5/J8 and nudge evaluation disabled. `ZOHO_EVENT_EMISSION_ENABLED` is not
required for the initial Enable action because that transaction prepares its own
contact/J1 pair; enable lifecycle emission only after the isolated J1 acceptance
test when ongoing task-driven updates are approved.

`CRON_SECRET` is not required by the private automatic-dispatch schedule. Set it
only if the retained public cron endpoints are intentionally used; otherwise
leave those endpoints inaccessible.

The Case Preview reports only KZero-triggered journey activity. A journey started directly in Zoho is not represented as a KZero send. A `HELD` outbox event is not a scheduled email and is presented as held work rather than a future send.
