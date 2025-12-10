// src/hooks/useMexcLivePrice.js
import { useEffect, useMemo, useState } from 'react';
import { fetchMexcTickerPrice, buildMexcTickerUrl } from '../utils/fetchMexcTicker';

// source: або повний mexc-лінк, або symbol типу "BTCUSDT"
function normalizeMexcSymbol(source) {
  if (!source || typeof source !== 'string') return null;
  const trimmed = source.trim().toUpperCase();

  // URL
  if (/^https?:\/\//i.test(trimmed)) {
    const spotMatch = trimmed.match(/\/exchange\/([A-Z0-9]+)_([A-Z0-9]+)/i);
    if (spotMatch) {
      return { symbol: `${spotMatch[1].toUpperCase()}${spotMatch[2].toUpperCase()}`, market: 'spot' };
    }

    const futuresMatch = trimmed.match(/\/futures\/([A-Z0-9]+)_([A-Z0-9]+)/i);
    if (futuresMatch) {
      return { symbol: `${futuresMatch[1].toUpperCase()}_${futuresMatch[2].toUpperCase()}`, market: 'futures' };
    }

    return null;
  }

  // вже symbol
  if (/^[A-Z0-9]{5,20}$/.test(trimmed)) return { symbol: trimmed, market: 'spot' };

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
  }, [normalized]);

  return { price, loading, error, symbol: normalized?.symbol };
}
