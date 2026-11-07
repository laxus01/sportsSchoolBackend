# Sports School Licensing API

Independent Node.js + Express API for license administration and signed offline
authorizations. PostgreSQL is used for server-side license metadata only; the
school's SQLite data is never uploaded.

The API supports monthly subscriptions and one-time perpetual licenses. A
perpetual JWS intentionally has no `exp` claim and remains usable offline after
activation; a suspension or revocation reaches that device only when it
reconnects. Product updates are sold separately and are not handled as in-app
transactions or entitlements by this API.

## Safety status

- The API is under development and is not production-ready.
- No database is created, migrated, seeded, or contacted by these files.
- `npm run db:migrate` applies DDL and must not be run without reviewing and
  explicitly authorizing the exact migration SQL.
- `npm run admin:create` inserts an administrative user and must only be run
  against an explicitly selected database after reviewing the command and data.
- Never commit `.env`, private signing keys, activation codes, or access tokens.

## Setup

Use Node.js 22.9 or newer. Copy `.env.example` to `.env`, fill in local values,
and install dependencies from this directory. Generate the Ed25519 private key
outside the repository and provide its PKCS#8 PEM bytes as base64 in
`LICENSE_SIGNING_PRIVATE_KEY_BASE64`. The corresponding public key is embedded
in the mobile app during a separate release.

The API does not run migrations on startup. Review `migrations/` and obtain
authorization before applying them to any database.

## Routes

The implementation exposes health checks, one-time device challenges,
installation activation and refresh, plus authenticated administration routes.
Admin bootstrap, activation-code issuance, payments, suspension, and audit
events are documented alongside their route handlers.
