-- Optimise Disk IO: hot-path indexes, ON DELETE CASCADE for child tables,
-- and a batch RPC that replaces 3-queries-per-card on Calendar.

-- 1) Missing hot-path indexes
CREATE INDEX IF NOT EXISTS idx_epr_t0_time
  ON public.event_price_reaction (t0_time);

CREATE INDEX IF NOT EXISTS idx_epr_event_t0
  ON public.event_price_reaction (event_id, t0_time);

CREATE INDEX IF NOT EXISTS idx_event_edits_event_id
  ON public.event_edits_pending (event_id);

CREATE INDEX IF NOT EXISTS idx_event_reactions_event_reaction
  ON public.event_reactions (event_id, reaction);

-- 2) Convert FKs to ON DELETE CASCADE so /api/cron/delete-old-events
--    becomes ONE delete instead of N×4. Drop and recreate.
ALTER TABLE public.event_price_reaction
  DROP CONSTRAINT IF EXISTS event_price_reaction_event_id_fkey;
ALTER TABLE public.event_price_reaction
  ADD  CONSTRAINT event_price_reaction_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events_approved(id) ON DELETE CASCADE;

ALTER TABLE public.event_price_reaction_exclusions
  DROP CONSTRAINT IF EXISTS event_price_reaction_exclusions_event_id_fkey;
ALTER TABLE public.event_price_reaction_exclusions
  ADD  CONSTRAINT event_price_reaction_exclusions_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events_approved(id) ON DELETE CASCADE;

ALTER TABLE public.event_edits_pending
  DROP CONSTRAINT IF EXISTS event_edits_pending_event_id_fkey;
ALTER TABLE public.event_edits_pending
  ADD  CONSTRAINT event_edits_pending_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events_approved(id) ON DELETE CASCADE;

-- 3) Batch RPC for event reactions — replaces 3 queries per card
--    Returns counts + the current user's reaction in one round-trip
CREATE OR REPLACE FUNCTION public.get_event_reactions_batch(
  p_event_ids uuid[],
  p_anon_id   uuid
) RETURNS TABLE (
  event_id    uuid,
  likes       integer,
  dislikes    integer,
  my_reaction text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id AS event_id,
    COALESCE(COUNT(*) FILTER (WHERE r.reaction = 'like'),    0)::int AS likes,
    COALESCE(COUNT(*) FILTER (WHERE r.reaction = 'dislike'), 0)::int AS dislikes,
    MAX(CASE WHEN r.anon_id = p_anon_id THEN r.reaction END) AS my_reaction
  FROM unnest(p_event_ids) AS e(id)
  LEFT JOIN public.event_reactions r ON r.event_id = e.id
  GROUP BY e.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_reactions_batch(uuid[], uuid) TO anon, authenticated;
