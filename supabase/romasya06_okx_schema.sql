-- ============================================================
-- OKX Tournaments: схема для бази romasya06 (jtskeszumqapfjhpyevq)
-- Застосувати в Supabase SQL Editor цього проєкту (НЕ продакшн!)
-- MCP-доступу до цієї бази немає, тому — руками через SQL Editor.
-- ============================================================

-- OKX-кампанії (реєстр турнірів, що трекаємо)
create table if not exists okx_campaigns (
  id             bigint generated always as identity primary key,
  slug           text not null unique,            -- cards-spot-trading-competition
  name           text not null,                   -- CARDS Spot Trading Competition
  coin_symbol    text,                            -- CARDS
  coin_amount    numeric,                          -- приз у монетах (якщо є)
  prize_pool     numeric,                          -- 500000
  prize_currency text default 'USDT',
  page_url       text,                            -- https://www.okx.com/campaigns/<slug>
  promo_item_id  uuid,                             -- джерело з promo_items (uuid!)
  event_id       uuid,                             -- id події в продакшн events_pending/approved (cross-DB ref)
  start_at       timestamptz,
  end_at         timestamptz,
  status         text not null default 'active',   -- active | ended
  watch          boolean not null default true,    -- поллити обсяг
  created_at     timestamptz not null default now()
);

-- поточний live-обсяг (оновлює headless-поллер)
create table if not exists okx_volume (
  campaign_id   bigint primary key references okx_campaigns(id) on delete cascade,
  total_volume  numeric,
  currency      text default 'USDT',
  participants  integer,
  updated_at    timestamptz not null default now()
);

-- історія обсягу (для живого графіка)
create table if not exists okx_volume_history (
  id           bigint generated always as identity primary key,
  campaign_id  bigint not null references okx_campaigns(id) on delete cascade,
  total_volume numeric,
  observed_at  timestamptz not null default now()
);
create index if not exists idx_okx_vol_hist on okx_volume_history(campaign_id, observed_at desc);

-- тарифи VIP (для калькулятора; відсотки як є: 0.0800 = 0.08%)
create table if not exists fee_tiers (
  level       text primary key,   -- Regular, VIP1..VIP6
  maker_pct   numeric not null,
  taker_pct   numeric not null,
  requirement text,
  sort_order  int not null default 0
);

-- RLS: сайт читає anon-ключем
alter table okx_campaigns       enable row level security;
alter table okx_volume          enable row level security;
alter table okx_volume_history  enable row level security;
alter table fee_tiers           enable row level security;

drop policy if exists "okx_campaigns_sel" on okx_campaigns;
drop policy if exists "okx_volume_sel"    on okx_volume;
drop policy if exists "okx_vol_hist_sel"  on okx_volume_history;
drop policy if exists "fee_tiers_sel"     on fee_tiers;

create policy "okx_campaigns_sel"  on okx_campaigns      for select using (true);
create policy "okx_volume_sel"     on okx_volume         for select using (true);
create policy "okx_vol_hist_sel"   on okx_volume_history for select using (true);
create policy "fee_tiers_sel"      on fee_tiers          for select using (true);

-- Realtime: без цього сайт не отримає live-оновлення без рефрешу
do $$ begin
  alter publication supabase_realtime add table public.okx_volume;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.okx_campaigns;
exception when duplicate_object then null; end $$;

-- сід тарифів (звірено з ботом)
insert into fee_tiers (level,maker_pct,taker_pct,requirement,sort_order) values
 ('Regular',0.0800,0.1000,'базовий',0),
 ('VIP1',0.0675,0.0800,'≥ $100k активів або ≥ $1M 30д обсягу',1),
 ('VIP2',0.0600,0.0700,'вищий поріг обсягу/активів',2),
 ('VIP3',0.0550,0.0650,'↑',3),
 ('VIP4',0.0300,0.0450,'↑',4),
 ('VIP5',0.0250,0.0350,'↑',5),
 ('VIP6',0.0000,0.0300,'maker вже 0%',6)
on conflict (level) do update set maker_pct=excluded.maker_pct, taker_pct=excluded.taker_pct, requirement=excluded.requirement;
