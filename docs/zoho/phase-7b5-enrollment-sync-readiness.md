# Phase 7B.5 — MSP enrollment synchronization readiness

## Scope and safety posture

Phase 7B.5 adds a read-only evaluation of the existing MSP enrollment-to-Zoho contact synchronization path. It does not add a second synchronization implementation, create outbox events, contact Zoho, change consent or subscription state, or enable any production flag.

The evaluator reads the persisted MSP, Onboarding Owner, permission audit, communication context, enrollment outbox event, and current configuration. The same `evaluateEnrollmentContactSync` decision used by event preparation remains the source for the projected preparation decision.

## Readiness matrix

| Capability | Evidence level | Current result |
| --- | --- | --- |
| OAuth refresh, list lookup, email-only list add, membership verification | Verified through an authorized Production test in Phase 7B.3 | Available, but not invoked by this phase |
| Permission attestation and evidence capture during MSP enrollment | Automated and source-verified | Persisted in `ZohoAutomationAudit`; it is not independent proof of marketing consent |
| Individually attributable Staff SSO actor | Automated tests; depends on configured live Staff SSO | Required before enrollment sync work may be prepared |
| Read-only enrollment synchronization evaluation | Automated tests | Available in the existing MSP case preview |
| Stable enrollment event key and duplicate protection | Automated tests and existing PostgreSQL constraint | One event identity per plan, recipient, and enrollment occurrence |
| HELD event isolation | Automated source and mocked lifecycle tests | Dispatcher claims only `PENDING` and `RETRY`; `HELD` requires an explicit future administrative workflow |
| Unsubscribe/bounce protection | Mocked provider tests | Suppressed recipients are never submitted through `addleadsinbulk` |
| Accepted-but-unverified writes | Mocked provider tests | Retries perform membership verification only and do not repeat the list-add write |
| Automatic production enrollment synchronization | Not authorized or live-tested | Disabled |
| Zoho Topics API | Live read returned no topics in Phase 7B.1 | Not used by the email-only synchronization path; still unresolved with Zoho |
| Journey triggering | Mocked only; production journeys not authorized | Disabled and outside Phase 7B.5 |

## Preparation controls

Event preparation requires all of the following:

- `ZOHO_MSP_ENROLLMENT_CONTACT_SYNC_ENABLED=true`
- `ZOHO_EVENT_EMISSION_ENABLED=true`
- a recorded permission attestation with a nonempty evidence reference
- an individually attributable Staff SSO actor
- a valid primary contact matching the Onboarding Owner
- an automation-active plan and automation-enabled contact
- communication-context ownership by the same plan
- a recipient that is not `INELIGIBLE`

With either preparation flag disabled, no latent outbox event is created. Shared access-code sessions may record the supplied evidence, but cannot prepare outbox work.

## Dispatch controls

Preparation does not authorize dispatch. External contact synchronization additionally remains governed by:

- `ZOHO_GLOBAL_KILL_SWITCH` (must be explicitly released)
- `ZOHO_CONTACT_SYNC_ENABLED`
- `ZOHO_AUTOMATIC_DISPATCH_ENABLED`
- `ZOHO_DISPATCH_MODE`
- `ZOHO_PRODUCTION_DISPATCH_APPROVED`
- verified OAuth, list, field-mapping, and private-list configuration
- current permission, recipient, plan, subscription, and communication-context revalidation

The dispatcher does not claim `HELD` events. Changing an unrelated flag cannot release one.

## Dry-run classifications

The case preview reports one of the existing-domain-aligned classifications:

- `READY_FOR_PREPARATION`
- `MISSING_PERMISSION`
- `MISSING_EVIDENCE`
- `STAFF_IDENTITY_REQUIRED`
- `INVALID_CONTACT`
- `PLAN_NOT_READY`
- `AUTOMATION_DISABLED`
- `ALREADY_SYNCHRONIZED`
- `BLOCKED`
- `UNABLE_TO_VERIFY`

It also returns every blocker, the subset caused by feature flags, whether the case would be eligible if explicitly enabled, and the projected preparation decision. `AUTOMATION_DISABLED` is never presented as `READY`.

## Consent and launch blocker

The portal records an administrator's assertion and evidence reference that appropriate permission was obtained. That record is operational evidence for the controlled email-only list-add workflow; it is not independent proof of marketing consent, topic subscription, or confirmed subscription eligibility. KZero must approve the evidence standard and operating policy before live automatic synchronization is authorized.

## Safe test procedure

1. Keep all Production automation flags at their disabled defaults and the global kill switch enabled.
2. Open an existing MSP case in the Sales Engineer Dashboard.
3. In the existing Zoho integration section, select **Evaluate Zoho Sync**.
4. Review the classification, contact/owner match, staff identity state, current outbox state, and blocker list.
5. Confirm that the result message states that no event or provider request was created.
6. Use `npm run test:zoho-phase-7b5` for mocked lifecycle verification. Do not change Production flags or use a Production MSP as a write fixture.

No schema migration is required.
