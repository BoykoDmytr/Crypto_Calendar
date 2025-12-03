/* eslint-env node */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

const KYIV_TZ = 'Europe/Kyiv';
const TOURNAMENT_SLUGS = new Set(['binance_tournament']);
const TOURNAMENT_TYPES = new Set(['Binance Tournaments']);

function log(message, extra = {}) {
  const ts = new Date().toISOString();
  console.log(`[price-reaction] ${ts} ${message}`, Object.keys(extra).length ? extra : '');
}

function ensureSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase credentials are missing. Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(url, key);
}

class DebotClient {
  constructor({ baseUrl = process.env.DEBOT_BASE_URL, apiKey = process.env.DEBOT_API_KEY, pricePath = process.env.DEBOT_PRICE_PATH || '/v1/price' } = {}) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.pricePath = pricePath;
  }

  async getPriceAt(pair, timestampUtc) {
    if (!this.baseUrl) {
      log('DEBOT_BASE_URL is not configured, skipping price lookup');
      return null;
    }
    try {
      const url = new URL(this.pricePath, this.baseUrl);
      url.searchParams.set('pair', pair);
      url.searchParams.set('timestamp', dayjs.utc(timestampUtc).toISOString());
      const res = await fetch(url, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      });
      if (!res.ok) {
        log(`DEBOT responded with status ${res.status}`, { pair, timestampUtc });
        return null;
      }
      const payload = await res.json();
      if (typeof payload.price === 'number') return payload.price;
      if (payload.data && typeof payload.data.price === 'number') return payload.data.price;
      log('DEBOT response missing price', { payload });
      return null;
    } catch (error) {
      log('Failed to fetch price from DEBOT', { error: error.message, pair, timestampUtc });
      return null;
    }
  }
}

function pickMarket(event) {
  const exchanges = Array.isArray(event.tge_exchanges) ? event.tge_exchanges : [];
  const entry = exchanges.find((item) => item && typeof item.pair === 'string' && item.pair.toUpperCase().includes('USDT')) || exchanges[0];
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

async function fetchEvents(supabase) {
  const now = new Date().toISOString();
  const orFilter = [
    ...Array.from(TOURNAMENT_SLUGS).map((slug) => `event_type_slug.eq.${slug}`),
    ...Array.from(TOURNAMENT_TYPES).map((value) => `type.eq.${value.replace(/ /g, '%20')}`),
  ].join(',');

  const { data, error } = await supabase
    .from('events_approved')
    .select('*')
    .lte('start_at', now)
    .not('start_at', 'is', null)
    .or(orFilter);

  if (error) throw error;
  return data || [];
}

async function loadExistingReactions(supabase, eventIds) {
  if (!eventIds.length) return new Map();
  const { data, error } = await supabase
    .from('event_price_reaction')
    .select('*')
    .in('event_id', eventIds);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    map.set(row.event_id, row);
  }
  return map;
}

async function upsertReaction({ supabase, debot, event, existing }) {
  const market = pickMarket(event);
  if (!market) {
    log('Skipping event without market info', { eventId: event.id, title: event.title });
    return;
  }

  const t0Time = dayjs.utc(event.start_at);
  const t5Time = t0Time.add(5, 'minute');
  const t15Time = t0Time.add(15, 'minute');
  const now = dayjs.utc();

  if (!existing) {
    const t0Price = await debot.getPriceAt(market.pair, t0Time.toISOString());
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
    const { error } = await supabase.from('event_price_reaction').insert(payload);
    if (error) {
      log('Failed to insert t0 record', { error: error.message, eventId: event.id });
    }
    return;
  }

  const patch = {};
  if (!existing.t_plus_5_price && now.isAfter(t5Time)) {
    const price = await debot.getPriceAt(market.pair, t5Time.toISOString());
    patch.t_plus_5_price = price;
    patch.t_plus_5_percent = calcPercent(existing.t0_price, price);
    patch.t_plus_5_time = existing.t_plus_5_time || t5Time.toISOString();
  }

  if (!existing.t_plus_15_price && now.isAfter(t15Time)) {
    const price = await debot.getPriceAt(market.pair, t15Time.toISOString());
    patch.t_plus_15_price = price;
    patch.t_plus_15_percent = calcPercent(existing.t0_price, price);
    patch.t_plus_15_time = existing.t_plus_15_time || t15Time.toISOString();
  }

  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('event_price_reaction').update(patch).eq('id', existing.id);
  if (error) {
    log('Failed to update price reaction', { error: error.message, eventId: event.id });
  }
}

async function main() {
  const supabase = ensureSupabaseClient();
  const debot = new DebotClient();
  try {
    const events = await fetchEvents(supabase);
    if (!events.length) {
      log('No tournaments found for processing');
      return;
    }
    const ids = events.map((ev) => ev.id);
    const existingMap = await loadExistingReactions(supabase, ids);
    for (const event of events) {
      try {
        await upsertReaction({ supabase, debot, event, existing: existingMap.get(event.id) });
      } catch (error) {
        log('Unhandled error while processing event', { eventId: event.id, error: error.message });
      }
    }
  } catch (error) {
    log('Fatal error', { error: error.message });
    process.exitCode = 1;
  }
}

main();