// src/hooks/useEventReaction.js
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getAnonId } from '../utils/anon';

export function useEventReaction(eventId) {
  const [counts, setCounts] = useState({ like: 0, dislike: 0 });
  const [userReaction, setUserReaction] = useState(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const anon = getAnonId();
    async function load() {
      // реакція поточного користувача
      const { data: selfData, error: selfError } = await supabase
        .from('event_reactions')
        .select('reaction')
        .eq('event_id', eventId)
        .eq('anon_id', anon)
        .maybeSingle();
      if (!cancelled) {
        setUserReaction(selfError ? null : selfData?.reaction ?? null);
      }
      // агрегація лічильників
      const { data: aggData } = await supabase
        .from('event_reactions')
        .select('reaction, count')
        .eq('event_id', eventId)
        .group('reaction');
      if (!cancelled) {
        const next = { like: 0, dislike: 0 };
        (aggData || []).forEach((row) => {
          if (row.reaction === 'like') next.like = row.count;
          if (row.reaction === 'dislike') next.dislike = row.count;
        });
        setCounts(next);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [eventId]);

  const updateReaction = useCallback(async (reactionType) => {
    if (!eventId) return;
    const anon = getAnonId();
    // якщо користувач повторно натиснув ту ж кнопку — видаляємо реакцію
    if (userReaction === reactionType) {
      await supabase
        .from('event_reactions')
        .delete()
        .eq('event_id', eventId)
        .eq('anon_id', anon);
      setUserReaction(null);
    } else {
      // upsert за унікальним ключем (event_id, anon_id)
      await supabase
        .from('event_reactions')
        .upsert({ event_id: eventId, anon_id: anon, reaction: reactionType },
                { onConflict: 'event_id, anon_id' });
      setUserReaction(reactionType);
    }
    // перерахунок лічильників
    const { data: aggData } = await supabase
      .from('event_reactions')
      .select('reaction, count')
      .eq('event_id', eventId)
      .group('reaction');
    const next = { like: 0, dislike: 0 };
    (aggData || []).forEach((row) => {
      if (row.reaction === 'like') next.like = row.count;
      if (row.reaction === 'dislike') next.dislike = row.count;
    });
    setCounts(next);
  }, [eventId, userReaction]);

  return { counts, userReaction, updateReaction };
}
