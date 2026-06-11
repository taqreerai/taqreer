# Supabase dashboard config (not managed by Prisma)

The app's tables live in the docker-compose Postgres (`prisma/`). Supabase is
auth + storage + Realtime only, so a few things have to be applied by hand in
the Supabase dashboard and are tracked here as the source of truth.

## realtime-policies.sql

Authorization policies for PRIVATE Realtime channels. Run once in the Supabase
dashboard SQL editor (Project -> SQL Editor). Idempotent.

These gate who may join `user:{id}` and `project:{id}` channels: a client may
only join topics listed in the `topics` claim of the short-lived JWT minted by
`GET /api/realtime/token` (see `lib/realtime/mint-token.ts`). The app decides
the claim server-side via the session + `resolveProjectAccess`; the policies
are a dumb claim-membership check.

Enforcement turns on only when `SUPABASE_JWT_SECRET` (the project's legacy
HS256 secret, dashboard -> JWT Keys -> Legacy JWT Secret) is set in the server
env. Unset = public channels = pre-hardening behaviour (rollout switch).

Do NOT revoke the legacy HS256 key while it is the minting secret. Pre-launch
follow-up: reassess moving to native asymmetric tokens (see the realtime memory
note) before go-live.
