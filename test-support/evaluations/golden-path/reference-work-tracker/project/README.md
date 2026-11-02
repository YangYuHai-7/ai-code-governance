# Reference work tracker

Synthetic full-stack workload used only by the AICG golden path evaluation. It is never copied
into generated user projects.

## Local startup

1. `npm ci` (exact evaluated versions only; the lockfile is part of the evaluation evidence).
2. Start PostgreSQL 18.6 and export `DATABASE_URL`.
3. `npm run test:migration` to apply `migrations/0001_init.sql`.
   Run `node scripts/seed-local.mjs` to populate the synthetic board and work item.
4. Provision an existing synthetic member session on the server, for example:
   `export TRACKER_SESSIONS='{"local-evaluation-token":{"organizationId":"11111111-1111-1111-1111-111111111111","actorId":"member-synthetic-1","expiresAt":"2027-01-01T00:00:00Z"}}'`.
   Replace the example token and expiration for each evaluation. Missing, unknown, and expired
   bearer tokens receive 401. Membership and audit identity come from this server-owned session;
   client-supplied actor identity is ignored. A mismatching tenant hint receives 404.
5. Export `VITE_SESSION_TOKEN` and `AICG_LIVE_SESSION_TOKEN` with that token. The browser token
   is a synthetic evaluation credential; session issuance and external identity are outside this
   active-session fixture. Build with `npm run build` before starting the API.
6. Run `PORT=3103 npm run start:local` and, in another terminal,
   `npm exec vite -- --host 127.0.0.1`. Open `http://127.0.0.1:5173`.
7. For browser checks, run `npm exec vite -- preview --host 127.0.0.1`, then `npm run test:e2e`.

The authenticated API accepts `PATCH /work-items/:itemId` with `boardId`, a supported `state`,
and a positive integer `expectedVersion`. Item and board identifiers are UUIDs. Work-item pages
accept a UUID cursor and an integer limit of 1–100 (default 20). Errors use an `error` field;
missing records return 404 and stale versions or invalid transitions return 409.

Set `WORK_TRACKER_ENABLED=false` and restart to disable the board and work-item routes (503),
leaving `/health` available. If the error budget is exceeded, disable the flag, stop the API, and
apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_rollback.sql` before restoring
the previous application version. This restores the prior deletion constraints without dropping
retained records. The initial migration upgrades existing constraints transactionally; organization
deletion cascades to boards, work items, and audit entries. Deleted data cannot be restored by a
schema rollback. The operator must define the error budget for the evaluation workload.

All records and identities are synthetic. External identity, payment, email, cloud deployment,
and production provisioning are out of scope.
