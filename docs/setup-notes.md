# Setup Notes

## Database

- Set `DATABASE_URL` to your Postgres connection string.
- This app now includes a Prisma schema in `prisma/schema.prisma`.
- Run Prisma migrations and client generation before using server-side MSP persistence in a real environment.

## OIDC Secret Encryption

- Set `OIDC_SECRET_ENCRYPTION_KEY` to a 32-byte key.
- The server accepts a 32-byte base64, hex, or raw value.
- MSP OIDC client secrets are encrypted server-side before storage.
- Production secrets must stay server-side and must never be returned to browser code or localStorage.

## KZero OIDC

- `KZERO_OIDC_BASE_URL=https://ca.auth.kzero.com`
- `KZERO_OIDC_REDIRECT_URI=https://onboarding-portal20.vercel.app/api/oidc/callback`
- KZero tenant realms are case-sensitive and must be stored exactly as configured in KZero.
