-- `tg_dirty = true` flags rows where the Telegram broadcast content is stale
-- relative to the DB row. The broadcast cron's edit phase picks these up,
-- calls editMessageText, and clears the flag on success.

ALTER TABLE public.events_approved
  ADD COLUMN IF NOT EXISTS tg_dirty boolean NOT NULL DEFAULT false;

-- Partial index — only dirty rows are scanned by the edit phase. Small and
-- cheap to maintain because the population is bounded by the edit rate.
CREATE INDEX IF NOT EXISTS idx_events_approved_tg_dirty
  ON public.events_approved (tg_posted_at)
  WHERE tg_dirty = true AND tg_message_id IS NOT NULL;
