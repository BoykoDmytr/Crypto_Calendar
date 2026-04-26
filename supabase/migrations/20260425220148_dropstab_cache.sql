-- Cache table for dropstab-circ Edge Function results.
-- Used by scripts/telegram-sync.js and src/utils/dropstabCache.js to avoid
-- hammering the Edge Function on every approval.

CREATE TABLE IF NOT EXISTS public.dropstab_cache (
  symbol         text PRIMARY KEY,
  circ_supply    numeric,
  dropstab_slug  text,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dropstab_cache_fetched_at
  ON public.dropstab_cache (fetched_at);
