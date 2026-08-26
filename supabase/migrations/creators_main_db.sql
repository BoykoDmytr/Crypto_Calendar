-- Перенос вкладки /creators у ОСНОВНУ базу сайту (bnidayqhxpievwcnugnl).
-- Після цього секція «Креатор-кампанії» в /admin працює під ЗВИЧАЙНИМ логіном адмінки,
-- без окремого пароля.
--
-- Виконати в Supabase SQL Editor проєкту календаря (акаунт dimaboyko).

create table if not exists public.site_creator_campaigns (
  id uuid primary key default gen_random_uuid(),
  promo_item_id uuid,                 -- id у promo_items бази бота (для трасування)
  cp_campaign_id bigint,              -- id кампанії в трекері постів (без FK: інша база)
  exchange text not null,
  platform text,
  title text not null,
  subtitle text,
  steps jsonb not null default '[]'::jsonb,
  reward text,
  reward_class text not null default 'unclear',   -- real | locked | near_zero | unclear
  slots int,
  url text,
  hashtags jsonb not null default '[]'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft',           -- draft | published | archived
  sort_order int not null default 0,
  -- лічильники пише колектор (інша база, тому не view, а звичайні колонки)
  posts_observed int,
  unique_authors int,
  posts_last_60_min int,
  stats_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scc_status_idx on public.site_creator_campaigns (status, ends_at);

alter table public.site_creator_campaigns enable row level security;

-- Анонім бачить лише опубліковані картки
drop policy if exists scc_anon_read on public.site_creator_campaigns;
create policy scc_anon_read on public.site_creator_campaigns
  for select to anon using (status = 'published');

-- Залогінений адміністратор сайту бачить і редагує все
drop policy if exists scc_auth_read on public.site_creator_campaigns;
create policy scc_auth_read on public.site_creator_campaigns
  for select to authenticated using (true);

drop policy if exists scc_auth_write on public.site_creator_campaigns;
create policy scc_auth_write on public.site_creator_campaigns
  for update to authenticated using (true) with check (true);

drop policy if exists scc_auth_delete on public.site_creator_campaigns;
create policy scc_auth_delete on public.site_creator_campaigns
  for delete to authenticated using (true);
