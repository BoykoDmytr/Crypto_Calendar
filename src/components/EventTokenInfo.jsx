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

// NEW: format % of circulating supply
function formatPctCirc(p) {
  if (p === null || p === undefined) return null;
  const n = Number(p);
  if (!Number.isFinite(n)) return null;

  const abs = Math.abs(n);

  // ✅ дуже малі значення — без scientific notation
  // (можеш змінити поріг, напр. 0.001)
  if (abs > 0 && abs < 0.0001) return '<0.0001%';

  if (abs >= 1) return `${n.toFixed(2)}%`;
  if (abs >= 0.1) return `${n.toFixed(3)}%`;
  if (abs >= 0.01) return `${n.toFixed(4)}%`;

  // ✅ малі, але не надто малі — показуємо до 6 знаків після коми (без зайвих нулів)
  return `${n.toFixed(6).replace(/\.?0+$/, '')}%`;
}

// Підтримує:
// - https://www.mexc.com/exchange/BTC_USDT
// - https://www.mexc.com/uk-UA/exchange/BTC_USDT#token-info
// - https://www.mexc.com/uk-UA/futures/RIVER_USDT
const MEXC_REFRESH_INTERVAL_MS = 600_000;

function isMexcFuturesLink(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host.startsWith('futures.') || host.startsWith('contract.')) return true;
    if (host.includes('futures') || host.includes('contract')) return true;

    const path = url.pathname.toLowerCase();
    if (path.includes('/futures/') || path.includes('/contract/') || path.includes('/swap/'))
      return true;

    const type = url.searchParams.get('type');
    if (type && type.toLowerCase() === 'linear_swap') return true;
  } catch {
    // ignore URL parse errors
  }

  return /\/futures\//i.test(raw) || /type=linear_swap/i.test(raw);
}

function extractMexcSymbolFromLink(link) {
  if (!link || typeof link !== 'string') return null;
  const raw = link.trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) return null;

  const isFutures = isMexcFuturesLink(raw);

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

function TokenRow({ coin, idx = 0, pctText = null, showMcap = true }) {
  const name = (coin?.name || '').trim();
  const hasQuantity = Object.prototype.hasOwnProperty.call(coin || {}, 'quantity');
  const quantityValue = hasQuantity ? coin.quantity : null;

  const link = typeof coin?.price_link === 'string' ? coin.price_link.trim() : '';
  const isMexc = /mexc\.com/i.test(link);
  const mexcMeta = isMexc ? extractMexcSymbolFromLink(link) : null;

  // NEW: percent of circulating supply (precomputed on create/update)
  // supports different key names just in case
  const pctCircRawFromCoin =
  coin?.pct_circ ?? coin?.pctCirc ?? coin?.percent_of_circulating ?? coin?.pct_of_circ ?? null;

// ✅ fallback: якщо pct не в coin, беремо з events_approved.coin_pct_circ (text, рядок на монету)
let pctCircRaw = pctCircRawFromCoin;

if (pctCircRaw == null && typeof pctText === 'string' && pctText.trim()) {
  const lines = pctText.split('\n').map((s) => s.trim());
  const line = lines[idx];
  if (line) {
    // line може бути "0.000035" або "0.000035%" — нормалізуємо
    const cleaned = line.replace('%', '').trim();
    const asNum = Number(cleaned);
    if (Number.isFinite(asNum)) pctCircRaw = asNum;
  }
}
  const pctCircLabel = useMemo(() => formatPctCirc(pctCircRaw), [pctCircRaw]);

  // 🔹 Debot — усе, що НЕ MEXC
  const { price: debotPrice, loading: debotLoading, error: debotError } = useTokenPrice(
    !isMexc ? link : null
  );

  // 🔹 MEXC — локальний стейт
  const [mexcPrice, setMexcPrice] = useState(null);
  const [mexcLoading, setMexcLoading] = useState(false);
  const [mexcError, setMexcError] = useState(null);

  useEffect(() => {
    if (!isMexc || !mexcMeta?.symbol) {
      setMexcPrice(null);
      setMexcError(null);
      setMexcLoading(false);
      return;
    }

    let cancelled = false;
    let timerId;
    let visibilityHandler;

    async function fetchPrice() {
      if (cancelled) return;

      try {
        setMexcLoading(true);
        setMexcError(null);

        const urlCandidates = buildMexcTickerUrl(mexcMeta.symbol, { market: mexcMeta.market });
        const { price } = await fetchMexcTickerPrice(mexcMeta.symbol, { market: mexcMeta.market });

        console.debug('[MEXC] fetched ticker', {
          ...urlCandidates,
          mexcSymbol: mexcMeta.symbol,
          market: mexcMeta.market,
          name,
          price,
        });

        if (!cancelled) setMexcPrice(price);
      } catch (e) {
        if (!cancelled) {
          console.error('[MEXC] fetch error', e);
          setMexcError(e);
          setMexcPrice(null);
        }
      } finally {
        if (!cancelled) setMexcLoading(false);
      }
    }

    fetchPrice();
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
  }, [isMexc, mexcMeta?.symbol, mexcMeta?.market, name]);

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

  console.debug('[EventTokenInfo:TokenRow]', {
    name,
    link,
    isMexc,
    mexcSymbol: mexcMeta?.symbol,
    market: mexcMeta?.market,
    hasQuantity,
    quantityValue,
    price,
    total,
    totalLabel,
    pctCircRaw,
    pctCircLabel,
    loading,
    error,
  });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base">
      <div className="inline-flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
        {hasQuantity && quantityLabel && <span className="token-panel__value">{quantityLabel}</span>}
        {name && <span className="token-panel__name">{name}</span>}
      </div>

      {showPriceInfo && (
        loading ? (
          <span className="token-panel__muted">Оновлюємо ціну…</span>
        ) : totalLabel ? (
          <span className="token-panel__label">
            <span className="token-panel__value">{totalLabel}</span>
            {/* Відображати відсоток тільки якщо showMcap = true */}
            {showMcap && pctCircLabel && (
              <span className="token-panel__muted" style={{ marginLeft: 8 }}>
                {pctCircLabel}
              </span>
            )}
          </span>
        ) : error ? (
          <span className="token-panel__error">Очікуємо ціну</span>
        ) : (
          <span className="token-panel__muted">Очікуємо ціну…</span>
        )
      )}
    </div>
  );
}

export default function EventTokenInfo({ coins = [], pctText = null, showMcap = true }) {
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
        <TokenRow
          key={`${coin?.name || 'coin'}-${index}`}
          coin={coin}
          idx={index}
          pctText={pctText}
          showMcap={showMcap}
        />
      ))}
    </div>
  );
}