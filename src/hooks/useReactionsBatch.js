// src/hooks/useReactionsBatch.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAnonId } from '../utils/anon';

/**
 * Batch-fetch reactions for many events in a single round-trip via the
 * `get_event_reactions_batch` RPC. Replaces 3 queries per EventCard.
 *
 * Returns:
 *   reactionsMap : Map<eventId, { likes, dislikes, myReaction }>
 *   refresh      : () => Promise<void>
 */
export function useReactionsBatch(eventIds) {
  const stableIds = useMemo(() => {
    if (!Array.isArray(eventIds)) return [];
    const filtered = eventIds.filter(Boolean);
    return Array.from(new Set(filtered)).sort();
  }, [eventIds]);

  const idsKey = stableIds.join(',');
  const idsRef = useRef(stableIds);
  idsRef.current = stableIds;

  const [reactionsMap, setReactionsMap] = useState(() => new Map());

  const refresh = useCallback(async () => {
    const ids = idsRef.current;
    if (!ids.length) {
      setReactionsMap(new Map());
      return;
    }

    const anon = getAnonId();
    const { data, error } = await supabase.rpc('get_event_reactions_batch', {
      p_event_ids: ids,
      p_anon_id: anon,
    });

    if (error) {
      console.error('[useReactionsBatch] rpc failed', error);
      return;
    }

    const next = new Map();
    for (const row of data || []) {
      next.set(row.event_id, {
        likes: row.likes ?? 0,
        dislikes: row.dislikes ?? 0,
        myReaction: row.my_reaction ?? null,
      });
    }
    setReactionsMap(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [idsKey, refresh]);

  const onReact = useCallback(
    async (eventId, reactionType) => {
      if (!eventId || !reactionType) return;
      const anon = getAnonId();
      const current = reactionsMap.get(eventId);
      const wasMine = current?.myReaction === reactionType;

      // Optimistic update
      const optimistic = new Map(reactionsMap);
      const base = current ?? { likes: 0, dislikes: 0, myReaction: null };
      const nextEntry = { ...base };

      // Roll back the previous reaction's count
      if (base.myReaction === 'like') nextEntry.likes = Math.max(0, nextEntry.likes - 1);
      if (base.myReaction === 'dislike') nextEntry.dislikes = Math.max(0, nextEntry.dislikes - 1);

      if (wasMine) {
        nextEntry.myReaction = null;
      } else {
        nextEntry.myReaction = reactionType;
        if (reactionType === 'like') nextEntry.likes += 1;
        else if (reactionType === 'dislike') nextEntry.dislikes += 1;
      }
      optimistic.set(eventId, nextEntry);
      setReactionsMap(optimistic);

      try {
        if (wasMine) {
          const { error } = await supabase
            .from('event_reactions')
            .delete()
            .eq('event_id', eventId)
            .eq('anon_id', anon);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('event_reactions')
            .upsert(
              { event_id: eventId, anon_id: anon, reaction: reactionType },
              { onConflict: 'event_id,anon_id' },
            );
          if (error) throw error;
        }
        // Re-sync from server to keep counts authoritative
        await refresh();
      } catch (err) {
        console.error('[useReactionsBatch] reaction write failed', err);
        // revert optimistic update
        const reverted = new Map(reactionsMap);
        if (current) reverted.set(eventId, current);
        else reverted.delete(eventId);
        setReactionsMap(reverted);
      }
    },
    [reactionsMap, refresh],
  );

  return { reactionsMap, refresh, onReact };
}
