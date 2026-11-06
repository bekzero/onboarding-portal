# KZero Partner Onboarding: Zoho Marketing Automation setup handoff

Updated Oct 30, 2026: **4 journeys**. J1 and J3-R1 now end with an internal alert to the SE that contains a ready-to-send email; the SE copies it into Outlook and sends it. Zoho no longer sends the SE email itself (J1-3 and J3-R3 were removed). The standalone I1 alert was retired. Everything in Zoho Marketing Automation (org 859403413) is still a **Draft**: nothing has been launched or sent, and no contacts were imported.

**Approach:** the portal guides the work. Email is used to (1) tell a partner it's their turn again and (2) follow up when a step stalls: a branded email, a branded reminder, then a personal email the SE sends from Outlook (Zoho drafts it inside the SE alert). Every sequence stops as soon as the partner acts.

## Journeys

| Journey | Portal enrolls the contact when | What happens |
|---|---|---|
| **ONB J1 Welcome and Kickoff Booking** | `plan.created` | J1-1 welcome email → wait up to 3 days → J1-2 branded kickoff reminder → wait up to 7 days → internal alert to the SE with a drafted check-in email (the SE sends it from Outlook). Each wait ends when Next Task Status is no longer *Action Required* (kickoff booked). Goal: exits when Current Phase moves past Kickoff. |
| **ONB J3-R1 Next Action Nudge** | Daily job: an MSP-owned task has gone past its reminder window (about 4 business days for setup tasks, about 7 for pilot tasks). Portal sets **Nudge Status = Waiting** first. | J3-R1 branded nudge → wait up to 2 days → J3-R2 branded reminder → wait up to 7 days → internal alert to the SE with a drafted offer-to-help email (the SE sends it from Outlook). Each wait ends when **Nudge Status = Done** (portal sets it when the MSP completes that task). One sequence at a time per partner; never while KZero owns the step. |
| **ONB J5 Your Next Step Is Ready** | A KZero-owned step completes and the next task owner becomes the MSP (app review done, onboarding plan uploaded, pilot plan approved) | One email: "KZero has finished its part; your next step is X." |
| **ONB J8 Completion and Expansion** | "Complete First Customer Rollout" completed | One milestone email with next steps and a feedback link. |

Each journey has its own trigger key. Get the keys with the ZMA **Get Open Journeys** API (`trigger_type=open`) and enroll contacts with **Trigger Leads** (lead email + trigger key + list key for *KZero Partner Onboarding*). **Update the contact's fields first**, then call Trigger Leads. Re-entry is on for J3-R1 and J5.

### What's handled outside email

| Moment | Handled by |
|---|---|
| Kickoff still not booked after reminder | SE alert with drafted email; SE sends it (end of J1) |
| Moving to the next phase | Portal shows the next phase |
| KZero working on a step | Portal shows the "KZero is working" status |
| Session prep (kickoff, SSO, customer rollout) | Agenda and checklist in the Microsoft Bookings calendar invite |
| Stalled after a nudge and reminder | SE alert with drafted email; SE sends it (end of J3-R1) |
| Customer #2 | Sales or partner marketing |

### Expected volume

- **Engaged partner:** about 4 to 5 emails over 6 to 8 weeks (welcome, 2 or 3 "next step is ready", milestone).
- **Slow partner:** the same, plus at most 3 touches per stalled step (nudge, reminder, SE email sent by the SE from Outlook). After that, the SE follows up personally.

## Contact fields the portal must fill in (24)

Plan ID, Tenant Type, Portal URL, Current Phase, Onboarding Progress, Onboarding Role, Onboarding State, Next Task ID, Next Task Title, Next Task Owner, Next Task Status, Next Task Minutes, Next Task Link, Next Task Tip, Next Task Guide URL, Next Task Since, Last MSP Activity, Last SE Touch, Apps Submitted, Apps Approved, SE Name, SE Email, SE Booking URL, **Nudge Status** (text: `Waiting` / `Done`, controls the J3-R1 waits).

Merge tags use `$[UD:FIELD_NAME||]$`. No field has a default value, so the portal must always populate First Name, Portal URL, Next Task Title, Next Task Link, SE Name, SE Email and SE Booking URL.

## Templates

The library holds only the 4 templates in use: **J1-1 Welcome**, **J3-R1 Next Action Nudge**, **J5 Your Next Step Is Ready**, **J8-1 First Customer Live**. The 18 unused templates were deleted. The two reminder emails (J1-2, J3-R2) live only inside their journeys. The SE follow-up drafts live in the internal alert nodes at the end of J1 and J3-R1 (plain text, merge tags for partner name, Contact Email, Next Task Title, Next Task Link, SE Booking URL and SE Name). Zoho caps an alert body at **500 characters**, so keep the drafts short. Note: J8-1's live content (inside the J8 journey) includes the feedback link; the library copy still has the older wording.

## Before launching

1. **J2 Phase Transitions:** now an empty draft (trigger only, no emails), moved to the **Unused do not launch** journey folder. **I1 SE Follow-up Alert** was retired (SE alerts now end J1 and J3-R1) and moved to the same folder. Zoho returned "Internal Server Error" every time I tried to delete it. Try deleting it again later, or ask Zoho support.
2. **Sender:** the branded emails send from *Nicholas <n.tsoukas@kzero.com>*. The SE is **Ben Eakin (b.eakin@kzero.com)**; his address was added as a Zoho sender and is *pending* until he clicks the verification email. That only matters if you want the branded emails to come from Ben: the SE follow-ups are sent by Ben from his own Outlook.
3. **Feedback link:** J8's "Share quick feedback" button points to the portal. Replace it with the real survey URL.
4. **Topic (done):** all 4 onboarding emails use the **Partner Onboarding** topic, so a marketing unsubscribe doesn't stop onboarding emails, and vice versa. When the portal adds contacts, subscribe them to the Partner Onboarding topic; contacts not subscribed to it won't receive these emails.
5. **Logo:** hot-linked from `s1.designmodo.com`. Host it on kzero.com or in ZMA *My Files*.
6. **Internal alerts:** the SE alerts in J1 and J3-R1 go to **b.eakin@kzero.com** and carry the drafted follow-up email. If Ben doesn't act on an alert, the partner hears nothing more, so treat them as tasks (consider copying a second person). Ben was assigned Marketing Automation in Zoho One (role User, workspace Viewer) so he can receive them. Zoho internal emails can only target fixed org users, so add other SEs or a shared inbox if the team grows.
7. **Domain:** finish the *Custom Return Path* for kzero.com (Settings > Email > Senders and Authentication).
8. **Test:** use a test contact with your own email, fill in the fields, enroll it in each journey through the API, check rendering, then *Send for review* and *Launch*.
