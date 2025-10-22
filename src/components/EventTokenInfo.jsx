import { useMemo } from 'react';
import { useTokenPrice, formatQuantity } from '../hooks/useTokenPrice';
import CopyableLinkPill from './CopyableLinkPill';

function formatCurrency(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const opts = num < 1
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

  const { price, loading, error, lastUpdated } = useTokenPrice(link);

  const quantityLabel = useMemo(() => formatQuantity(quantityValue), [quantityValue]);
  const priceLabel = useMemo(() => formatCurrency(price), [price]);
  const total = useMemo(() => {
    if (price === null || price === undefined) return null;
    if (!Number.isFinite(price) || quantityValue === null) return null;
    return price * quantityValue;
  }, [price, quantityValue]);
  const totalLabel = useMemo(() => formatCurrency(total), [total]);

  const updatedLabel = useMemo(() => {
    if (!lastUpdated) return null;
    try {
      return new Intl.DateTimeFormat('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(lastUpdated);
    } catch {
      return null;
    }
  }, [lastUpdated]);

  if (!name && quantityValue === null && !link) return null;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {name && <span className="font-semibold text-gray-900">{name}</span>}
        {quantityLabel && (
          <span className="text-gray-600">
            Кількість:{' '}
            <span className="font-medium text-gray-900">{quantityLabel}</span>
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1 text-sm">
        {link ? (
          loading ? (
            <div className="text-gray-500">Оновлюємо ціну…</div>
          ) : error ? (
            <div className="text-red-600">
              Не вдалося отримати ціну.{' '}
              <a className="underline" href={link} target="_blank" rel="noreferrer">
                Перевірити у Debot
              </a>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {priceLabel && (
                <span>
                  Ціна:{' '}
                  <span className="font-semibold text-gray-900">{priceLabel}</span>
                  <span className="text-gray-500"> / шт</span>
                </span>
              )}
              {totalLabel && (
                <span>
                  Разом:{' '}
                  <span className="font-semibold text-gray-900">{totalLabel}</span>
                </span>
              )}
              {updatedLabel && (
                <span className="text-xs text-gray-500">Оновлено о {updatedLabel}</span>
              )}
            </div>
          )
        ) : (
          <div className="text-gray-500">
            Додайте посилання на Debot, щоб ми підтягували актуальну USD-ціну автоматично.
          </div>
        )}
      </div>

      {link && (
        <div className="mt-3">
          <CopyableLinkPill href={link} />
        </div>
      )}

      <div className="mt-2 text-xs text-gray-500">Оновлення ціни раз на хвилину.</div>
    </div>
  );
}