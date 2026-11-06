# Onboarding Portal → Zoho Marketing Automation: Integration Spec

**For:** the developer who maintains the KZero onboarding portal (Next.js on Vercel)

**Owner:** Nicholas Tsoukas · **Sales Engineer on the program:** Ben Eakin (b.eakin@kzero.com)

**Status:** Draft v1, Oct 30, 2026. The Zoho side is built and saved as Draft; nothing is live.

---

## 1. What you're building

The portal already knows each partner's phase, next task, task owner and task status. This integration sends that state to **Zoho Marketing Automation (ZMA)** and starts the right email journey at the right moment. Zoho handles the email design, the waits between follow-ups, and stopping a sequence when the partner acts.

```
Portal state change / daily job
        │
        ▼
 outbox row (same DB transaction)
        │
        ▼
 dispatcher (Vercel Cron, every 5 min, retries)
        │
        ├─ 1. Upsert contact + fields in ZMA   (listsubscribe)
        └─ 2. Start journey                     (Trigger Leads)
```

**Ground rules**
1. **Always update the contact's fields first, then trigger the journey.** Emails and wait conditions read the fields.
2. **All Zoho calls are server-side.** OAuth credentials live in Vercel environment variables and never reach the browser.
3. **Never lose or double-send an event.** Write events to an outbox in the same transaction as the state change, and make every send idempotent.

There is **no Zoho CRM** in this design. The portal writes directly to ZMA contacts.

---

## 2. Prerequisites in the portal

These come from the earlier portal review. The current portal runs on demo-generated data, so the integration needs these first.

| # | Need | Why |
|---|---|---|
| P1 | **Persistent plans and tasks** in a database | Events and the daily job need real, durable state. |
| P2 | **`status_changed_at` on every task**, plus `next_task_since` on the plan | Reminder windows are measured from these. |
| P3 | **Plan contacts with roles**: Onboarding Owner (required), Executive Sponsor and Technical Admin (optional) | Decides who receives emails. Today the plan has a single `primaryContactEmail`. |
| P4 | **SE profile** on the plan: name, email, booking URL (today: Ben Eakin, b.eakin@kzero.com) | Emails are signed by and link to the assigned SE. The plan already has `assignedSalesEngineerId: "user-se-ben"`. |
| P5 | **Kickoff booked signal**: Microsoft Bookings webhook, or a "Kickoff booked" toggle the SE sets in the admin view | Stops the J1 kickoff reminders. |
| P6 | **Nudge tracking on the plan**: `nudge_task_id`, `nudge_started_at`, `nudge_status` (`waiting` / `done`) | Drives J3-R1. See section 6. |
| P7 | **`zoho_sync` tables**: `outbox` and `journey_sends` | Retries and idempotency. See section 8. |

---

## 3. Zoho setup the developer needs

| Item | Value / where to get it |
|---|---|
| Data center | **US**. API base `https://marketingautomation.zoho.com`, OAuth base `https://accounts.zoho.com` |
| ZMA org | `org859403413` |
| OAuth client | Create a **Server-based** (or Self Client) app at `https://api-console.zoho.com`, generate a refresh token as a user with ZMA admin rights, and store `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` in Vercel. Access tokens last 1 hour: cache and refresh them. |
| Scopes | `ZohoMarketingAutomation.lead.CREATE-UPDATE` (or `lead.ALL`), `ZohoMarketingAutomation.journey.READ`, `ZohoMarketingAutomation.journey.CREATE` |
| List | **KZero Partner Onboarding**. Get its `listkey` from the list's settings in ZMA (or ask Nicholas). |
| Topic | **Partner Onboarding**. Get its topic ID from ZMA (Settings → Subscription) and pass it on every contact upsert. Contacts not subscribed to this topic will not receive the journey emails. |
| Journey keys | For each journey, `journey_key` and `trigger_key` from **Get Open Journeys** (section 7.3). Store them as env vars: `ZMA_J1_*`, `ZMA_J3_*`, `ZMA_J5_*`, `ZMA_J8_*`. |

---

## 4. Contact fields (24 custom fields, already created in ZMA)

Send these on **every** upsert, not just the ones that changed, so Zoho never holds stale values. Picklist values must match exactly.

| Field (display name) | Type | Values / format | Notes |
|---|---|---|---|
| First Name, Last Name | Text (built-in) | | First Name is required: emails start "Hi {First Name}". |
| Lead Email | Email (built-in) | | The contact key. |
| Plan ID | Text | e.g. `tsoukasmsp-nfr` | |
| Tenant Type | Picklist | `NFR`, `Customer` | |
| Portal URL | URL | Deep link to the partner's plan | Required. |
| Current Phase | Picklist | `Kickoff`, `Tenant Setup`, `App Review`, `SSO Rollout`, `First Customer Pilot`, `Onboarding Complete` | J1 exits when this moves past `Kickoff`. |
| Onboarding Progress | Percent | 0–100 | |
| Onboarding Role | Picklist | `Onboarding Owner`, `Executive Sponsor`, `Technical Admin` | |
| Onboarding State | Picklist | `Active`, `Paused`, `Complete` | |
| Next Task ID | Text | Portal task ID | |
| Next Task Title | Text | e.g. "Submit your SSO app list" | Required. Used in subjects. |
| Next Task Owner | Picklist | `MSP`, `KZero SE`, `Shared` | Portal `msp` / `kzero_se` / `shared`. |
| Next Task Status | Picklist | `Action Required`, `In Progress`, `KZero Working`, `Upcoming`, `Complete` | Map from portal statuses (below). **J1's waits read this.** |
| Next Task Minutes | Integer | Estimated minutes | |
| Next Task Link | URL | Deep link to the task | Required. |
| Next Task Tip | Text | One-sentence tip | Shown in a callout. |
| Next Task Guide URL | URL | Help article for the task | |
| Next Task Since | Date and Time | When this task became the next task | |
| Last MSP Activity | Date and Time | Last partner action in the portal | |
| Last SE Touch | Date and Time | Last SE update | |
| Apps Submitted, Apps Approved | Integer | | |
| SE Name, SE Email, SE Booking URL | Text / Email / URL | Ben Eakin, b.eakin@kzero.com, his Bookings link | Required. Signature, links, and the SE follow-up drafts in the SE alerts. |
| **Nudge Status** | Text | `Waiting` or `Done` (exactly) | **J3-R1's waits read this.** See section 6. |

**Portal status → `Next Task Status`**

| Portal status | Zoho value |
|---|---|
| `waiting_on_msp` | `Action Required` |
| `in_progress` | `In Progress` |
| `waiting_on_kzero` | `KZero Working` |
| `not_started` | `Upcoming` |
| `complete` | `Complete` |

For the kickoff task: `Action Required` until the kickoff is booked, then `Upcoming` (booked, not yet held). **When J1 is triggered, `Next Task Status` must already be `Action Required`.** Any other value makes J1's first wait end immediately, and the kickoff reminder is never sent.

---

## 5. Events → Zoho actions

| Portal event | Where it fires | Zoho action | Recipients |
|---|---|---|---|
| **Plan created** (Onboarding Owner known) | Admin / enrollment | Upsert contact(s) → **trigger J1** | Onboarding Owner |
| **Kickoff booked** | Bookings webhook or SE toggle (P5) | Upsert: `Next Task Status = Upcoming` | – (stops J1 waits) |
| **MSP completes a task** | `POST /api/portal/plans/{planId}/tasks/{taskId}/complete` | Upsert new next-task fields. If `taskId == nudge_task_id`, also set `Nudge Status = Done` | – (no email: the portal shows the next step) |
| **KZero step completes and the next task goes to the partner** (previous owner `kzero_se`, new owner `msp`/`shared`) | Admin view (SE completes a task) | Upsert → **trigger J5** | Onboarding Owner |
| **Any other state change** (status, phase, apps, documents) | Portal API routes / admin view | Upsert only | – |
| **First customer rollout completed** | Task complete route | Upsert (`Current Phase = Onboarding Complete`, `Onboarding State = Complete`) → **trigger J8** | Onboarding Owner + Executive Sponsor |
| **Daily nudge check** | Vercel Cron, business days 9:00 ET | For each eligible plan: upsert (`Nudge Status = Waiting`) → **trigger J3-R1** | Onboarding Owner |
| **Plan paused** | Admin view | Upsert (`Onboarding State = Paused`, `Nudge Status = Done`) | – |

Other routes to emit upserts from (from the portal review): `POST .../apps`, `POST .../first-customer-pilot`, `POST .../documents`, and portal visits (update `Last MSP Activity` only, at most once per hour per plan).

---

## 6. The daily nudge job (J3-R1)

Runs once per business day. A plan is **eligible** when all of these are true:

1. `Onboarding State = Active`, and the plan is past Kickoff (J1 handles the kickoff).
2. Next task owner is `msp` or `shared`, and status is `waiting_on_msp` or `in_progress`.
3. The task has waited past its window: **4 business days** for setup tasks (Tenant Setup, App Review, SSO Rollout), **7 business days** for First Customer Pilot tasks, measured from `next_task_since`.
4. **No nudge sequence is running** for this plan: `nudge_status != waiting`, or `nudge_started_at` is more than 10 days ago.
5. **This task has never been nudged before** (`journey_sends` has no J3 row for this plan and task). After one full sequence the SE owns the follow-up.

For each eligible plan:
1. Set `nudge_task_id = task`, `nudge_started_at = now`, `nudge_status = waiting` in the portal DB.
2. Upsert the contact with the current next-task fields and **`Nudge Status = Waiting`**.
3. Trigger J3-R1.

**Setting `Nudge Status = Done`** (upsert immediately, not at the next daily run) when any of these happens:
- the partner completes `nudge_task_id`;
- `nudge_task_id` stops being partner-owned (for example, the SE takes it over);
- the plan is paused or completed.

Zoho checks this field during both waits (2 days, then 7 days). As soon as it reads `Done`, the partner leaves the journey and gets no more emails. **If the portal never sends `Done`, the partner keeps getting reminders for a task they finished.** This is the most important behavior to get right.

---

## 7. Zoho API calls

All calls send the header `Authorization: Zoho-oauthtoken {access_token}`. POST calls use `Content-Type: application/x-www-form-urlencoded`.

### 7.1 Upsert contact and fields: `listsubscribe`

```
POST https://marketingautomation.zoho.com/api/v1/json/listsubscribe
  listkey   = {KZero Partner Onboarding list key}
  resfmt    = JSON
  topic_id  = {Partner Onboarding topic ID}
  sources   = Onboarding Portal
  leadinfo  = {"Lead Email":"alex@northwind-msp.com","First Name":"Alex","Last Name":"Smith",
               "Plan ID":"northwind-nfr","Current Phase":"App Review",
               "Next Task Title":"Submit your SSO app list","Next Task Status":"Action Required",
               "Nudge Status":"Waiting", ...all fields from section 4...}
```
Scope `lead.CREATE` (or `lead.CREATE-UPDATE`). Limit 500 calls / 5 min (lock 30 min if exceeded). One contact per call.

### 7.2 Start a journey: Trigger Leads

```
POST https://marketingautomation.zoho.com/api/v1/journeys/{journey_key}/action/trigger
  details = {"lead_email":"alex@northwind-msp.com","triggerkey":"{trigger_key}","listkey":"{listkey}"}
```
Scope `journey.CREATE`. Up to 200 comma-separated emails per call. **Limit 100 calls / 5 min, then locked for 30 min**, so the daily job should batch by journey.

The response lists `triggered_leads`, `already_triggered` and `ignored_leads`. Treat `already_triggered` as "skip, contact is already in this journey" and log it. Errors: `9002` invalid journey key, `9006` journey inactive, `9007` missing field, `9004` more than 200 emails.

### 7.3 Get journey and trigger keys (one-time setup)

```
GET https://marketingautomation.zoho.com/api/v1/journeys?details={"page":"1","limit":"20","sort_order":"asc","user":"all","trigger_type":"open"}
```
Scope `journey.READ`. Returns `journey_key` and the trigger key for each Open-trigger journey. Zoho's own sample shows the trigger key as both `triggerkey` and `trigger_key`, so read either.

---

## 8. Reliability

- **Outbox:** each state change writes an `outbox` row (`id`, `plan_id`, `kind` = `upsert` | `trigger`, `journey`, `payload`, `status`, `attempts`, `next_attempt_at`) in the same DB transaction.
- **Dispatcher:** Vercel Cron every 5 minutes. Process the oldest rows first, and always send a plan's upsert before its trigger. Retry with exponential backoff (1, 5, 15, 60 min, then alert). On HTTP 429 or a Zoho lock, pause that API for 30 minutes.
- **Idempotency:** `journey_sends` has a unique key (`plan_id`, `journey`, `task_id` or `-`). Insert before triggering. If the row already exists, skip. This guarantees J1 and J8 at most once per plan, J5 at most once per handoff, and J3-R1 at most once per task.
- **Observability:** log every Zoho call against its outbox ID. Alert on outbox rows older than 15 minutes. Show "Last synced to Zoho" in the admin view.

---

## 9. What Zoho does after the trigger (for reference)

| Journey | Sequence | Stops when |
|---|---|---|
| **J1 Welcome and Kickoff Booking** | Welcome → wait up to 3 days → kickoff reminder → wait up to 7 days → internal alert to Ben containing a drafted check-in email, which Ben sends from Outlook | `Next Task Status` is no longer `Action Required`, or `Current Phase` moves past `Kickoff` |
| **J3-R1 Next Action Nudge** | Nudge → wait up to 2 days → reminder → wait up to 7 days → internal alert to Ben containing a drafted offer-to-help email, which Ben sends from Outlook | `Nudge Status = Done` |
| **J5 Your Next Step Is Ready** | One email | – |
| **J8 Completion and Expansion** | One milestone email | – |

Re-entry is enabled for J3-R1 and J5.

---

## 10. Risks to verify in the first test (open items)

1. **Double opt-in confirmation email.** Double opt-in is **enabled** in this ZMA account, and Zoho's docs say `listsubscribe` sends a confirmation email that the contact must click before they are subscribed. If that applies here, partners would get a "Confirm your subscription" email first, and wouldn't receive onboarding emails until they confirmed. **Test with one contact first.** If a confirmation is sent, Nicholas decides how to handle it (change the opt-in setting for this list, or ask Zoho support for a transactional path). Don't work around it in code.
2. **Custom field names in `leadinfo`.** Zoho documents built-in fields by display name ("Lead Email", "First Name") but not custom fields. Test that display names ("Next Task Title") update the fields. If they don't, try the merge-tag style names (`NEXT_TASK_TITLE`).
3. **Updating existing contacts.** Zoho says `listsubscribe` updates existing contacts only on a **private** list. Confirm the KZero Partner Onboarding list is private.
4. **Journeys must be live to accept triggers** (error `9006` otherwise). Integration testing needs launched test copies of the journeys (see section 11). The real journeys stay in Draft until launch.
5. **Kickoff booking signal (P5).** Pick Bookings webhook vs SE toggle.
6. **Recipients.** This spec sends action emails to the Onboarding Owner only, and J8 also to the Executive Sponsor. Confirm.

---

## 11. Testing and acceptance

**Test setup (in Zoho, done by Nicholas or Claude):** clone J1 and J3-R1 as "TEST J1" and "TEST J3-R1" with **1-hour waits** (Zoho's minimum unit), alerts going to Nicholas, and test contacts on your own `+test` addresses. Launch only the test copies.

**Acceptance criteria**
- [ ] A new plan creates or updates the Zoho contact with all section-4 fields, and starts J1 exactly once.
- [ ] Booking the kickoff sets `Next Task Status = Upcoming` within 5 minutes, and no kickoff reminder is sent afterwards.
- [ ] An SE completing a KZero-owned step that hands work back to the partner starts J5 once.
- [ ] The daily job starts J3-R1 only for eligible plans (section 6), never twice for the same task, and never while a sequence is running.
- [ ] Completing the nudged task sets `Nudge Status = Done` within 5 minutes. A test contact marked Done during the first wait gets **only** the first nudge.
- [ ] Completing First Customer Rollout starts J8 once.
- [ ] Zoho downtime or a 429 response never loses an event: rows retry and succeed later.
- [ ] No Zoho credentials appear in client bundles or logs.

---

## 12. Rough effort

| Piece | Estimate |
|---|---|
| Prerequisites P1–P6 (if not already planned) | 3–5 days |
| OAuth client, Zoho API wrapper, outbox + dispatcher | 1.5–2 days |
| Event emission in routes and admin view | 1 day |
| Daily nudge job | 1 day |
| Testing with the TEST journeys | 1 day |

---

*References: Zoho Marketing Automation Developer Guide (listsubscribe, Trigger Leads, Get Open Journeys); `Zoho_MA_Setup_Handoff.md`; `KZero_Onboarding_Email_Automation_Blueprint.docx`.*
