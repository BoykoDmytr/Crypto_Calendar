// src/hooks/useMexcLivePrice.js
import { useEffect, useMemo, useState } from 'react';
import { fetchMexcTickerPrice, buildMexcTickerUrl } from '../utils/fetchMexcTicker';

// source: або повний mexc-лінк, або symbol типу "BTCUSDT"
function normalizeMexcSymbol(source) {
  if (!source || typeof source !== 'string') return null;
  const trimmed = source.trim().toUpperCase();

  // URL
  if (/^https?:\/\//i.test(trimmed)) {
    const m = trimmed.match(/\/exchange\/([A-Z0-9]+)_([A-Z0-9]+)/i);
    if (!m) return null;
    return `${m[1].toUpperCase()}${m[2].toUpperCase()}`; // BTCUSDT
  }

  // вже symbol
  if (/^[A-Z0-9]{5,20}$/.test(trimmed)) return trimmed;

  return null;
}

export function useMexcLivePrice(source) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const symbol = useMemo(() => normalizeMexcSymbol(source), [source]);

  useEffect(() => {
    if (!symbol) {
      setPrice(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timerId;

    async function fetchPrice() {
      if (cancelled) return;

      try {
        setLoading(true);
        setError(null);

        const urlCandidates = buildMexcTickerUrl(symbol);
        const { price } = await fetchMexcTickerPrice(symbol);

        console.debug('[MEXC] fetched ticker', { ...urlCandidates, symbol, price });

        if (!cancelled) {
          setPrice(price);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[MEXC] fetch error', e);
          setError(e);
          setPrice(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchPrice();                         // перший запит
    timerId = setInterval(fetchPrice, 60_000); // далі раз на хвилину

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
    };
  }, [symbol]);

  return { price, loading, error, symbol };
}
