// src/lib/statsApi.js
import { supabase } from './supabase';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// Які івенти вважаємо турнірами
const TOURNAMENT_SLUGS = ['binance_tournament', 'ts_bybit'];
const TOURNAMENT_TYPES = ['Binance Tournaments', 'TS Bybit'];

/**
 * Завантажити всі завершені турніри з event_price_reaction +
 * приєднані дані з events_approved, готові для PriceReactionCard.
 */
export async function fetchCompletedTournaments() {
  const now = new Date().toISOString();

  const orFilter = [
    ...TOURNAMENT_SLUGS.map((slug) => `event_type_slug.eq.${slug}`),
    ...TOURNAMENT_TYPES.map((name) => `type.eq."${name}"`),
  ].join(',');

  const { data, error } = await supabase
    .from('event_price_reaction')
    .select(
      '*, events_approved!event_price_reaction_event_id_fkey(id,title,start_at,type,event_type_slug,coin_name,timezone,coin_price_link,link)'
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
      pair: row.pair, // "LTC_USDT", "BSV_USDT" або лінк — як збережено
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

// ===== Налаштування джерел цін =====

const DEBOT_BASE_URL = import.meta.env.VITE_DEBOT_BASE_URL || null;
const DEBOT_API_KEY = import.meta.env.VITE_DEBOT_API_KEY || null;
const DEBOT_PRICE_PATH = import.meta.env.VITE_DEBOT_PRICE_PATH || '/v1/price';

const MEXC_BASE_URL = import.meta.env.VITE_MEXC_BASE_URL || 'https://api.mexc.com';

/**
 * Нормалізуємо символ для MEXC:
 *  - "LTC_USDT" → "LTCUSDT"
 *  - "ltc/usdt" → "LTCUSDT"
 *  - "LTCUSDT"  → "LTCUSDT"
 */
function normalizeMexcSymbol(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, ''); // видаляємо "_", "/", "-" тощо
  if (cleaned.length < 6) return null;
  return cleaned;
}

/**
 * Поточна ціна з тікера MEXC.
 */
async function fetchMexcTickerPrice(apiPair) {
  try {
    if (!apiPair) return null;

    const tickerUrl = new URL('/api/v3/ticker/price', MEXC_BASE_URL);
    tickerUrl.searchParams.set('symbol', apiPair);
    tickerUrl.searchParams.set('_', Date.now().toString());

    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(
      tickerUrl.toString()
    )}`;

    const res = await fetch(proxyUrl);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[MEXC] ticker error', apiPair, res.status, txt.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const raw = data.price ?? data.lastPrice;
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      console.error('[MEXC] ticker invalid price', apiPair, data);
      return null;
    }

    return num;
  } catch (error) {
    console.error('[MEXC] ticker failed', apiPair, error);
    return null;
  }
}

/**
 * Обрати ринок (пару та біржу) для івенту.
 *
 * Повертає:
 *  - pair:    "LTC_USDT" (людський варіант, зберігаємо в БД/показуємо)
 *  - apiPair: "LTCUSDT" (для MEXC)
 *  - exchange: назва біржі з tge_exchanges, якщо є
 */
function pickMarket(event) {
  const exchanges = Array.isArray(event.tge_exchanges) ? event.tge_exchanges : [];

  const entry =
    exchanges.find(
      (item) =>
        item && typeof item.pair === 'string' && item.pair.toUpperCase().includes('USDT')
    ) || exchanges[0];

  if (entry && entry.pair) {
    const apiPair = normalizeMexcSymbol(entry.pair);
    return {
      pair: entry.pair,
      apiPair,
      exchange: entry.exchange || null,
    };
  }

  // fallback: пробуємо лінк
  if (event.coin_price_link && typeof event.coin_price_link === 'string') {
    const cleaned = event.coin_price_link.trim();
    // витягнути щось на кшталт ETH_USDT або ETHUSDT
    const m = cleaned.match(/[A-Z0-9]{2,}[_/]*USDT/i);
    const displayPair = m ? m[0] : cleaned;
    const apiPair = normalizeMexcSymbol(displayPair);
    return {
      pair: displayPair,
      apiPair,
      exchange: /mexc/i.test(cleaned) ? 'MEXC' : null,
    };
  }

  return null;
}

/**
 * Поточна ціна для ринку:
 *   1) пробуємо Debot (якщо є),
 *   2) якщо біржа MEXC або не вказана — пробуємо MEXC ticker.
 */
async function fetchCurrentPrice(market) {
  const { pair, apiPair, exchange } = market;
  let price = null;

  // 1) Debot (якщо налаштований)
  if (DEBOT_BASE_URL) {
    try {
      const url = new URL(DEBOT_PRICE_PATH, DEBOT_BASE_URL);
      url.searchParams.set('pair', pair);
      if (exchange) url.searchParams.set('exchange', exchange);

      const res = await fetch(url.toString(), {
        headers: DEBOT_API_KEY
          ? {
              Authorization: `Bearer ${DEBOT_API_KEY}`,
            }
          : undefined,
      });

      if (res.ok) {
        const payload = await res.json();
        if (typeof payload.price === 'number') {
          price = payload.price;
        } else if (payload.data && typeof payload.data.price === 'number') {
          price = payload.data.price;
        }
      } else {
        const txt = await res.text().catch(() => '');
        console.error('[DEBOT] price error', pair, exchange, res.status, txt.slice(0, 200));
      }
    } catch (error) {
      console.error('[DEBOT] price failed', pair, exchange, error);
    }
  }

  // 2) MEXC ticker (якщо Debot не спрацював і є apiPair)
  if (price === null && apiPair && (!exchange || /mexc/i.test(exchange))) {
    price = await fetchMexcTickerPrice(apiPair);
  }

  return price;
}

/**
 * Визначити, чи варто зараз «ловити» ціну для targetTime:
 *   - now >= targetTime
 *   - і різниця не більше captureWindowMinutes (за замовчуванням 2 хв)
 */
function shouldCapture(nowUtc, targetTimeUtc, captureWindowMinutes = 2) {
  if (!nowUtc || !targetTimeUtc) return false;
  if (!nowUtc.isAfter(targetTimeUtc)) return false;
  const diff = nowUtc.diff(targetTimeUtc, 'minute');
  return diff >= 0 && diff <= captureWindowMinutes;
}

/**
 * Порахувати % зміну.
 */
function calcPercent(basePrice, nextPrice) {
  if (basePrice == null || nextPrice == null) return null;
  const b = Number(basePrice);
  const n = Number(nextPrice);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b === 0) return null;
  return ((n - b) / b) * 100;
}

/**
 * Головна джоба для вкладки «Статистика»:
 *   - створює/оновлює записи в event_price_reaction
 *   - ловить ціну у вікні біля T0, T+5, T+15 (±2 хв)
 */
export async function triggerPriceReactionJob() {
  const nowUtc = dayjs.utc();

  const orFilter = [
    ...TOURNAMENT_SLUGS.map((slug) => `event_type_slug.eq.${slug}`),
    ...TOURNAMENT_TYPES.map((value) => `type.eq."${value}"`),
  ].join(',');

  // Беремо всі івенти, які вже стартували
  const { data: events, error: eventsError } = await supabase
    .from('events_approved')
    .select(
      'id,title,start_at,type,event_type_slug,coin_name,timezone,tge_exchanges,coin_price_link'
    )
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

  const summary = {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  for (const event of events || []) {
    summary.processed += 1;

    const market = pickMarket(event);
    if (!market) {
      summary.skipped += 1;
      console.warn('[stats] skip event, no market', event.id, event.title);
      continue;
    }

    const t0Time = dayjs.utc(event.start_at);
    const t5Time = t0Time.add(5, 'minute');
    const t15Time = t0Time.add(15, 'minute');

    const existing = existingMap.get(event.id);

    // ========= Новий запис =========
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

        // ловимо T0, якщо вже настало вікно
        if (shouldCapture(nowUtc, t0Time)) {
          const price0 = await fetchCurrentPrice(market);
          if (price0 != null) {
            payload.t0_price = price0;
          }
        }

        // ловимо T+5 / T+15, якщо вже час
        if (shouldCapture(nowUtc, t5Time) && payload.t0_price != null) {
          const price5 = await fetchCurrentPrice(market);
          if (price5 != null) {
            payload.t_plus_5_price = price5;
            payload.t_plus_5_percent = calcPercent(payload.t0_price, price5);
          }
        }

        if (shouldCapture(nowUtc, t15Time) && payload.t0_price != null) {
          const price15 = await fetchCurrentPrice(market);
          if (price15 != null) {
            payload.t_plus_15_price = price15;
            payload.t_plus_15_percent = calcPercent(payload.t0_price, price15);
          }
        }

        const { error } = await supabase.from('event_price_reaction').insert(payload);
        if (error) throw error;
        summary.inserted += 1;
      } catch (error) {
        console.error('[stats] insert reaction failed', event.id, error);
        summary.errors += 1;
      }

      continue;
    }

    // ========= Оновлення існуючого запису =========
    try {
      const patch = {};

      // T0
      if (existing.t0_price == null && shouldCapture(nowUtc, t0Time)) {
        const price0 = await fetchCurrentPrice(market);
        if (price0 != null) {
          patch.t0_price = price0;
          patch.t0_time = existing.t0_time || t0Time.toISOString();
          patch.t0_percent = 0;
        }
      }

      const basePrice = patch.t0_price ?? existing.t0_price;

      // T+5
      if (existing.t_plus_5_price == null && shouldCapture(nowUtc, t5Time) && basePrice != null) {
        const price5 = await fetchCurrentPrice(market);
        if (price5 != null) {
          patch.t_plus_5_price = price5;
          patch.t_plus_5_time = existing.t_plus_5_time || t5Time.toISOString();
          patch.t_plus_5_percent = calcPercent(basePrice, price5);
        }
      }

      // T+15
      if (
        existing.t_plus_15_price == null &&
        shouldCapture(nowUtc, t15Time) &&
        basePrice != null
      ) {
        const price15 = await fetchCurrentPrice(market);
        if (price15 != null) {
          patch.t_plus_15_price = price15;
          patch.t_plus_15_time = existing.t_plus_15_time || t15Time.toISOString();
          patch.t_plus_15_percent = calcPercent(basePrice, price15);
        }
      }

      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from('event_price_reaction')
          .update(patch)
          .eq('id', existing.id);
        if (error) throw error;
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      console.error('[stats] update reaction failed', event.id, error);
      summary.errors += 1;
    }
  }

  return summary;
}
