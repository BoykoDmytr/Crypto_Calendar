import { supabase } from './supabase';

const TOURNAMENT_SLUGS = ['binance_tournament'];
const TOURNAMENT_TYPES = ['Binance Tournaments'];

export async function fetchCompletedTournaments() {
  const now = new Date().toISOString();
  const orFilter = [
    ...TOURNAMENT_SLUGS.map((slug) => `event_type_slug.eq.${slug}`),
    ...TOURNAMENT_TYPES.map((name) => `type.eq."${name}"`),
  ].join(',');

  const { data, error } = await supabase
    .from('event_price_reaction')
    .select('*, events_approved!inner(id, title, start_at, type, event_type_slug, coin_name, timezone)')
    .lte('events_approved.start_at', now)
    .or(orFilter, { foreignTable: 'events_approved' })
    .order('t0_time', { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => {
    const event = row.events_approved || {};
    return {
      eventId: row.event_id,
      title: event.title,
      startAt: event.start_at,
      type: event.type || event.event_type_slug,
      coinName: row.coin_name || event.coin_name,
      timezone: event.timezone || 'UTC',
      pair: row.pair,
      exchange: row.exchange,
      priceReaction: [
        { label: 'T0', time: row.t0_time, price: row.t0_price, percent: row.t0_percent ?? 0 },
        { label: 'T+5m', time: row.t_plus_5_time, price: row.t_plus_5_price, percent: row.t_plus_5_percent },
        { label: 'T+15m', time: row.t_plus_15_time, price: row.t_plus_15_price, percent: row.t_plus_15_percent },
      ],
    };
  });
}