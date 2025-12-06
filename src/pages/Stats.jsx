import { useEffect, useState } from 'react';
import PriceReactionCard from '../components/PriceReactionCard';
import { fetchCompletedTournaments, triggerPriceReactionJob } from '../lib/statsApi'

export default function Stats() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [jobInfo, setJobInfo] = useState('');
  const [jobError, setJobError] = useState(null);

  const loadItems = async () => {
    try {
      const data = await fetchCompletedTournaments();
      setItems(data);
    } catch (err) {
      setError(err.message || 'Не вдалося завантажити статистику');
    }
  };

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

  const runJob = async () => {
    setRunning(true);
    setJobError(null);
    setJobInfo('');
    try {
      const summary = await triggerPriceReactionJob();
      setJobInfo(
        `Скан завершено: опрацьовано ${summary.processed}, нових ${summary.inserted}, оновлено ${summary.updated}, пропущено ${summary.skipped}.` +
          (summary.errors ? ` Помилки: ${summary.errors}.` : '')
      );
      await loadItems();
    } catch (err) {
      setJobError(err.message || 'Не вдалося запустити збір статистики');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Статистика</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Автоматичний трекінг Binance Tournaments та TS Bybit у моменти T0, +5 та +15 хвилин.
            </p>
          </div>
          <button
            type="button"
            onClick={runJob}
            disabled={running}
            className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {running ? 'Запускаємо…' : 'Додати івент у статистику'}
          </button>
        </div>
        {jobInfo && <p className="text-sm text-emerald-600 dark:text-emerald-300">{jobInfo}</p>}
        {jobError && <p className="text-sm text-red-500">{jobError}</p>}
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