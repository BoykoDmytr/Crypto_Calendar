import { supabase } from './supabase';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

const TOURNAMENT_SLUGS = ['binance_tournament', 'ts_bybit'];
const TOURNAMENT_TYPES = ['Binance Tournaments', 'TS Bybit'];

dayjs.extend(utc);

export async function fetchCompletedTournaments() {
  const now = new Date().toISOString();
  const orFilter = [
    ...TOURNAMENT_SLUGS.map((slug) => `event_type_slug.eq.${slug}`),
    ...TOURNAMENT_TYPES.map((name) => `type.eq."${name}"`),
  ].join(',');

  const { data, error } = await supabase
    .from('event_price_reaction')
    .select(
      '*, events_approved!event_price_reaction_event_id_fkey(id, title, start_at, type, event_type_slug, coin_name, timezone)'
    )
    .lte('t0_time', now)
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

const DEBOT_BASE_URL = import.meta.env.VITE_DEBOT_BASE_URL;
const DEBOT_API_KEY = import.meta.env.VITE_DEBOT_API_KEY;
const DEBOT_PRICE_PATH = import.meta.env.VITE_DEBOT_PRICE_PATH || '/v1/price';
// MEXC public API base URL. Uses VITE_MEXC_BASE_URL if defined, otherwise defaults to official endpoint.
const MEXC_BASE_URL = import.meta.env.VITE_MEXC_BASE_URL || 'https://api.mexc.com';

/**
 * Fetch price of a pair from MEXC at a given UTC timestamp.
 * It queries the 1-minute kline and returns the opening price of the candle.
 *
 * @param {string} pair Symbol of the trading pair, e.g. "BTCUSDT".
 * @param {string} timestampUtc ISO timestamp in UTC.
 * @returns {Promise<number|null>} Price if available, otherwise null.
 */
async function fetchMexcPriceAt(pair, timestampUtc) {
  try {
    const startTime = dayjs.utc(timestampUtc).valueOf();
    const url = new URL('/api/v3/klines', MEXC_BASE_URL);
    url.searchParams.set('symbol', pair);
    url.searchParams.set('interval', '1m');
    url.searchParams.set('startTime', startTime);
    url.searchParams.set('limit', 1);
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const kline = data[0];
      const openPrice = Array.isArray(kline) ? kline[1] : null;
      const priceNum = Number(openPrice);
      return Number.isFinite(priceNum) ? priceNum : null;
    }
    return null;
  } catch (error) {
    console.error('MEXC price lookup failed', error);
    return null;
  }
}

function pickMarket(event) {
  const exchanges = Array.isArray(event.tge_exchanges) ? event.tge_exchanges : [];
  const entry = exchanges.find((item) => item && typeof item.pair === 'string' && item.pair.toUpperCase().includes('USDT'))
    || exchanges[0];

  if (entry && entry.pair) {
    return { pair: entry.pair, exchange: entry.exchange || null };
  }

  if (event.coin_price_link && typeof event.coin_price_link === 'string') {
    const cleaned = event.coin_price_link.trim();
    const match = cleaned.match(/[A-Z0-9]{2,}USDT/);
    if (match) return { pair: match[0], exchange: null };
    return { pair: cleaned, exchange: null };
  }
  return null;
}

function calcPercent(basePrice, nextPrice) {
  if (basePrice === null || basePrice === undefined) return null;
  if (nextPrice === null || nextPrice === undefined) return null;
  if (Number(basePrice) === 0) return null;
  return ((Number(nextPrice) - Number(basePrice)) / Number(basePrice)) * 100;
}

async function fetchPriceAt(pair, timestampUtc) {
  // try DEBOT first
  let price = null;
  if (DEBOT_BASE_URL) {
    try {
      const url = new URL(DEBOT_PRICE_PATH, DEBOT_BASE_URL);
      url.searchParams.set('pair', pair);
      url.searchParams.set('timestamp', dayjs.utc(timestampUtc).toISOString());
      const res = await fetch(url, {
        headers: DEBOT_API_KEY ? { Authorization: `Bearer ${DEBOT_API_KEY}` } : undefined,
      });
      if (res.ok) {
        const payload = await res.json();
        if (typeof payload.price === 'number') {
          price = payload.price;
        } else if (payload.data && typeof payload.data.price === 'number') {
          price = payload.data.price;
        }
      }
    } catch (error) {
      console.error('DEBOT price lookup failed', error);
    }
  }
  // fallback to MEXC if no price from Debot
  if (price === null || price === undefined) {
    return fetchMexcPriceAt(pair, timestampUtc);
  }
  return price;
}

export async function triggerPriceReactionJob() {
  const nowUtc = dayjs.utc();
  const orFilter = [
    ...TOURNAMENT_SLUGS.map((slug) => `event_type_slug.eq.${slug}`),
    ...TOURNAMENT_TYPES.map((value) => `type.eq."${value}"`),
  ].join(',');

  const { data: events, error: eventsError } = await supabase
    .from('events_approved')
    .select('id,title,start_at,type,event_type_slug,coin_name,timezone,tge_exchanges,coin_price_link')
    .lte('start_at', nowUtc.toISOString())
    .not('start_at', 'is', null)
    .or(orFilter);

  if (eventsError) throw eventsError;

  const ids = (events || []).map((ev) => ev.id);
  const existingMap = new Map();

  if (ids.length) {
    const { data: existing, error: existingError } = await supabase
      .from('event_price_reaction')
      .select('*')
      .in('event_id', ids);
    if (existingError) throw existingError;
    for (const row of existing || []) {
      existingMap.set(row.event_id, row);
    }
  }

  const summary = { processed: events?.length || 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const event of events || []) {
    const market = pickMarket(event);
    if (!market) {
      summary.skipped += 1;
      continue;
    }

    const t0Time = dayjs.utc(event.start_at);
    const t5Time = t0Time.add(5, 'minute');
    const t15Time = t0Time.add(15, 'minute');
    const existing = existingMap.get(event.id);

    if (!existing) {
      try {
        const t0Price = await fetchPriceAt(market.pair, t0Time.toISOString());
        const payload = {
          event_id: event.id,
          coin_name: event.coin_name || null,
          pair: market.pair,
          exchange: market.exchange,
          t0_time: t0Time.toISOString(),
          t0_price: t0Price,
          t0_percent: 0,
          t_plus_5_time: t5Time.toISOString(),
          t_plus_15_time: t15Time.toISOString(),
        };

        if (nowUtc.isAfter(t5Time)) {
          const price = await fetchPriceAt(market.pair, t5Time.toISOString());
          payload.t_plus_5_price = price;
          payload.t_plus_5_percent = calcPercent(t0Price, price);
        }

        if (nowUtc.isAfter(t15Time)) {
          const price = await fetchPriceAt(market.pair, t15Time.toISOString());
          payload.t_plus_15_price = price;
          payload.t_plus_15_percent = calcPercent(t0Price, price);
        }

        const { error } = await supabase.from('event_price_reaction').insert(payload);
        if (error) throw error;
        summary.inserted += 1;
      } catch (error) {
        console.error('Failed to insert price reaction', error);
        summary.errors += 1;
      }
      continue;
    }

    try {
      const patch = {};
      if (!existing.t_plus_5_price && nowUtc.isAfter(t5Time)) {
        const price = await fetchPriceAt(market.pair, t5Time.toISOString());
        patch.t_plus_5_price = price;
        patch.t_plus_5_percent = calcPercent(existing.t0_price, price);
        patch.t_plus_5_time = existing.t_plus_5_time || t5Time.toISOString();
      }

      if (!existing.t_plus_15_price && nowUtc.isAfter(t15Time)) {
        const price = await fetchPriceAt(market.pair, t15Time.toISOString());
        patch.t_plus_15_price = price;
        patch.t_plus_15_percent = calcPercent(existing.t0_price, price);
        patch.t_plus_15_time = existing.t_plus_15_time || t15Time.toISOString();
      }

      if (Object.keys(patch).length) {
        const { error } = await supabase.from('event_price_reaction').update(patch).eq('id', existing.id);
        if (error) throw error;
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      console.error('Failed to update price reaction', error);
      summary.errors += 1;
    }
  }

  return summary;
}