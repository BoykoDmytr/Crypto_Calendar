// src/components/EventTokenInfo.jsx
import { useEffect, useMemo, useState } from 'react';
import { useTokenPrice, formatQuantity } from '../hooks/useTokenPrice';
import { fetchMexcTickerPrice, buildMexcTickerUrl } from '../utils/fetchMexcTicker';

function formatCurrency(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  const opts =
    num < 1
      ? { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }
      : { style: 'currency', currency: 'USD', maximumFractionDigits: 2 };

  return new Intl.NumberFormat('en-US', opts).format(num);
}

// Витягуємо BTCUSDT із лінка типу https://www.mexc.com/exchange/BTC_USDT
function extractMexcSymbolFromLink(link) {
  if (!link || typeof link !== 'string') return null;
  const trimmed = link.trim().toUpperCase();

  if (!/^https?:\/\//i.test(trimmed)) return null;
  const m = trimmed.match(/\/EXCHANGE\/([A-Z0-9]+)_([A-Z0-9]+)/i);
  if (!m) return null;

  const base = m[1].toUpperCase();
  const quote = m[2].toUpperCase();
  return `${base}${quote}`; // BTCUSDT
}

function TokenRow({ coin }) {
  const name = (coin?.name || '').trim();
  const hasQuantity = Object.prototype.hasOwnProperty.call(coin || {}, 'quantity');
  const quantityValue = hasQuantity ? coin.quantity : null;

  const link = typeof coin?.price_link === 'string' ? coin.price_link.trim() : '';
  const isMexc = /mexc\.com/i.test(link);
  const mexcSymbol = isMexc ? extractMexcSymbolFromLink(link) : null;

  // 🔹 Debot — усе, що НЕ MEXC
  const {
    price: debotPrice,
    loading: debotLoading,
    error: debotError,
  } = useTokenPrice(!isMexc ? link : null);

  // 🔹 MEXC — локальний стейт
  const [mexcPrice, setMexcPrice] = useState(null);
  const [mexcLoading, setMexcLoading] = useState(false);
  const [mexcError, setMexcError] = useState(null);

  useEffect(() => {
    if (!isMexc || !mexcSymbol) {
      setMexcPrice(null);
      setMexcError(null);
      setMexcLoading(false);
      return;
    }

    let cancelled = false;
    let timerId;

    async function fetchPrice() {
      if (cancelled) return;

      try {
        setMexcLoading(true);
        setMexcError(null);

        const urlCandidates = buildMexcTickerUrl(mexcSymbol);
        const { price } = await fetchMexcTickerPrice(mexcSymbol);

        console.debug('[MEXC] fetched ticker', {
          ...urlCandidates,
          mexcSymbol,
          name,
          price,
        });

        if (!cancelled) {
          setMexcPrice(price);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[MEXC] fetch error', e);
          setMexcError(e);
          setMexcPrice(null);
        }
      } finally {
        if (!cancelled) {
          setMexcLoading(false);
        }
      }
    }

    // перший запит
    fetchPrice();
    // оновлюємо раз на хвилину
    timerId = setInterval(fetchPrice, 60_000);

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
    };
  }, [isMexc, mexcSymbol, name]);

  // 🔹 Вибір джерела ціни
  const price = isMexc ? mexcPrice : debotPrice;
  const loading = isMexc ? mexcLoading : debotLoading;
  const error = isMexc ? mexcError : debotError;

  const quantityLabel = useMemo(
    () => (hasQuantity ? formatQuantity(quantityValue) : null),
    [hasQuantity, quantityValue]
  );

  const total = useMemo(() => {
    if (!hasQuantity) return null;
    if (!Number.isFinite(price)) return null;

    const q = Number(quantityValue);
    if (!Number.isFinite(q)) return null;

    return price * q;
  }, [hasQuantity, price, quantityValue]);

  const totalLabel = useMemo(() => formatCurrency(total), [total]);
  const showPriceInfo = hasQuantity && Boolean(link);

  // DEBUG: що реально приходить у рядок
  console.debug('[EventTokenInfo:TokenRow]', {
    name,
    link,
    isMexc,
    mexcSymbol,
    hasQuantity,
    quantityValue,
    price,
    total,
    totalLabel,
    loading,
    error,
  });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base">
      <div className="inline-flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
        {hasQuantity && quantityLabel && (
          <span className="token-panel__value">{quantityLabel}</span>
        )}
        {name && <span className="token-panel__name">{name}</span>}
      </div>

      {showPriceInfo &&
        (loading ? (
          <span className="token-panel__muted">Оновлюємо ціну…</span>
        ) : totalLabel ? (
          <span className="token-panel__label">
            <span className="token-panel__value">{totalLabel}</span>
          </span>
        ) : error ? (
          <span className="token-panel__error">Очікуємо ціну</span>
        ) : (
          <span className="token-panel__muted">Очікуємо ціну…</span>
        ))}
    </div>
  );
}

export default function EventTokenInfo({ coins = [] }) {
  const entries = Array.isArray(coins)
    ? coins.filter(
        (coin) =>
          coin &&
          ((coin.name && coin.name.trim().length > 0) ||
            Object.prototype.hasOwnProperty.call(coin, 'quantity'))
      )
    : [];

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {entries.map((coin, index) => (
        <TokenRow key={`${coin?.name || 'coin'}-${index}`} coin={coin} />
      ))}
    </div>
  );
}
