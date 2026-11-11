# Staff SSO configuration

## Status and production boundary

The Staff SSO administration system is implemented but must not be deployed until the production database recovery plan is approved and all repository migrations, including `20261106150000_add_staff_sso_configuration`, have been rehearsed against a protected restored production snapshot and then applied before the application deployment. No migration was applied and no KZero realm was contacted during implementation.

The feature reuses the Phase 6.5 Auth.js `kzero-staff` provider. It does not replace MSP/customer OIDC and does not create a second staff authentication system.

## Administration screen

`/admin/settings/sso` is linked from the Sales Engineer Dashboard as **Staff SSO**. It provides:

- draft configuration and masked secret status;
- local validation and trusted-host discovery testing;
- the generated Auth.js callback URI with copy control;
- approved issuer/subject identities and `ADMIN`, `SALES_ENGINEER`, and `VIEWER` roles;
- actual staff sign-in testing through Auth.js;
- guarded enable/disable controls and prerequisite status.

The page uses the existing KZero cards, controls, colors, responsive layout, and theme variables. It remains usable in an embedded dashboard, but OIDC itself should be opened at top level when third-party-cookie or frame-navigation restrictions interfere.

## Persistence and migration

The additive migration creates:

- `staff_sso_configurations`: singleton provider configuration, encrypted secret envelope, validation/test evidence, and lifecycle status;
- `staff_identities`: explicit issuer/subject authorization and application role;
- `staff_sso_audits`: attributable configuration and access-control changes;
- `StaffSsoStatus` and `StaffApplicationRole` enums.

The migration removes or rewrites no onboarding data. It must be applied before this code is deployed. Do not use `prisma db push` and do not apply it automatically to production.

## Secret encryption

Client secrets are encrypted server-side with AES-256-GCM using a fresh 96-bit IV and authentication tag for every replacement. `STAFF_SSO_ENCRYPTION_KEY` is a separately managed 32-byte deployment secret and is never stored in PostgreSQL. API responses expose only `secretConfigured`; ciphertext, IV, tag, and plaintext are never returned. Leaving the field blank preserves the stored value; entering a new value deliberately rotates it.

Back up the encryption key in the deployment owner's approved secret manager. Losing it makes the saved client secret unrecoverable. Rotate the client secret by saving the new value; coordinate encryption-key rotation through a separately reviewed re-encryption procedure.

## Initial bootstrap and recovery

Initial setup requires both:

1. the existing shared dashboard session; and
2. the independent, high-entropy `STAFF_SSO_BOOTSTRAP_SECRET`.

Successful bootstrap creates a signed, HttpOnly, Secure-in-production, SameSite=Strict cookie scoped to `/admin/settings/sso` for 15 minutes. The secret is submitted in a POST body through a server action; it is not placed in JavaScript state, a URL, a query string, an audit record, or logs. The audit actor is accurately recorded as `bootstrap:deployment-owner`, not as a person.

Enabling SSO records `bootstrapRetiredAt`. Thereafter bootstrap setup is denied unless the deployment owner deliberately sets `STAFF_SSO_EMERGENCY_RECOVERY_ENABLED=true` for a time-bounded recovery window. Retire recovery by setting it back to `false` and rotating `STAFF_SSO_BOOTSTRAP_SECRET`. The shared access code remains available for existing low-risk dashboard work but never authorizes sensitive Zoho actions.

## Authorization model

Authorization uses the tuple `(trusted issuer, immutable subject)`. Email is display metadata and never grants a role. An identity must be explicitly approved and active. The last active administrator cannot be removed. Optional signed role/group claims can act as an additional gate, but database assignment remains authoritative.

- `ADMIN`: Staff SSO configuration and existing sensitive Zoho operations after all operation-specific checks.
- `SALES_ENGINEER`: existing assigned operational work and allowed monitoring; no SSO configuration or context release.
- `VIEWER`: read-only permitted administration.

Every configuration, identity, validation, authentication-test, activation, and disable action is audited. Existing Phase 6.5 Zoho authorization continues to require a real, enabled staff session with the correct role and same-origin protection. Merely saving SSO settings does not enable Zoho dispatch.

## OIDC and Keycloak client requirements

Create the staff realm and confidential client manually in the approved KZero employee identity environment. Do not use an MSP/customer realm. Configure:

- issuer: `https://ca.auth.kzero.com/realms/{ExactCaseSensitiveRealm}`;
- Authorization Code flow enabled;
- PKCE S256 supported;
- scopes `openid email profile`;
- exact redirect URI shown by the settings page: `{application-origin}/api/auth/callback/kzero-staff`;
- exact development, preview, and production callback URIs as separate allowlisted entries;
- approved post-logout redirect URI on the same application origin;
- no wildcard redirect URIs;
- approved employee identities/groups and, if used, signed role/group claims.

Auth.js validates state, nonce, PKCE, issuer, token signature through trusted JWKS, and audience/client binding. Discovery requests are restricted to HTTPS on `ca.auth.kzero.com`, reject redirects, have an eight-second timeout and a 256 KB response limit, and require exact issuer, authorization, token, JWKS, Authorization Code, and S256 capabilities.

## Activation sequence

1. Apply all migrations to an isolated database and test there.
2. Configure the environment variables below.
3. Use shared dashboard access plus the deployment-owner bootstrap secret.
4. Save the exact realm, client, origin, logout URI, and encrypted secret.
5. Validate the draft and run Test Discovery.
6. Add the initial administrator's exact Keycloak subject as `ADMIN`.
7. Run Test Staff Sign-In in a top-level browser. A successful callback records authentication evidence but remains test-only while SSO is disabled.
8. Confirm a recovery access code remains configured.
9. Review the explicit activation prerequisites and enable Staff SSO.
10. Sign in again to obtain a normal enabled staff session, then retire bootstrap recovery configuration.

Discovery success alone never enables SSO. Unknown identities are rejected. A test-only session cannot authorize the dashboard or sensitive Zoho actions.

## Vercel environment requirements

Configure per environment, never in client-visible variables:

- `AUTH_SECRET`
- `AUTH_URL` (the exact environment origin)
- `DATABASE_URL` for the compatible environment database
- `STAFF_SSO_ENCRYPTION_KEY`
- `STAFF_SSO_BOOTSTRAP_SECRET`
- `STAFF_SSO_EMERGENCY_RECOVERY_ENABLED=false`
- transitional `ADMIN_ACCESS_CODE` during rollout

Existing `STAFF_AUTH_*` values remain an environment-based Phase 6.5 fallback only when no database configuration exists. Database configuration takes precedence after its row exists. Preview deployments must use a separate compatible staging database and their own callback URI; they must not use the production database or production client secret.

All Zoho flags remain dormant, including the global kill switch, event emission, journey triggering, automatic dispatch, production approval, and nudge evaluation controls.

## Connection and login test semantics

**Validate Configuration** checks local realm, issuer, client, origin, callback, and logout rules. **Test Discovery** performs only the bounded read-only discovery request and records sanitized endpoint/capability evidence. It does not prove user authentication. **Test Staff Sign-In** launches the real Auth.js flow and records success only after token/security validation and explicit identity approval. No real KZero login was performed during implementation because an approved staff realm/client was not configured for this task.

## Validation completed

- Prisma generation and schema validation: passed.
- TypeScript checking: passed.
- Focused Staff SSO and Phase 6.5 suites: see implementation handoff output.
- Production build and diff check: required final validation after implementation.
- Browser test: not performed; no approved live staff IdP was supplied.
- Database persistence test: not performed; the new migration has not been applied to an approved isolated database.

## Remaining production prerequisites

- complete restored-production-snapshot rehearsal and production migration approval;
- apply all required migrations before deploying application code;
- create/approve the employee staff realm and confidential client;
- configure environment-specific exact callbacks and separately managed secrets;
- perform real top-level and Zoho CRM embedded-browser login testing;
- verify ADMIN, SALES_ENGINEER, VIEWER, expiry, logout, failure, and emergency-recovery behavior;
- test persistence and secret rotation against an isolated migrated database;
- retain all Zoho external-writing controls in their disabled state.
