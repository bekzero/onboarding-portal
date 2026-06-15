# AGENTS.md

## Project

Build the KZero Passwordless onboarding portal.

The portal helps MSPs onboard to KZero Passwordless, deploy their NFR tenant, prepare SaaS applications for SSO, work with a KZero Sales Engineer, and repeat the process for customer tenants.

## Core rules

- Keep diffs small and easy to review.
- Do not over-engineer.
- Prefer simple TypeScript.
- Use Next.js App Router.
- Use Tailwind CSS and shadcn/ui.
- Use Auth.js / NextAuth with the Keycloak provider for KZero Multi-Pass OIDC.
- Do not use Supabase.
- Do not add a database yet.
- Use mock data in `/lib/mock-data.ts` until explicitly asked to add persistence.
- Do not add paid services.
- Do not hardcode secrets.
- Use environment variables for all auth and deployment configuration.
- Run `npm run build` before finishing when possible.
- Summarize changed files, assumptions, TODOs, and build result.

## Design source of truth

The visual design must follow KZero-owned references first.

Before building or changing UI, inspect available design references in:

- `/design`
- `/design/screenshots`
- `/brand`
- `/public`
- `/docs/design-brief.md`
- `README.md`

Use partners.kzero.com design references if screenshots, exported HTML, CSS, colors, typography, spacing, buttons, cards, nav, or layout examples are available.

If no KZero design references are present:
- Do not invent a final visual design.
- Create only a clean skeleton.
- Add TODOs to `/docs/design-brief.md` requesting screenshots or brand assets from partners.kzero.com.
- Use conservative KZero-style defaults: blue accents, dark dashboard surfaces, clean cards, rounded corners, and high-contrast CTAs.

## Design direction

- KZero visual identity comes first.
- partners.kzero.com is the preferred design reference.
- KZero dashboard-style patterns are acceptable for internal/admin views.
- Arrows is only UX inspiration for mutual action plans, not a brand/design source.
- Do not copy Arrows branding, copy, icons, proprietary layouts, or visual assets.
- Use Arrows-inspired concepts only:
  - shared onboarding plan
  - clear next step
  - task checklist
  - progress visibility
  - task ownership
  - blockers
  - waiting states
  - document/file collection
  - meeting CTAs

## Routes

Create and maintain these core routes:

- `/`
- `/portal/[planId]`
- `/internal`

## Auth

Use Auth.js / NextAuth with the Keycloak provider for KZero Multi-Pass OIDC.

Expected environment variables:

- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_KEYCLOAK_ID`
- `AUTH_KEYCLOAK_SECRET`
- `AUTH_KEYCLOAK_ISSUER`

Auth requirements:

- `/portal/*` requires an authenticated user.
- `/internal/*` requires an internal role such as `admin` or `sales_engineer`.
- Token claims may vary. Write defensive role parsing.
- Roles may come from:
  - `realm_access.roles`
  - `resource_access`
  - `groups`
  - custom organization claims
- Use safe mock fallbacks for local development only.
- Never commit secrets.

## Mock data

Use `/lib/mock-data.ts` for onboarding state until persistence is requested.

Model:

- organizations
- users
- plans
- phases
- tasks
- SaaS apps
- attachments
- comments
- task submissions

Task statuses:

- `not_started`
- `in_progress`
- `waiting_on_msp`
- `waiting_on_kzero`
- `complete`

Task owners:

- `msp`
- `kzero_se`
- `shared`

## KZero onboarding flow

Model this process:

1. MSP books meeting with Sales Engineer to deploy NFR license.
2. MSP adds backup admins to the MSP Dashboard, including techs and a break-glass account.
3. MSP adds employees and contractors with company email addresses to the NFR tenant.
4. MSP distributes Vault documentation from partners.kzero.com and ensures users import passwords and install the KZero browser extension for Edge, Chrome, or Brave.
5. MSP submits SaaS applications for Sales Engineer compatibility review.
6. Sales Engineer investigates compatibility and creates a plan while MSP is in a waiting state.
7. Sales Engineer uploads onboarding plan for MSP review.
8. MSP books meeting with Sales Engineer to implement SSO for 3-5 apps or until comfortable.
9. MSP rolls out KZero to first customer.
10. MSP repeats the NFR tenant setup steps for the customer tenant.

The MSP tenant and customer tenant flows should be interchangeable. Represent this with a reusable plan template and tenant type such as `nfr` or `customer`.

## UI requirements

MSP portal should show:

- KZero-branded header
- organization name
- plan title
- progress bar
- phase navigation
- current next step
- task list grouped by phase
- task owner
- task status
- due date where relevant
- blockers/waiting states
- Microsoft Bookings CTA for meeting tasks
- SaaS app submission area
- onboarding plan review placeholder

Internal Sales Engineer dashboard should show:

- active onboarding plans
- tasks waiting on KZero
- SaaS apps submitted for review
- plan upload placeholder
- customer rollout status
- filters as static UI unless asked to make them functional

## Implementation preferences

- Prefer server components where practical.
- Use client components only when interactivity requires them.
- Keep components small and reusable.
- Avoid unnecessary dependencies.
- Avoid premature database abstractions.
- Avoid complex state management until needed.
- Do not add Microsoft Graph yet.
- Do not add email notifications yet.
- Do not add file uploads yet.
- Do not add analytics yet.

## Completion format

At the end of each task, report:

- Files changed
- Design references found
- Assumptions made
- TODOs
- Build/test result
