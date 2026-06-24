-- =============================================================================
-- RLS lockdown
-- -----------------------------------------------------------------------------
-- Before this migration the site shipped a public anon key and gated the admin
-- panel with a client-side password only. Every privileged write (approve /
-- reject / delete / edit events, exchanges, types) ran through the anon key, so
-- the database had to allow anon writes for the panel to work — meaning anyone
-- with the (public) anon key could mutate data directly.
--
-- This migration moves the trust boundary into the database:
--   * anon (public visitors): read public data + submit pending events / edits
--     + cast reactions. Nothing else.
--   * authenticated admins (rows in public.admins): full CRUD on app tables.
--   * service_role (cron jobs, Edge Functions, server scripts): bypasses RLS by
--     design, so all background writers keep working unchanged.
--
-- Idempotent: safe to run more than once. It first drops EVERY existing policy
-- on the targeted tables (so any pre-existing permissive "allow anon all" policy
-- is removed), then recreates the intended set.
-- =============================================================================

-- 1) Admin registry + helper -------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- is_admin() runs as definer so it can read public.admins even though that table
-- is itself RLS-protected. STABLE + pinned search_path.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) Drop all existing policies on the targeted tables -----------------------
--    Guarantees a clean slate even if older permissive policies exist under
--    names we don't know.

do $$
declare
  pol   record;
  tname text;
  tbls  text[] := array[
    'events_approved', 'events_pending', 'auto_events_pending',
    'event_edits_pending', 'event_types', 'exchanges',
    'event_price_reaction', 'event_price_reaction_exclusions',
    'event_reactions', 'telegram_admin_messages', 'telegram_ingest_state',
    'dropstab_cache', 'admins'
  ];
begin
  foreach tname in array tbls loop
    if to_regclass('public.' || tname) is not null then
      for pol in
        select policyname
          from pg_policies
         where schemaname = 'public' and tablename = tname
      loop
        execute format('drop policy if exists %I on public.%I', pol.policyname, tname);
      end loop;
    end if;
  end loop;
end$$;

-- 3) Enable RLS on every targeted table --------------------------------------

alter table if exists public.events_approved                enable row level security;
alter table if exists public.events_pending                 enable row level security;
alter table if exists public.auto_events_pending            enable row level security;
alter table if exists public.event_edits_pending            enable row level security;
alter table if exists public.event_types                    enable row level security;
alter table if exists public.exchanges                      enable row level security;
alter table if exists public.event_price_reaction           enable row level security;
alter table if exists public.event_price_reaction_exclusions enable row level security;
alter table if exists public.event_reactions                enable row level security;
alter table if exists public.telegram_admin_messages        enable row level security;
alter table if exists public.telegram_ingest_state          enable row level security;
alter table if exists public.dropstab_cache                 enable row level security;
alter table if exists public.admins                         enable row level security;

-- 4) admins: a user may read only their own row ------------------------------

create policy admins_self_select on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- 5) Public-read tables: anyone reads, only admins write ---------------------
--    events_approved / event_types / exchanges /
--    event_price_reaction / event_price_reaction_exclusions

create policy events_approved_public_read on public.events_approved
  for select to anon, authenticated using (true);
create policy events_approved_admin_write on public.events_approved
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy event_types_public_read on public.event_types
  for select to anon, authenticated using (true);
create policy event_types_admin_write on public.event_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy exchanges_public_read on public.exchanges
  for select to anon, authenticated using (true);
create policy exchanges_admin_write on public.exchanges
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy epr_public_read on public.event_price_reaction
  for select to anon, authenticated using (true);
create policy epr_admin_write on public.event_price_reaction
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy epr_excl_public_read on public.event_price_reaction_exclusions
  for select to anon, authenticated using (true);
create policy epr_excl_admin_write on public.event_price_reaction_exclusions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 6) Submission tables: anon may INSERT only; admins manage ------------------
--    events_pending (Add event) / event_edits_pending (Suggest edit).
--    No anon SELECT — pending rows (and submitter emails) stay private.

create policy events_pending_public_insert on public.events_pending
  for insert to anon, authenticated with check (true);
create policy events_pending_admin_all on public.events_pending
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy event_edits_public_insert on public.event_edits_pending
  for insert to anon, authenticated with check (true);
create policy event_edits_admin_all on public.event_edits_pending
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 7) Admin-only table (no public access at all) ------------------------------
--    auto_events_pending is filled by the scraper (service_role, bypasses RLS)
--    and managed from the admin panel.

create policy auto_events_pending_admin_all on public.auto_events_pending
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 8) Reactions: anonymous voting (client-supplied anon_id) --------------------
--    NOTE: anon_id is generated in the browser and is not a verified identity,
--    so this remains "anyone can toggle a reaction" by design. RLS cannot bind
--    these rows to a real user. Kept permissive to preserve the feature; counts
--    are non-sensitive. Tighten later with a server-issued identity / rate limit
--    if abuse becomes a problem.

create policy event_reactions_public_read on public.event_reactions
  for select to anon, authenticated using (true);
create policy event_reactions_public_insert on public.event_reactions
  for insert to anon, authenticated with check (true);
create policy event_reactions_public_update on public.event_reactions
  for update to anon, authenticated using (true) with check (true);
create policy event_reactions_public_delete on public.event_reactions
  for delete to anon, authenticated using (true);
create policy event_reactions_admin_all on public.event_reactions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 9) Service-role-only tables -------------------------------------------------
--    RLS is enabled with NO client policy, so anon/authenticated get nothing.
--    The cron jobs / Edge Functions use the service-role key, which bypasses RLS.
--      * telegram_admin_messages
--      * telegram_ingest_state
--      * dropstab_cache
--    (no policies created intentionally)
