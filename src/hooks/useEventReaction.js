// src/hooks/useEventReaction.js
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getAnonId } from '../utils/anon';

export function useEventReaction(eventId) {
  const [counts, setCounts] = useState({ like: 0, dislike: 0 });
  const [userReaction, setUserReaction] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!eventId) return;

    setLoading(true);
    const anon = getAnonId();

    // 1) реакція поточного користувача
    const { data: selfData } = await supabase
      .from('event_reactions')
      .select('reaction')
      .eq('event_id', eventId)
      .eq('anon_id', anon)
      .maybeSingle();

    setUserReaction(selfData?.reaction ?? null);

    // 2) лічильники (2 запити, зате завжди коректно)
    const [{ count: likeCount }, { count: dislikeCount }] = await Promise.all([
      supabase
        .from('event_reactions')
        .select('*', { head: true, count: 'exact' })
        .eq('event_id', eventId)
        .eq('reaction', 'like'),
      supabase
        .from('event_reactions')
        .select('*', { head: true, count: 'exact' })
        .eq('event_id', eventId)
        .eq('reaction', 'dislike'),
    ]).then((res) => res.map((r) => r));

    setCounts({
      like: likeCount ?? 0,
      dislike: dislikeCount ?? 0,
    });

    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateReaction = useCallback(
    async (reactionType) => {
      if (!eventId) return;

      const anon = getAnonId();

      // toggle: якщо клік по тій самій реакції — видаляємо
      if (userReaction === reactionType) {
        await supabase
          .from('event_reactions')
          .delete()
          .eq('event_id', eventId)
          .eq('anon_id', anon);

        setUserReaction(null);
      } else {
        // upsert по унікальному ключу
        await supabase
          .from('event_reactions')
          .upsert(
            { event_id: eventId, anon_id: anon, reaction: reactionType },
            { onConflict: 'event_id,anon_id' } // важливо: без пробілу
          );

        setUserReaction(reactionType);
      }

      // після зміни — перерахунок лічильників
      await refresh();
    },
    [eventId, userReaction, refresh]
  );

  return { counts, userReaction, updateReaction, loading, refresh };
}
