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

  if (!name && quantityValue === null && !link) return null;

  return (
    <div className="token-panel mt-3">
  <div className="token-panel__header flex items-center justify-between">
    {name && <span className="token-panel__name">{name}</span>}

    <div className="flex items-center gap-6 text-sm">
      {loading ? (
        <span className="opacity-80">Оновлюємо ціну…</span>
      ) : error ? (
        <span className="text-red-600">Не вдалося отримати ціну.</span>
      ) : (
        <>
          {quantityLabel && (
            <span>
              Кількість: <strong>{quantityLabel}</strong>
            </span>
          )}
          {totalLabel && (
            <span>
              Разом: <strong>{totalLabel}</strong>
            </span>
          )}
        </>
      )}
    </div>
  </div>
</div>


  );
}