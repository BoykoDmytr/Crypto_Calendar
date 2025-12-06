// src/components/EventTokenInfo.jsx
import { useMemo } from 'react';
import { useTokenPrice, formatQuantity } from '../hooks/useTokenPrice';
import { useEventPriceReaction } from '../hooks/useEventPriceReaction';

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

function TokenRow({ coin, eventId }) {
  const name = (coin?.name || '').trim();
  const hasQuantity = Object.prototype.hasOwnProperty.call(coin || {}, 'quantity');
  const quantityValue = hasQuantity ? coin.quantity : null;
  const link = typeof coin?.price_link === 'string' ? coin.price_link.trim() : '';

  // 1) t0_price з event_price_reaction
  const {
    price: reactionPrice,
    isLoading: reactionLoading,
  } = useEventPriceReaction(eventId);

  // 2) лайв-ціна як запасний варіант
  const {
    price: livePrice,
    loading: liveLoading,
    error: liveError,
  } = useTokenPrice(link);

  const basePrice = reactionPrice ?? livePrice;
  const loading = reactionLoading || liveLoading;

  const quantityLabel = useMemo(
    () => (hasQuantity ? formatQuantity(quantityValue) : null),
    [hasQuantity, quantityValue]
  );

  const total = useMemo(() => {
    if (!hasQuantity) return null;
    if (basePrice === null || basePrice === undefined) return null;
    if (!Number.isFinite(basePrice)) return null;
    if (!Number.isFinite(quantityValue)) return null;
    return basePrice * quantityValue;
  }, [hasQuantity, basePrice, quantityValue]);

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
        ) : totalLabel ? (
          <span className="token-panel__label">
            <span className="token-panel__value">{totalLabel}</span>
          </span>
        ) : (
          <span className="token-panel__error">
            {liveError ? 'Очікуємо ціну' : 'Очікуємо ціну'}
          </span>
        )
      )}
    </div>
  );
}

export default function EventTokenInfo({ coins = [], eventId }) {
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
          eventId={eventId}
        />
      ))}
    </div>
  );
}
