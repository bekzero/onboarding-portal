# Phase 6.5 — Individually attributable staff identity

Phase 6.5 adds a fail-closed staff authentication and role-authorization foundation without replacing the transitional shared admin access code or changing MSP/customer authentication. Zoho sending, dispatch, journeys, nudges, and cron remain disabled.

## 1. Authentication architecture

Staff authentication uses a dedicated Auth.js Keycloak/OIDC provider named `kzero-staff`. It is separate from:

- tenant-specific MSP/customer OIDC under `/api/oidc/*`;
- the existing generic `AUTH_KEYCLOAK_*` provider;
- the shared admin access-code cookie.

The provider is registered only when the dedicated staff issuer, client ID, and client secret are present. Auth.js performs Authorization Code flow with PKCE, state, and nonce checks and validates issuer, ID-token signature through OIDC discovery/JWKS, and client/audience through the configured OIDC client. The application uses an encrypted, HttpOnly Auth.js JWT session with an eight-hour maximum age and 15-minute update interval. Access and refresh tokens are not copied into the browser session or local storage.

The application retains only the trusted issuer, immutable subject, verified-email flag, display fields, and normalized signed role claims needed for authorization. Every request recomputes the application role from current server configuration, so changing a role mapping takes effect without trusting a role entered by the browser.

## 2. Staff IdP configuration requirements

Required server-only variables:

```text
AUTH_SECRET=<strong random value>
AUTH_URL=<canonical portal URL>
STAFF_AUTH_ISSUER=<approved KZero employee issuer>
STAFF_AUTH_CLIENT_ID=<dedicated confidential client>
STAFF_AUTH_CLIENT_SECRET=<server-only secret>
STAFF_AUTH_ADMIN_ROLE=<approved application role claim>
STAFF_AUTH_SALES_ENGINEER_ROLE=<approved application role claim>
STAFF_AUTH_VIEWER_ROLE=<approved application role claim>
STAFF_AUTH_ALLOWED_SUBJECTS=<optional comma-separated immutable subjects>
```

At least one application-role mapping is required before the staff configuration is considered usable. The issuer must be a verified KZero employee identity realm/tenant; it must not be an MSP or customer realm. Redirect URIs must include the Auth.js callback for the deployed canonical domain. The identity team must configure protocol mappers so the approved role appears in a signed realm role, the configured staff-client resource role, groups, or the approved organization-role claim.

Email domain is not authorization. A signed identity without an approved application role is rejected. `STAFF_AUTH_ALLOWED_SUBJECTS`, when configured, is an additional exact immutable-subject allowlist—not an email allowlist.

No approved staff issuer or client values were available in the repository, so placeholders remain blank and no real login was attempted.

## 3. Files changed

- `auth.ts`: dedicated staff provider, protocol checks, role-gated sign-in, bounded session, safe staff session fields.
- `lib/staff-authorization-core.ts`: pure claim parsing, issuer/subject/role policy, role hierarchy.
- `lib/staff-auth.ts`: server-side session resolution, configuration detection, audit actor, same-origin validation.
- `lib/admin-auth.ts`: shared-or-staff read access, staff RBAC, sensitive ADMIN authorization, attributable actor.
- `types/next-auth.d.ts`: safe staff identity session fields.
- `app/admin/staff-login/page.tsx` and `app/admin/staff/actions.ts`: staff sign-in/logout.
- `components/staff-identity-control.tsx`: identity, role, sign-in and logout display.
- admin dashboard and Zoho center pages/components: accept staff sessions and display identity.
- administrative API routes: minimum staff roles on mutations and stronger sensitive Zoho checks.
- `.env.example`: blank staff IdP and role configuration.
- `tests/zoho-phase-6-5.test.mjs`: focused authentication/authorization tests.

## 4. Roles and permissions

Role hierarchy is `ADMIN > SALES_ENGINEER > VIEWER`.

| Role | Permissions |
|---|---|
| `VIEWER` | Authenticated read-only dashboard, automation history, reminder preview, configuration and readiness views. |
| `SALES_ENGINEER` | Viewer permissions plus established case/contact/notification/kickoff/task operations that are part of Sales Engineer work. |
| `ADMIN` | Sales Engineer permissions plus destructive administrative configuration and sensitive Zoho authorization. |

Server routes enforce roles. Hiding or disabling a button is not treated as authorization. Existing write routes now declare `SALES_ENGINEER` or `ADMIN` for staff sessions. The transitional shared session retains its previously permitted non-sensitive behavior to avoid an unapproved lockout migration.

## 5. Shared access-code compatibility

The existing shared access-code login and cookie remain available. It can still open the dashboard and perform operations that were already permitted before Phase 6.5. It does not create an individual identity, does not receive a staff role, and cannot pass `getSensitiveAdminApiAuthError`.

No existing admin login was removed. Staff can choose `Sign in with KZero Staff Identity`; transitional access remains clearly labelled. This is a migration bridge, not a substitute for completing staff IdP setup.

## 6. Audit identity behavior

Sensitive operations use an actor derived only from the validated staff session:

```text
oidc:<issuer>|sub:<immutable subject>|email:<verified email or unavailable>|role:<application role>
```

The existing audit row supplies action and timestamp; evidence/reason remains operation-specific. An unverified email is never presented as verified identity evidence. Historical `admin-session` audit rows remain unchanged.

## 7. Sensitive actions

The following existing operations now require individual `ADMIN` authorization, verified same-origin POST, and—where they write an audit—an attributable actor:

- manual subscription verification;
- uncertain journey-trigger reconciliation/cancellation;
- allowlisted test-contact write;
- isolated test-plan activation;
- manual test dispatch.

Phase 6 context assignment/release, historical enrollment, general event cancellation/requeue, and bulk operational controls were UI previews without completed transactional workflows. Phase 6.5 authorizes their boundary but deliberately returns `501 SENSITIVE_WORKFLOW_NOT_IMPLEMENTED` after successful ADMIN authorization. They remain disabled in the UI until their readiness, stop-state, context, and audit rules are implemented. Identity alone never bypasses subscription, context ownership, uncertainty, or historical safeguards.

## 8. Security and tests

The focused suite covers:

- ADMIN, SALES_ENGINEER and VIEWER role resolution;
- untrusted issuer, missing role, missing subject and subject-allowlist rejection;
- staff-client resource-role isolation;
- explicit PKCE/state/nonce configuration;
- bounded sessions and absence of tokens/secrets from browser session types;
- shared-session rejection for sensitive operations;
- ADMIN, same-origin and attributable-actor requirements;
- server-side write-route role declarations;
- branded sign-in, identity/role display and logout;
- fail-closed blank IdP configuration.

Invalid token signature, incorrect audience, state, nonce and expiry are delegated to Auth.js/OpenID discovery validation and are configured explicitly in code. A real rejection test requires a controlled staff IdP or a full mocked OIDC server; none was available. No real OIDC login or Zoho request was performed.

## 9. Zoho CRM embedded Web Tab

The implementation does not weaken SameSite/Secure behavior to make third-party iframe cookies work. Browsers may block the Auth.js session cookie in the Zoho CRM iframe. The existing embedded-session screen explains the limitation and opens `/admin` in a top-level tab, where staff can sign in and return to the authorized dashboard. Top-level session continuity, expiry and role enforcement must be tested against the approved production issuer and target browsers before launch.

## 10. Remaining production requirements

1. Approve and configure the KZero employee issuer, confidential client, redirect URIs and role mappers.
2. Decide whether immutable-subject allowlisting is mandatory and establish its owner/update procedure.
3. Test real login, logout, expired sessions, revoked roles, invalid audience/signature, and Keycloak key rotation.
4. Test top-level and Zoho CRM Web Tab behavior in supported browsers without relaxing cookie security.
5. Implement and review the still-disabled context, enrollment, event-cancellation and requeue workflows.
6. Add operational access-review and staff offboarding procedures.
7. Keep all Zoho production flags and cron disabled until the separate launch approval.

No schema migration, production migration, deployment, cron change, email, or Zoho journey activation is part of Phase 6.5.
