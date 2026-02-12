// src/lib/statsApi.js
import { supabase } from './supabase';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { fetchMexcTickerPrice as fetchMexcTickerPriceShared } from '../utils/fetchMexcTicker';

dayjs.extend(utc);

// ===== Турнірні типи =====
const DEFAULT_TOURNAMENT_SLUGS = ['binance_tournament', 'ts_bybit', 'booster'];
const DEFAULT_TOURNAMENT_TYPES = ['Binance Tournaments', 'TS Bybit', 'Booster'];

// ===== Налаштування джоби =====
const LOOKAHEAD_DAYS = 60;          // скільки днів вперед готуємо
const CAPTURE_WINDOW_MINUTES = 3;   // вікно після targetTime

// ===== Налаштування ±30m series =====
const SERIES_TOTAL_POINTS = 61;     // -30..+30 включно
const SERIES_CENTER_INDEX = 30;     // index 30 => offset 0 (T0 minute)
const SERIES_CUTOFF_MINUTES = 35;   // запускати серию коли now >= T0 + 35m

// ───────────────────────────── helpers ─────────────────────────────

function normalizeValidPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// для SPOT: BTC_USDT -> BTCUSDT
function normalizeMexcSpotSymbol(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 5) return null;
  return cleaned;
}

// для FUTURES: BTC_USDT -> BTC_USDT (залишаємо "_")
function normalizeMexcFuturesSymbol(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  // дозволяємо тільки A-Z 0-9 та _
  const cleaned = upper.replace(/[^A-Z0-9_]/g, '');
  // базова перевірка
  if (!/_USDT$/.test(cleaned)) return null;
  if (cleaned.length < 6) return null;
  return cleaned;
}

/**
 * Витягує пару з MEXC URL:
 *  - .../futures/BTC_USDT?...  -> BTC_USDT, market=futures
 *  - .../exchange/BTC_USDT     -> BTC_USDT, market=spot
 */
function isMexcFuturesLink(link) {
  if (!link || typeof link !== 'string') return false;
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    if (host.startsWith('futures.') || host.startsWith('contract.')) return true;
    if (host.includes('futures') || host.includes('contract')) return true;

    const path = url.pathname.toLowerCase();
    if (path.includes('/futures/') || path.includes('/contract/') || path.includes('/swap/')) return true;

    const type = url.searchParams.get('type');
    if (type && type.toLowerCase() === 'linear_swap') return true;
  } catch {
    // ignore URL parse errors
  }

  return /\/futures\//i.test(link) || /type=linear_swap/i.test(link);
}

function parseMexcLink(link) {
  if (!link || typeof link !== 'string') return null;
  const s = link.trim();

  const isFutures = isMexcFuturesLink(s);

  const m =
    s.match(/\/(futures|exchange)\/([A-Z0-9]{1,}_USDT)/i) ||
    s.match(/([A-Z0-9]{1,}_USDT)/i);

  const pair = m ? m[m.length - 1].toUpperCase() : null;
  if (!pair) return null;

  const market = isFutures ? 'futures' : 'spot';

  return {
    pair, // "BTC_USDT"
    // ✅ ключова зміна: futures -> symbol з "_", spot -> без "_"
    apiPair: market === 'futures'
      ? normalizeMexcFuturesSymbol(pair)   // BTC_USDT
      : normalizeMexcSpotSymbol(pair),     // BTCUSDT
    market,
  };
}

/**
 * ✅ ЄДИНЕ ДЖЕРЕЛО — MEXC
 * Спершу беремо пару з coin_price_link,
 * якщо немає — з coin_name (BTC -> BTC_USDT),
 * якщо немає — пробуємо tge_exchanges.pair як fallback.
 */
function pickMexcMarket(event) {
  // 1) З лінка MEXC
  const fromLink = parseMexcLink(event.coin_price_link);
  if (fromLink) {
    return {
      pair: fromLink.pair,
      apiPair: fromLink.apiPair,
      exchange: 'MEXC',
      market: fromLink.market,
    };
  }

  // 2) З coin_name (BTC -> BTC_USDT)
  if (event.coin_name) {
    const sym = String(event.coin_name).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (sym) {
      const pair = `${sym}_USDT`;
      // якщо ми не знаємо ринок — вважаємо spot
      return {
        pair,
        apiPair: normalizeMexcSpotSymbol(pair), // BTCUSDT
        exchange: 'MEXC',
        market: 'spot',
      };
    }
  }

  // 3) Fallback зі списку бірж
  const exchanges = Array.isArray(event.tge_exchanges) ? event.tge_exchanges : [];
  const entry =
    exchanges.find((x) => x?.pair && String(x.pair).toUpperCase().includes('USDT')) || exchanges[0];

  if (entry?.pair) {
    const pair = String(entry.pair).toUpperCase();
    const isFutures = isMexcFuturesLink(event.coin_price_link || '');
    const market = isFutures ? 'futures' : 'spot';

    return {
      pair,
      apiPair: market === 'futures'
        ? normalizeMexcFuturesSymbol(pair) // BTC_USDT
        : normalizeMexcSpotSymbol(pair),   // BTCUSDT
      exchange: 'MEXC',
      market,
    };
  }

  return null;
}

async function fetchMexcPrice(market) {
  if (!market?.apiPair) return null;

  try {
    // ✅ symbol тепер правильний:
    // spot: BTCUSDT
    // futures: BTC_USDT
    const { price } = await fetchMexcTickerPriceShared(market.apiPair, {
      timeoutMs: 8_000,
      market: market.market || 'spot',
    });
    return normalizeValidPrice(price);
  } catch (e) {
    console.error('[MEXC] ticker failed', market.apiPair, market.market, e);
    return null;
  }
}

function shouldCapture(nowUtc, targetTimeUtc, captureWindowMinutes = CAPTURE_WINDOW_MINUTES) {
  if (!nowUtc || !targetTimeUtc) return false;
  const diffSec = nowUtc.diff(targetTimeUtc, 'second');
  return diffSec >= 0 && diffSec <= captureWindowMinutes * 60;
}

function calcPercent(basePrice, nextPrice) {
  if (basePrice == null || nextPrice == null) return null;
  const b = Number(basePrice);
  const n = Number(nextPrice);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b <= 0) return null;
  return ((n - b) / b) * 100;
}

function calcReturn(fromPrice, toPrice) {
  if (fromPrice == null || toPrice == null) return null;
  const f = Number(fromPrice);
  const t = Number(toPrice);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f <= 0) return null;
  return ((t / f) - 1) * 100;
}

// ───────────────────────────── filters ─────────────────────────────

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
 * ✅ NEW: Completed events for UI (±30m series + summary + %mcap)
 * Використовуй це у /stats замість fetchCompletedTournaments()
 */
export async function fetchCompletedEvents() {
  const now = new Date().toISOString();

  const { data: excluded } = await supabase
    .from('event_price_reaction_exclusions')
    .select('event_id');
  const excludedIds = new Set((excluded || []).map((row) => row.event_id));

  const orFilter = await buildStatsFilter();

  const { data, error } = await supabase
    .from('event_price_reaction')
    .select(
      `*,
      series_close,
      series_high,
      series_low,
      pre_return_30m,
      post_return_30m,
      net_return_60m,
      max_price,
      max_offset,
      min_price,
      min_offset,
      event_pct_mcap,
      events_approved!event_price_reaction_event_id_fkey(
        id,title,start_at,type,event_type_slug,coin_name,timezone,coin_price_link,link,
        event_usd_value,mcap_usd
      )`
    )
    .lte('t0_time', now)
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

        // ±30m series
        seriesClose: row.series_close || [],
        seriesHigh: row.series_high || [],
        seriesLow: row.series_low || [],

        // KPI summary
        preReturn30m: row.pre_return_30m,
        postReturn30m: row.post_return_30m,
        netReturn60m: row.net_return_60m,

        // MAX / MIN
        maxPrice: row.max_price,
        maxOffset: row.max_offset,
        minPrice: row.min_price,
        minOffset: row.min_offset,

        // % of MCAP
        eventPctMcap: row.event_pct_mcap,
      };
    });
}

/**
 * ✅ Backward-compatible: стара функція (T0/T+5/T+15)
 * Можеш залишити, якщо десь ще використовується.
 */
export async function fetchCompletedTournaments() {
  const now = new Date().toISOString();

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
    .lte('t0_time', now)
    .or(orFilter, { foreignTable: 'events_approved' })
    .order('t0_time', { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => !excludedIds.has(row.event_id))
    .map((row) => {
      const event = row.events_approved || {};
      const t0Price = row.t0_price;
      const t5Price = row.t_plus_5_price;
      const t15Price = row.t_plus_15_price;
      const t5Percent = calcPercent(t0Price, t5Price) ?? row.t_plus_5_percent;
      const t15Percent = calcPercent(t5Price, t15Price) ?? row.t_plus_15_percent;

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
          { label: 'T0', time: row.t0_time, price: t0Price, percent: row.t0_percent ?? 0 },
          { label: 'T+5m', time: row.t_plus_5_time, price: t5Price, percent: t5Percent },
          { label: 'T+15m', time: row.t_plus_15_time, price: t15Price, percent: t15Percent },
        ],
      };
    });
}

// ───────────────────────────── main job ─────────────────────────────

export async function triggerPriceReactionJob() {
  const nowUtc = dayjs.utc();

  const { data: excluded } = await supabase
    .from('event_price_reaction_exclusions')
    .select('event_id');
  const excludedIds = new Set((excluded || []).map((row) => row.event_id));

  const orFilter = await buildStatsFilter();

  // ✅ беремо івенти НАПЕРЕД (для заготовлених постів)
  // ⬇️ ДОДАЛИ event_usd_value, mcap_usd для %mcap
  const { data: events, error: eventsError } = await supabase
    .from('events_approved')
    .select('id,title,start_at,type,event_type_slug,coin_name,timezone,tge_exchanges,coin_price_link,link,event_usd_value,mcap_usd')
    .lte('start_at', nowUtc.add(LOOKAHEAD_DAYS, 'day').toISOString())
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

    // ✅ завжди MEXC
    const market = pickMexcMarket(event);
    if (!market?.apiPair) {
      summary.skipped += 1;
      console.warn('[stats] skip event, cannot determine MEXC pair', event.id, event.title);
      continue;
    }

    const t0Time = dayjs.utc(event.start_at);
    const t5Time = t0Time.add(5, 'minute');
    const t15Time = t0Time.add(15, 'minute');

    const existing = existingMap.get(event.id);

    // 1) якщо запису нема — створюємо заготовку
    if (!existing) {
      try {
        const payload = {
          event_id: event.id,
          coin_name: event.coin_name || null,
          pair: market.pair,
          exchange: 'MEXC',

          t0_time: t0Time.toISOString(),
          t0_price: null,
          t0_percent: 0,

          t_plus_5_time: t5Time.toISOString(),
          t_plus_5_price: null,
          t_plus_5_percent: null,

          t_plus_15_time: t15Time.toISOString(),
          t_plus_15_price: null,
          t_plus_15_percent: null,

          // ✅ нові поля (NULL на старті)
          series_close: null,
          series_high: null,
          series_low: null,
          pre_return_30m: null,
          post_return_30m: null,
          net_return_60m: null,
          max_price: null,
          max_offset: null,
          min_price: null,
          min_offset: null,
          event_pct_mcap: null,
        };

        const { error } = await supabase.from('event_price_reaction').insert(payload);
        if (error) throw error;

        summary.inserted += 1;
      } catch (error) {
        console.error('[stats] insert stub failed', event.id, error);
        summary.errors += 1;
      }
      continue;
    }

    // 2) апдейтимо ціни в потрібні вікна (T0/T+5/T+15)
    try {
      const patch = {};

      // T0
      if (existing.t0_price == null && shouldCapture(nowUtc, t0Time)) {
        const p0 = await fetchMexcPrice(market);
        if (p0 != null) {
          patch.t0_price = p0;
          patch.t0_percent = 0;
        }
      }

      const base = patch.t0_price ?? existing.t0_price;

      // T+5
      if (existing.t_plus_5_price == null && base != null && shouldCapture(nowUtc, t5Time)) {
        const p5 = await fetchMexcPrice(market);
        if (p5 != null) {
          patch.t_plus_5_price = p5;
          patch.t_plus_5_percent = calcPercent(base, p5);
        }
      }

      // T+15
      if (existing.t_plus_15_price == null && base != null && shouldCapture(nowUtc, t15Time)) {
        const p15 = await fetchMexcPrice(market);
        if (p15 != null) {
          patch.t_plus_15_price = p15;
          const t5Base = patch.t_plus_5_price ?? existing.t_plus_5_price;
          patch.t_plus_15_percent = calcPercent(t5Base, p15);
        }
      }

      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from('event_price_reaction')
          .update(patch)
          .eq('event_id', event.id);

        if (error) throw error;
        summary.updated += 1;
      }
    } catch (error) {
      console.error('[stats] update reaction failed', event.id, error);
      summary.errors += 1;
      continue;
    }

    // 3) ✅ Якщо ±30m series вже є — пропускаємо важкий fetch
    if (Array.isArray(existing.series_close) && existing.series_close.length === SERIES_TOTAL_POINTS) {
      summary.skipped += 1;
      continue;
    }

    // 4) ✅ Серію рахуємо тільки коли now >= T0 + 35m
    if (nowUtc.isBefore(t0Time.add(SERIES_CUTOFF_MINUTES, 'minute'))) {
      summary.skipped += 1;
      continue;
    }

    // 5) ✅ Один запит до MEXC за 1m klines (±30m)
    try {
      const startTs = t0Time.subtract(30, 'minute').valueOf();
      const endTs = t0Time.add(30, 'minute').valueOf();

      const url = new URL('https://api.mexc.com/api/v3/klines');
      url.searchParams.set('symbol', market.apiPair);
      url.searchParams.set('interval', '1m');
      url.searchParams.set('startTime', String(startTs));
      url.searchParams.set('endTime', String(endTs));

      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error(`MEXC klines failed: ${resp.status}`);
      const candles = await resp.json(); // [[ts, open, high, low, close, ...], ...]

      // серії індексуємо як index 0 => -30m, index 30 => T0, index 60 => +30m
      const closeSeries = new Array(SERIES_TOTAL_POINTS).fill(null);
      const highSeries = new Array(SERIES_TOTAL_POINTS).fill(null);
      const lowSeries = new Array(SERIES_TOTAL_POINTS).fill(null);

      for (const c of candles || []) {
        const [ts, _open, high, low, close] = c;
        const off = Math.round((Number(ts) - startTs) / 60_000);
        if (off >= 0 && off < SERIES_TOTAL_POINTS) {
          closeSeries[off] = Number(close);
          highSeries[off] = Number(high);
          lowSeries[off] = Number(low);
        }
      }

      // KPI
      const priceNeg30 = closeSeries[0];
      const priceT0 = closeSeries[SERIES_CENTER_INDEX];
      const pricePos30 = closeSeries[SERIES_TOTAL_POINTS - 1];

      const preReturn30m = calcReturn(priceNeg30, priceT0);      // -30 -> 0
      const postReturn30m = calcReturn(priceT0, pricePos30);     // 0 -> +30
      const netReturn60m = calcReturn(priceNeg30, pricePos30);   // -30 -> +30

      // MAX/MIN (по high/low якщо є)
      let maxIdx = 0;
      let minIdx = 0;
      for (let i = 0; i < SERIES_TOTAL_POINTS; i++) {
        if (highSeries[i] != null && (highSeries[maxIdx] == null || highSeries[i] > highSeries[maxIdx])) {
          maxIdx = i;
        }
        if (lowSeries[i] != null && (lowSeries[minIdx] == null || lowSeries[i] < lowSeries[minIdx])) {
          minIdx = i;
        }
      }
      const maxPrice = highSeries[maxIdx] ?? null;
      const minPrice = lowSeries[minIdx] ?? null;
      const maxOffset = maxIdx - SERIES_CENTER_INDEX; // -30..+30
      const minOffset = minIdx - SERIES_CENTER_INDEX;

      // % of MCAP
      let eventPctMcap = null;
      if (event.event_usd_value != null && event.mcap_usd != null) {
        const evUsd = Number(event.event_usd_value);
        const mcap = Number(event.mcap_usd);
        if (Number.isFinite(evUsd) && Number.isFinite(mcap) && mcap > 0) {
          eventPctMcap = (evUsd / mcap) * 100;
        }
      }

      const update = {
        series_close: closeSeries,
        series_high: highSeries,
        series_low: lowSeries,

        pre_return_30m: preReturn30m,
        post_return_30m: postReturn30m,
        net_return_60m: netReturn60m,

        max_price: maxPrice,
        max_offset: maxOffset,
        min_price: minPrice,
        min_offset: minOffset,

        event_pct_mcap: eventPctMcap,
      };

      const { error } = await supabase
        .from('event_price_reaction')
        .update(update)
        .eq('event_id', event.id);

      if (error) throw error;

      summary.updated += 1;
    } catch (error) {
      console.error('[stats] fetch ±30m series failed', event.id, error);
      summary.errors += 1;
    }
  }

  return summary;
}
