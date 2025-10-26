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

function TokenRow({ coin }) {
  const name = (coin?.name || '').trim();
  const hasQuantity = Object.prototype.hasOwnProperty.call(coin || {}, 'quantity');
  const quantityValue = hasQuantity ? coin.quantity : null;
  const link = typeof coin?.price_link === 'string' ? coin.price_link.trim() : '';

  const { price, loading, error } = useTokenPrice(link);

  const quantityLabel = useMemo(
    () => (hasQuantity ? formatQuantity(quantityValue) : null),
    [hasQuantity, quantityValue]
  );
  const total = useMemo(() => {
    if (!hasQuantity) return null;
    if (price === null || price === undefined) return null;
    if (!Number.isFinite(price)) return null;
    if (!Number.isFinite(quantityValue)) return null;
    return price * quantityValue;
  }, [hasQuantity, price, quantityValue]);

  const totalLabel = useMemo(() => formatCurrency(total), [total]);

  const showPriceInfo = Boolean(link) && hasQuantity;

  return (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base">
      <div className="inline-flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
        {hasQuantity && quantityLabel && (
          <span className="token-panel__value">{quantityLabel}</span>
        )}
        {name && <span className="token-panel__name">{name}</span>}
      </div>

      {showPriceInfo && (
        loading ? (
          <span className="token-panel__muted">Оновлюємо ціну…</span>
        ) : error ? (
          <span className="token-panel__error">Очікуємо ціну</span>
        ) : (
          totalLabel && (
            <span className="token-panel__label">
              <span className="token-panel__value">{totalLabel}</span>
            </span>
          )
        )
      )}
    </div>
  );
}
    export default function EventTokenInfo({ coins = [] }) {
  const entries = Array.isArray(coins)
    ? coins.filter((coin) =>
        coin && (
          (coin.name && coin.name.trim().length > 0) ||
          Object.prototype.hasOwnProperty.call(coin, 'quantity')
        )
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