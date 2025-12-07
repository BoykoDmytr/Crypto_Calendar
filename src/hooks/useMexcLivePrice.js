// src/hooks/useMexcLivePrice.js
import { useEffect, useMemo, useState } from 'react';

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

        const baseUrl = 'https://api.mexc.com/api/v3/ticker/price';
        const originalUrl = `${baseUrl}?symbol=${encodeURIComponent(
          symbol
        )}&_=${Date.now()}`;
        const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(
          originalUrl
        )}`;

        console.debug('[MEXC] fetch via proxy', { originalUrl, proxyUrl: url });

        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          if (!cancelled) {
            console.error('[MEXC] non-200', res.status, body.slice(0, 200));
            setError(
              new Error(`MEXC status ${res.status}: ${body.slice(0, 200)}`)
            );
            setPrice(null);
          }
          return;
        }

        const data = await res.json();
        const raw = data.price ?? data.lastPrice;
        const num = Number(raw);

        if (!cancelled) {
          if (Number.isFinite(num)) {
            setPrice(num);
          } else {
            console.error('[MEXC] invalid price', data);
            setPrice(null);
            setError(new Error('Invalid price from MEXC'));
          }
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
