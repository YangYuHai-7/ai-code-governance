# Reference work tracker

Synthetic full-stack workload used only by the AICG golden path evaluation. It is never copied
into generated user projects.

## Local startup

1. `npm ci` (exact evaluated versions only; the lockfile is part of the evaluation evidence).
2. Start PostgreSQL 18.6 and export `DATABASE_URL`.
3. `npm run test:migration` to apply `migrations/0001_init.sql`.
4. `npm run start:local` and open the printed web URL.
5. `npm run build` then `npm run test:e2e` for the browser flow.

All records and identities are synthetic. External identity, payment, email, cloud deployment,
and production provisioning are out of scope.
