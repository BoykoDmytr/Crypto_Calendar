-- Таблиця для заявок (поки не схвалені)
create table if not exists public.events_pending (
id uuid primary key default gen_random_uuid(),
title text not null,
description text,
start_at timestamptz not null,
end_at timestamptz,
timezone text default 'UTC',
type text check (type in ('TGE','Listing','Airdrop','Product','AMA','Mainnet','Other')) default 'Other',
location text,
link text,
submitter_email text,
admin_comment text,
status text check (status in ('pending','rejected')) default 'pending',
created_at timestamptz default now()
);


-- Таблиця для схвалених подій
create table if not exists public.events_approved (
id uuid primary key default gen_random_uuid(),
title text not null,
description text,
start_at timestamptz not null,
end_at timestamptz,
timezone text default 'UTC',
type text check (type in ('TGE','Listing','Airdrop','Product','AMA','Mainnet','Other')) default 'Other',
location text,
link text,
created_at timestamptz default now()
);


-- ❗ Для MVP: залиште RLS ВИМКНЕНОЮ на обох таблицях.
-- У Supabase: Table editor → таблиця → вимкнути "Enable RLS".