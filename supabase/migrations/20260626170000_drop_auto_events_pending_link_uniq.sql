-- A single source link can legitimately back several auto-events: one Binance
-- announcement contains multiple tournament periods (1st, 2nd, ...), and we
-- create one event per period — all sharing the same announcement link. The
-- global UNIQUE(link) index rejected every period after the first.
--
-- Dedup is already enforced by:
--   * auto_events_pending_dedupe_idx        (lower(title), start_at, link)
--   * auto_events_pending_source_key_unique (source, source_key)
-- and events_approved has no link-uniqueness, so this index is redundant.
drop index if exists public.auto_events_pending_link_uniq;
