import { useEffect, useState } from 'react';
import PriceReactionCard from '../components/PriceReactionCard';
import { fetchCompletedTournaments } from '../lib/statsApi';

export default function Stats() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchCompletedTournaments();
        if (mounted) setItems(data);
      } catch (err) {
        setError(err.message || 'Не вдалося завантажити статистику');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Статистика</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Автоматичний трекінг Binance Tournaments та TS Bybit у моменти T0, +5 та +15 хвилин.
        </p>
      </header>

      {loading && <p className="text-sm text-gray-500">Завантаження…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !items.length && !error && (
        <p className="text-sm text-gray-500">Поки що немає завершених турнірів.</p>
      )}

      <div className="grid gap-3">
        {items.map((item) => (
          <PriceReactionCard key={item.eventId} item={item} />
        ))}
      </div>
    </div>
  );
}