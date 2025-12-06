// src/hooks/useEventPriceReaction.js
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function useEventPriceReaction(eventId) {
  const [price, setPrice] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!eventId) return;

    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('event_price_reaction')
        .select('t0_price')
        .eq('event_id', eventId)
        .maybeSingle();

      if (isCancelled) return;

      if (error) {
        console.error('[useEventPriceReaction] error', error);
        setError(error);
        setPrice(null);
      } else {
        setPrice(data?.t0_price ?? null);
      }

      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [eventId]);

  return { price, isLoading, error };
}
