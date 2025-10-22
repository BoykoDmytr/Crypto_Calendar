import { useMemo } from 'react';
import { useTokenPrice, formatQuantity } from '../hooks/useTokenPrice';

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

function parseQuantity(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/\s+/g, '').replace(/,/g, '.');
    const num = Number(normalized);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

export default function EventTokenInfo({ coinName, coinQuantity, priceLink }) {
  const name = (coinName || '').trim();
  const quantityValue = parseQuantity(coinQuantity);
  const link = typeof priceLink === 'string' ? priceLink.trim() : '';

  const { price, loading, error } = useTokenPrice(link);

  const quantityLabel = useMemo(() => formatQuantity(quantityValue), [quantityValue]);
  const total = useMemo(() => {
    if (price === null || price === undefined) return null;
    if (!Number.isFinite(price) || quantityValue === null) return null;
    return price * quantityValue;
  }, [price, quantityValue]);
  const totalLabel = useMemo(() => formatCurrency(total), [total]);

  const showPriceInfo = !loading && !error;

  if (!name && quantityValue === null && !link) return null;

  return (
  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base">
    {/* Група: кількість + назва з меншим інтервалом */}
    <div className="inline-flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
      {showPriceInfo && quantityLabel && (
        <span className="token-panel__value">{quantityLabel}</span>
      )}
      {name && <span className="token-panel__name">{name}</span>}
    </div>

    {loading ? (
      <span className="token-panel__muted">Оновлюємо ціну…</span>
    ) : error ? (
      <span className="token-panel__error">Не вдалося отримати ціну.</span>
    ) : (
      <>
        {totalLabel && (
          <span className="token-panel__label">
            <span className="token-panel__value">{totalLabel}</span>
          </span>
        )}
      </>
    )}
  </div>
);

}