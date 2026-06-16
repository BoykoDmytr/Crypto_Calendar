-- ============================================================
-- Community Claim Tracker — schema (additive, prefixed `claim_`)
-- Models the event STATE MACHINE: announced -> verified -> completed / late.
-- One claim event = one row, fed by many sources (tweet / on-chain / manual).
-- RLS: anon may SELECT (frontend); writes happen via the service-role watcher.
-- ============================================================

create table if not exists claim_tokens (
  id              bigint generated always as identity primary key,
  symbol          text not null,
  name            text not null,
  project         text,
  coingecko_slug  text,
  is_community_claim boolean not null default false,
  cadence         text,
  status          text not null default 'candidate',
  notes           text,
  created_at      timestamptz not null default now()
);
comment on column claim_tokens.is_community_claim is
  'TRUE only if end-users claim from a distributor. Vesting/insider unlocks = FALSE (excluded).';

create table if not exists claim_token_chains (
  id           bigint generated always as identity primary key,
  token_id     bigint not null references claim_tokens(id) on delete cascade,
  chain        text not null,
  token_address text,
  explorer_api text,
  is_primary   boolean not null default false,
  unique (token_id, chain)
);

create table if not exists claim_distributors (
  id            bigint generated always as identity primary key,
  token_id      bigint not null references claim_tokens(id) on delete cascade,
  chain         text not null,
  address       text not null,
  verified_name text,
  role          text,
  method_selector text,
  watch         boolean not null default true,
  unique (chain, address)
);

create table if not exists claim_events (
  id               bigint generated always as identity primary key,
  token_id         bigint not null references claim_tokens(id) on delete cascade,
  distributor_id   bigint references claim_distributors(id) on delete set null,
  label            text,
  chain            text,
  status           text not null default 'announced',
  promised_date    date,
  actual_start_utc timestamptz,
  first_tx_hash    text,
  claims_count     bigint,
  amount_pool      numeric,
  amount_claimed   numeric,
  pct_claimed      numeric,
  price_reaction_1h numeric,
  next_predicted   date,
  dedup_key        text unique,
  updated_at       timestamptz not null default now()
);

create table if not exists claim_event_sources (
  id          bigint generated always as identity primary key,
  event_id    bigint not null references claim_events(id) on delete cascade,
  source_type text not null,
  url         text,
  detail      text,
  observed_at timestamptz not null default now()
);

create index if not exists idx_events_token  on claim_events(token_id);
create index if not exists idx_events_status on claim_events(status);
create index if not exists idx_dist_watch    on claim_distributors(token_id) where watch;
create index if not exists idx_sources_event on claim_event_sources(event_id);

-- Row Level Security: anon read-only; writes via service-role (bypasses RLS).
alter table claim_tokens         enable row level security;
alter table claim_token_chains   enable row level security;
alter table claim_distributors   enable row level security;
alter table claim_events         enable row level security;
alter table claim_event_sources  enable row level security;

create policy "claim_tokens_select_anon"        on claim_tokens        for select using (true);
create policy "claim_token_chains_select_anon"  on claim_token_chains  for select using (true);
create policy "claim_distributors_select_anon"  on claim_distributors  for select using (true);
create policy "claim_events_select_anon"        on claim_events        for select using (true);
create policy "claim_event_sources_select_anon" on claim_event_sources for select using (true);
