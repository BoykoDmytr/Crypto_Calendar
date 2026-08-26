-- Автопідхоплення трекінгу: картка на сайті сама описує, ЯК її рахувати.
-- Колектор читає цей опис і вмикає збір без ручного налаштування.
alter table public.site_creator_campaigns
  add column if not exists track_source text,      -- binance-square | bitget-insights | x | null
  add column if not exists track_config jsonb not null default '{}'::jsonb,
  add column if not exists track_enabled boolean not null default true,
  add column if not exists track_note text;        -- чому не трекається (чесність в адмінці)

create index if not exists scc_track_idx
  on public.site_creator_campaigns (track_source, track_enabled)
  where track_source is not null;
