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

The Case Preview reports only KZero-triggered journey activity. A journey started directly in Zoho is not represented as a KZero send. A `HELD` outbox event is not a scheduled email and is presented as held work rather than a future send.
