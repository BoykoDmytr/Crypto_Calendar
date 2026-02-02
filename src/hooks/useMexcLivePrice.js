// src/hooks/useMexcLivePrice.js
import { useEffect, useMemo, useState } from 'react';
import { fetchMexcTickerPrice, buildMexcTickerUrl } from '../utils/fetchMexcTicker';

const MEXC_REFRESH_INTERVAL_MS = 20_000;

function isMexcFuturesLink(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
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

  return /\/futures\//i.test(raw) || /type=linear_swap/i.test(raw);
}

// source: або повний mexc-лінк, або symbol типу "BTCUSDT" (spot) чи "BTC_USDT" (futures)
function normalizeMexcSymbol(source) {
  if (!source || typeof source !== 'string') return null;
  const raw = source.trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();

  // URL
  if (/^https?:\/\//i.test(raw)) {
    const isFutures = isMexcFuturesLink(raw);
    // пробуємо знайти пару у форматі XXX_YYY (підтримує uk-UA / інші префікси)
    const m =
      raw.match(/\/(futures|exchange)\/([A-Z0-9]+)_([A-Z0-9]+)/i) ||
      raw.match(/([A-Z0-9]+)_([A-Z0-9]+)/i);

    if (!m) return null;

    const base = (m[m.length - 2] || '').toUpperCase();
    const quote = (m[m.length - 1] || '').toUpperCase();
    if (!base || !quote) return null;

    if (isFutures) {
      return { symbol: `${base}_${quote}`, market: 'futures' }; // BTC_USDT
    }
    return { symbol: `${base}${quote}`, market: 'spot' }; // BTCUSDT
  }

  // вже symbol
  // futures символ зазвичай з "_" (BTC_USDT)
  if (/^[A-Z0-9]{2,20}_[A-Z0-9]{2,10}$/.test(upper)) {
    return { symbol: upper, market: 'futures' };
  }

  // spot символ без "_" (BTCUSDT)
  if (/^[A-Z0-9]{5,20}$/.test(upper)) {
    return { symbol: upper, market: 'spot' };
  }

  return null;
}

export function useMexcLivePrice(source) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const normalized = useMemo(() => normalizeMexcSymbol(source), [source]);

  useEffect(() => {
    if (!normalized?.symbol) {
      setPrice(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timerId;
    let visibilityHandler;

    async function fetchPrice() {
      if (cancelled) return;

      try {
        setLoading(true);
        setError(null);

        const urlCandidates = buildMexcTickerUrl(normalized.symbol, { market: normalized.market });
        const { price } = await fetchMexcTickerPrice(normalized.symbol, { market: normalized.market });

        console.debug('[MEXC] fetched ticker', {
          ...urlCandidates,
          symbol: normalized.symbol,
          market: normalized.market,
          price,
        });

        if (!cancelled) setPrice(price);
      } catch (e) {
        if (!cancelled) {
          console.error('[MEXC] fetch error', e);
          setError(e);
          setPrice(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPrice(); // перший запит
    timerId = setInterval(fetchPrice, MEXC_REFRESH_INTERVAL_MS);

    if (typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          fetchPrice();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    };
  }, [normalized?.symbol, normalized?.market]);

  return { price, loading, error, symbol: normalized?.symbol };
}
