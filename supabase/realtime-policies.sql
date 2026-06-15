-- Supabase Realtime authorization policies for Taqreer's private channels.
-- Run ONCE in the Supabase dashboard SQL editor (the HOSTED project the
-- app's NEXT_PUBLIC_SUPABASE_URL points at - NOT the local docker DB).
--
-- Model: the app server mints a short-lived JWT (HS256, the project's
-- legacy JWT secret) whose `topics` claim lists exactly the channel
-- topics this browser may use: its own `user:{supabaseUserId}` plus any
-- `project:{id}` that lib/api/project-access grants. These policies are
-- a dumb membership check against that claim - ALL access logic stays
-- in app code (the app's data lives in its own Postgres, which this
-- Supabase project cannot see).
--
-- Clients may RECEIVE broadcast + presence on claimed topics, and may
-- SEND presence only (collaboration presence tracking). Clients never
-- legitimately send broadcasts - the server emits those with the
-- service-role key, which bypasses these policies - so client
-- broadcast-sends stay denied, closing the event-spoofing hole that
-- public channels had.
--
-- `auth.jwt()` is wrapped in `(select auth.jwt())` so Postgres evaluates it
-- ONCE per query (an InitPlan) instead of once per row (Supabase RLS perf
-- advisor "Auth RLS Initialization Plan"). Same authorization result.
--
-- Idempotent: safe to re-run.

drop policy if exists "taqreer receive on claimed topics" on realtime.messages;
create policy "taqreer receive on claimed topics"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and realtime.topic() in (
    select jsonb_array_elements_text((select auth.jwt()) -> 'topics')
  )
);

drop policy if exists "taqreer presence send on claimed topics" on realtime.messages;
create policy "taqreer presence send on claimed topics"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and realtime.topic() in (
    select jsonb_array_elements_text((select auth.jwt()) -> 'topics')
  )
);
