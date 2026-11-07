# Sports School Licensing API

NestJS + TypeORM API backed by MySQL. It stores license administration data only;
the school's local SQLite data is never uploaded.

Supported license types:

- `SUBSCRIPTION`: monthly renewal, 10-day grace, and signed offline grants capped
  at 30 days and the commercial grace end.
- `PERPETUAL`: one-time payment and no JWS time expiry. An offline device cannot
  receive later server suspension or revocation until it reconnects.

Product updates are separate manual sales. This API does not manage update
entitlements or in-app purchases.

## Safety status

- This backend is under development and is not production-ready.
- TypeORM `synchronize` and automatic migration execution are disabled.
- The MySQL migration is not applied. Do not run `npm run migration:run` until
  the complete DDL has been reviewed and explicitly authorized.
- Do not run any administrator bootstrap or data-writing script without
  reviewing the exact SQL and target database first.
- Never commit `.env`, private signing keys, activation codes, or access tokens.

## Setup

Use Node.js 20.11 or newer. Copy `.env.example` to `.env` and configure MySQL,
the admin JWT secret, allowed origins, and an Ed25519 PKCS#8 private key encoded
as base64 in `LICENSE_SIGNING_PRIVATE_KEY_BASE64`.

`npm run build` compiles the NestJS API. `npm test` runs unit tests. Database
migrations are explicit; application startup never alters the schema.
