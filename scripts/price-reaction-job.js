/* eslint-env node */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

const KYIV_TZ = 'Europe/Kyiv';
const TOURNAMENT_SLUGS = new Set(['binance_tournament', 'ts_bybit']);
const TOURNAMENT_TYPES = new Set(['Binance Tournaments', 'TS Bybit']);

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

// Client to fetch prices from MEXC public REST API.
class MexcClient {
  constructor({ baseUrl = process.env.MEXC_BASE_URL || 'https://api.mexc.com' } = {}) {
    this.baseUrl = baseUrl;
  }

  async getPriceAt(pair, timestampUtc) {
    const startTime = dayjs.utc(timestampUtc).valueOf();

    try {
      const url = new URL('/api/v3/klines', this.baseUrl);
      url.searchParams.set('symbol', pair);      // наприклад BTCUSDT
      url.searchParams.set('interval', '1m');
      url.searchParams.set('startTime', startTime);
      url.searchParams.set('limit', 1);

      const res = await fetch(url);
      if (!res.ok) {
        log(`MEXC responded with status ${res.status}`, { pair, timestampUtc });
        return null;
      }

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const kline = data[0];       // [openTime, open, high, low, close, ...]
        const openPrice = Array.isArray(kline) ? kline[1] : null;
        const num = Number(openPrice);
        return Number.isFinite(num) ? num : null;
      }

      return null;
    } catch (error) {
      log('Failed to fetch price from MEXC', { error: error.message, pair, timestampUtc });
      return null;
    }
  }
}

function extractPairFromLink(raw) {
  if (!raw) return null;

  const str = String(raw).trim();
  const upper = str.toUpperCase();

  // 1) URL MEXC: .../exchange/BTC_USDT або /uk-UA/exchange/BTC_USDT
  try {
    const url = new URL(str);
    const path = url.pathname.toUpperCase(); // /EXCHANGE/BTC_USDT або /UK-UA/EXCHANGE/BTC_USDT
    const mexcMatch = path.match(/\/EXCHANGE\/([A-Z0-9]+)_USDT/);
    if (mexcMatch) {
      const base = mexcMatch[1]; // BTC
      return `${base}USDT`;      // BTCUSDT — те, що шлеcь у MEXC API
    }
  } catch {
    // якщо не URL — просто йдемо далі
  }

  // 2) голий запис BTC_USDT
  const underscore = upper.match(/^([A-Z0-9]+)_USDT$/);
  if (underscore) {
    return `${underscore[1]}USDT`;
  }

  // 3) десь у рядку є BTCUSDT
  const generic = upper.match(/[A-Z0-9]{2,}USDT/);
  if (generic) return generic[0];

  return null;
}


function pickMarket(event) {
  const exchanges = Array.isArray(event.tge_exchanges) ? event.tge_exchanges : [];

  // Якщо в tge_exchanges вже збережена пара — використовуємо її
  const entry =
    exchanges.find(
      (item) =>
        item &&
        typeof item.pair === 'string' &&
        item.pair.toUpperCase().includes('USDT')
    ) || exchanges[0];

  if (entry && entry.pair) {
    return { pair: entry.pair.toUpperCase(), exchange: entry.exchange || null };
  }

  // Інакше дивимося на поля з форми події
  const coins = Array.isArray(event.coins) ? event.coins : [];
  const primaryCoin = coins[0] || null;

  const linkCandidate =
    (primaryCoin && primaryCoin.price_link) ||
    event.coin_price_link ||
    event.link ||
    '';

  const pairFromLink = extractPairFromLink(linkCandidate);

  if (pairFromLink) {
    return { pair: pairFromLink, exchange: null };
  }

  // якщо нічого не розпізнали — скіпаємо
  return null;
}



function resolvePricePreference(event) {
  const coins = Array.isArray(event.coins) ? event.coins : [];
  const primaryCoin = coins[0] || null;

  const rawLink =
    (primaryCoin && primaryCoin.price_link) ||
    event.coin_price_link ||
    '';

  const link = String(rawLink).toLowerCase();

  if (link.includes('mexc.com')) return 'mexc';
  if (link.includes('debot.ai')) return 'debot';

  // якщо нічого явно — за замовчуванням MEXC
  return 'mexc';
}


function calcPercent(basePrice, nextPrice) {
  if (basePrice === null || basePrice === undefined) return null;
  if (nextPrice === null || nextPrice === undefined) return null;
  if (Number(basePrice) === 0) return null;
  return ((Number(nextPrice) - Number(basePrice)) / Number(basePrice)) * 100;
}

async function fetchEvents(supabase) {
  const now = dayjs.utc();
  const windowStart = now.subtract(1, 'day').toISOString();
  const windowEnd = now.add(1, 'day').toISOString();

  const { data, error } = await supabase
    .from('events_approved')
    .select(
      'id, title, start_at, event_type_slug, coin_name, tge_exchanges, coins, coin_price_link, link'
    )
    .gte('start_at', windowStart)
    .lte('start_at', windowEnd);

  if (error) {
    log('Failed to fetch events', { error: error.message });
    return [];
  }

  log('Fetched events for price reaction', { count: data.length });
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

async function upsertReaction({ supabase, debot, mexc, event, existing }) {
  const market = pickMarket(event);
  if (!market) {
    log('Skipping event without market info', { eventId: event.id, title: event.title });
    return;
  }

  const t0Time = dayjs.utc(event.start_at);
  const t5Time = t0Time.add(5, 'minute');
  const t15Time = t0Time.add(15, 'minute');
  const now = dayjs.utc();

  const preference = resolvePricePreference(event);

  async function getPrice(pair, isoTimestamp) {
    if (preference === 'mexc') {
      const fromMexc = await mexc.getPriceAt(pair, isoTimestamp);
      if (fromMexc !== null && fromMexc !== undefined) return fromMexc;
      return debot.getPriceAt(pair, isoTimestamp);
    }

    const fromDebot = await debot.getPriceAt(pair, isoTimestamp);
    if (fromDebot !== null && fromDebot !== undefined) return fromDebot;
    return mexc.getPriceAt(pair, isoTimestamp);
  }

  // 1) Якщо рядка ще немає — створюємо з t0
  if (!existing) {
    const t0Price = await getPrice(market.pair, t0Time.toISOString());

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

  // 2) Якщо рядок є, але t0_price ще null — дораховуємо t0
  const patch = {};

  if (existing.t0_price == null) {
    const t0Price = await getPrice(market.pair, t0Time.toISOString());
    patch.t0_price = t0Price;
    patch.t0_time = existing.t0_time || t0Time.toISOString();
    patch.t0_percent = 0;
  }

  if (!existing.t_plus_5_price && now.isAfter(t5Time)) {
    const price = await getPrice(market.pair, t5Time.toISOString());
    patch.t_plus_5_price = price;
    patch.t_plus_5_percent = calcPercent(existing.t0_price ?? patch.t0_price, price);
    patch.t_plus_5_time = existing.t_plus_5_time || t5Time.toISOString();
  }

  if (!existing.t_plus_15_price && now.isAfter(t15Time)) {
    const price = await getPrice(market.pair, t15Time.toISOString());
    patch.t_plus_15_price = price;
    patch.t_plus_15_percent = calcPercent(existing.t0_price ?? patch.t0_price, price);
    patch.t_plus_15_time = existing.t_plus_15_time || t15Time.toISOString();
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from('event_price_reaction')
    .update(patch)
    .eq('id', existing.id);

  if (error) {
    log('Failed to update price reaction', { error: error.message, eventId: event.id });
  }
}


async function main() {
  const supabase = ensureSupabaseClient();
  const debot = new DebotClient();
  const mexc = new MexcClient();

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
        await upsertReaction({
          supabase,
          debot,
          mexc,
          event,
          existing: existingMap.get(event.id),
        });
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


main();