// src/lib/statsApi.js
import { supabase } from './supabase';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { fetchMexcTickerPrice as fetchMexcTickerPriceShared } from '../utils/fetchMexcTicker';

dayjs.extend(utc);

// ====== Налаштування ======
const CAPTURE_WINDOW_MINUTES = 5;      // вікно “після” targetTime (щоб не промахнутись)
const LOOKAHEAD_DAYS = 7;              // наскільки вперед створюємо/тримаємо записи
const MIN_WRITE_GAP_SECONDS = 20;      // щоб не спамити update при частих викликах

// Дефолтні типи (якщо в БД не налаштовано track_in_stats)
const DEFAULT_TOURNAMENT_SLUGS = ['binance_tournament', 'ts_bybit', 'booster'];
const DEFAULT_TOURNAMENT_TYPES = ['Binance Tournaments', 'TS Bybit', 'Booster'];

export async function fetchStatsTypeFilters() {
  try {
    const { data, error } = await supabase
      .from('event_types')
      .select('slug,name,label,track_in_stats,active')
      .eq('track_in_stats', true)
      .eq('active', true);

    if (error) throw error;

    const slugs = new Set();
    const typeNames = new Set();

    (data || []).forEach((row) => {
      if (row.slug) slugs.add(row.slug);
      if (row.name) typeNames.add(row.name);
      if (row.label) typeNames.add(row.label);
    });

    if (!slugs.size && !typeNames.size) {
      return {
        slugs: DEFAULT_TOURNAMENT_SLUGS,
        typeNames: DEFAULT_TOURNAMENT_TYPES,
        source: 'default',
      };
    }

    return {
      slugs: Array.from(slugs),
      typeNames: Array.from(typeNames),
      source: 'db',
    };
  } catch (error) {
    console.error('Не вдалося завантажити типи для статистики', error);
    return {
      slugs: DEFAULT_TOURNAMENT_SLUGS,
      typeNames: DEFAULT_TOURNAMENT_TYPES,
      source: 'default',
    };
  }
}

async function buildStatsFilter() {
  const { slugs, typeNames } = await fetchStatsTypeFilters();
  const filterParts = [
    ...slugs.map((slug) => `event_type_slug.eq.${slug}`),
    ...typeNames.map((name) => `type.eq."${name}"`),
  ];
  return filterParts.join(',');
}

/**
 * Повертаємо записи event_price_reaction, включно з майбутніми,
 * щоб “заготовлені” івенти були видимі на Stats одразу.
 */
export async function fetchCompletedTournaments() {
  const { data: excluded } = await supabase
    .from('event_price_reaction_exclusions')
    .select('event_id');
  const excludedIds = new Set((excluded || []).map((row) => row.event_id));

  const orFilter = await buildStatsFilter();

  const { data, error } = await supabase
    .from('event_price_reaction')
    .select(
      '*, events_approved!event_price_reaction_event_id_fkey(id,title,start_at,type,event_type_slug,coin_name,timezone,coin_price_link,link)'
    )
    .or(orFilter, { foreignTable: 'events_approved' })
    .order('t0_time', { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => !excludedIds.has(row.event_id))
    .map((row) => {
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
        priceLink: event.coin_price_link || event.link || null,
        priceReaction: [
          { label: 'T0', time: row.t0_time, price: row.t0_price, percent: row.t0_percent ?? 0 },
          {
            label: 'T+5m',
            time: row.t_plus_5_time,
            price: row.t_plus_5_price,
            percent: row.t_plus_5_percent,
          },
          {
            label: 'T+15m',
            time: row.t_plus_15_time,
            price: row.t_plus_15_price,
            percent: row.t_plus_15_percent,
          },
        ],
      };
    });
}

// ===== Джерела цін =====
const DEBOT_BASE_URL = import.meta.env.VITE_DEBOT_BASE_URL || null;
const DEBOT_API_KEY = import.meta.env.VITE_DEBOT_API_KEY || null;
const DEBOT_PRICE_PATH = import.meta.env.VITE_DEBOT_PRICE_PATH || '/v1/price';

function normalizeMexcSymbol(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 6) return null;
  return cleaned;
}

function pickMarket(event) {
  const exchanges = Array.isArray(event.tge_exchanges) ? event.tge_exchanges : [];

  const entry =
    exchanges.find(
      (item) => item && typeof item.pair === 'string' && item.pair.toUpperCase().includes('USDT')
    ) || exchanges[0];

  if (entry && entry.pair) {
    const apiPair = normalizeMexcSymbol(entry.pair);
    return {
      pair: entry.pair,
      apiPair,
      exchange: entry.exchange || null,
      market: 'spot',
    };
  }

  // fallback: пробуємо витягнути пару з лінка
  const link = (event.coin_price_link || event.link || '').trim();
  if (link) {
    const m = link.match(/[A-Z0-9]{2,}[_/]*USDT/i);
    const displayPair = m ? m[0] : link;
    const apiPair = normalizeMexcSymbol(displayPair);
    const isFutures = /futures/i.test(link);
    return {
      pair: displayPair,
      apiPair,
      exchange: /mexc/i.test(link) ? 'MEXC' : null,
      market: isFutures ? 'futures' : 'spot',
    };
  }

  return null;
}

/**
 * Браузер-стабільно: беремо поточну ціну.
 * (історичні klines у браузері часто CORS-блочаться)
 */
async function fetchCurrentPrice(market) {
  const { pair, apiPair, exchange, market: marketType } = market;
  let price = null;

  // 1) Debot
  if (DEBOT_BASE_URL) {
    try {
      const url = new URL(DEBOT_PRICE_PATH, DEBOT_BASE_URL);
      url.searchParams.set('pair', pair);
      if (exchange) url.searchParams.set('exchange', exchange);

      const res = await fetch(url.toString(), {
        headers: DEBOT_API_KEY ? { Authorization: `Bearer ${DEBOT_API_KEY}` } : undefined,
      });

      if (res.ok) {
        const payload = await res.json();
        if (typeof payload.price === 'number') return payload.price;
        if (payload.data && typeof payload.data.price === 'number') return payload.data.price;
      }
    } catch (e) {
      console.error('[DEBOT] price failed', pair, exchange, e);
    }
  }

  // 2) MEXC ticker (через твій util)
  if (price == null && apiPair && (!exchange || /mexc/i.test(exchange))) {
    try {
      const options = marketType ? { market: marketType } : {};
      const { price: p } = await fetchMexcTickerPriceShared(apiPair, { timeoutMs: 8000, ...options });
      if (p != null) price = p;
    } catch (e) {
      console.error('[MEXC] ticker failed', apiPair, e);
    }
  }

  return price;
}

function shouldCapture(nowUtc, targetTimeUtc) {
  if (!nowUtc || !targetTimeUtc) return false;
  const diff = nowUtc.diff(targetTimeUtc, 'minute', true);
  return diff >= 0 && diff <= CAPTURE_WINDOW_MINUTES;
}

function calcPercent(basePrice, nextPrice) {
  if (basePrice == null || nextPrice == null) return null;
  const b = Number(basePrice);
  const n = Number(nextPrice);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b === 0) return null;
  return ((n - b) / b) * 100;
}

function tooSoonToWrite(existing, nowUtc) {
  const last = existing?.updated_at || existing?.created_at || null;
  if (!last) return false;
  const diffSec = nowUtc.diff(dayjs.utc(last), 'second');
  return diffSec >= 0 && diffSec < MIN_WRITE_GAP_SECONDS;
}

/**
 * Джоба:
 *  - створює порожні записи для майбутніх івентів
 *  - на T0/T+5/T+15 ловить поточну ціну (Debot/ticker)
 */
export async function triggerPriceReactionJob() {
  const nowUtc = dayjs.utc();

  const { data: excluded } = await supabase
    .from('event_price_reaction_exclusions')
    .select('event_id');
  const excludedIds = new Set((excluded || []).map((row) => row.event_id));

  const orFilter = await buildStatsFilter();

  const windowStart = nowUtc.subtract(1, 'day').toISOString();
  const windowEnd = nowUtc.add(LOOKAHEAD_DAYS, 'day').toISOString();

  const { data: events, error: eventsError } = await supabase
    .from('events_approved')
    .select(
      'id,title,start_at,type,event_type_slug,coin_name,timezone,tge_exchanges,coin_price_link,link'
    )
    .gte('start_at', windowStart)
    .lte('start_at', windowEnd)
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
    for (const row of existing || []) existingMap.set(row.event_id, row);
  }

  const summary = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const event of events || []) {
    summary.processed += 1;
    if (excludedIds.has(event.id)) {
      summary.skipped += 1;
      continue;
    }

    const market = pickMarket(event);
    if (!market) {
      summary.skipped += 1;
      continue;
    }

    const t0Time = dayjs.utc(event.start_at);
    const t5Time = t0Time.add(5, 'minute');
    const t15Time = t0Time.add(15, 'minute');

    const existing = existingMap.get(event.id);

    // 1) Якщо запису нема — створюємо “заготовку” (ціни null)
    if (!existing) {
      try {
        const payload = {
          event_id: event.id,
          coin_name: event.coin_name || null,
          pair: market.pair,
          exchange: market.exchange,
          t0_time: t0Time.toISOString(),
          t0_price: null,
          t0_percent: 0,
          t_plus_5_time: t5Time.toISOString(),
          t_plus_5_price: null,
          t_plus_5_percent: null,
          t_plus_15_time: t15Time.toISOString(),
          t_plus_15_price: null,
          t_plus_15_percent: null,
        };

        const { error } = await supabase.from('event_price_reaction').insert(payload);
        if (error) throw error;

        summary.inserted += 1;
      } catch (e) {
        console.error('[stats] insert reaction failed', event.id, e);
        summary.errors += 1;
      }
      continue;
    }

    // анти-спам, якщо Stats часто викликає джобу
    if (tooSoonToWrite(existing, nowUtc)) {
      summary.skipped += 1;
      continue;
    }

    // 2) Оновлення існуючого
    try {
      const patch = {};

      // T0
      if (existing.t0_price == null && shouldCapture(nowUtc, t0Time)) {
        const p0 = await fetchCurrentPrice(market);
        if (p0 != null) {
          patch.t0_price = p0;
          patch.t0_percent = 0;
          patch.t0_time = existing.t0_time || t0Time.toISOString();
        }
      }

      const basePrice = patch.t0_price ?? existing.t0_price;

      // T+5 (percent від T0)
      if (existing.t_plus_5_price == null && basePrice != null && shouldCapture(nowUtc, t5Time)) {
        const p5 = await fetchCurrentPrice(market);
        if (p5 != null) {
          patch.t_plus_5_price = p5;
          patch.t_plus_5_time = existing.t_plus_5_time || t5Time.toISOString();
          patch.t_plus_5_percent = calcPercent(basePrice, p5);
        }
      }

      // T+15 (percent від T0)
      if (existing.t_plus_15_price == null && basePrice != null && shouldCapture(nowUtc, t15Time)) {
        const p15 = await fetchCurrentPrice(market);
        if (p15 != null) {
          patch.t_plus_15_price = p15;
          patch.t_plus_15_time = existing.t_plus_15_time || t15Time.toISOString();
          patch.t_plus_15_percent = calcPercent(basePrice, p15);
        }
      }

      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from('event_price_reaction')
          .update(patch)
          .eq('event_id', event.id);

        if (error) throw error;
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (e) {
      console.error('[stats] update reaction failed', event.id, e);
      summary.errors += 1;
    }
  }

  return summary;
}
