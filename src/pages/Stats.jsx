import { useEffect, useState } from 'react';
import PriceReactionCard from '../components/PriceReactionCard';
import { fetchCompletedTournaments, triggerPriceReactionJob } from '../lib/statsApi';
import { supabase } from '../lib/supabase';

// Event types that should be auto‑added to the statistics page.  When
// events with these slugs or names are inserted into the events_approved
// table, the page will automatically trigger the price reaction job to
// capture their price points.
const AUTO_TYPES = ['Binance Tournaments', 'TS Bybit'];
const AUTO_SLUGS = ['binance_tournament', 'ts_bybit'];

/**
 * Statistics page.  Displays completed Binance Tournaments and TS Bybit
 * events and their price reactions at T0, +5m and +15m.  A background
 * timer runs the price reaction job every minute to ensure that prices
 * are captured as soon as the thresholds are reached.  Users can also
 * manually trigger the job via the button.
 */
export default function Stats() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [jobInfo, setJobInfo] = useState('');
  const [jobError, setJobError] = useState(null);

  // Helper to load the list of completed tournaments.
  const loadItems = async () => {
    try {
      const data = await fetchCompletedTournaments();
      setItems(data);
    } catch (err) {
      setError(err.message || 'Не вдалося завантажити статистику');
    }
  };

  // Initial load and setup of automatic refresh.  The effect schedules
  // periodic execution of the price reaction job and reloads the items
  // afterward.  The interval is cleared on unmount to avoid leaks.
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

    // Set up periodic job run every 60 seconds.
    const intervalId = setInterval(async () => {
      try {
        // Run the price reaction job silently.  We don't update jobInfo
        // here to avoid spamming the UI; user can still manually trigger.
        await triggerPriceReactionJob();
        await loadItems();
      } catch (err) {
        console.error('Автоматичний збір статистики помилився', err);
        // Do not set jobError here to avoid interfering with manual state.
      }
    }, 60_000);

    // Set up realtime listener for new events.  When a new row is
    // inserted into events_approved, check if it matches our auto
    // inclusion criteria.  If so, trigger the price reaction job and
    // reload the list.  Using supabase realtime reduces the need for
    // manual refreshes and ensures that new events appear promptly.
    const channel = supabase
      .channel('stats_auto_add')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events_approved' },
        async (payload) => {
          const newEvent = payload.new;
          if (
            (newEvent.event_type_slug && AUTO_SLUGS.includes(newEvent.event_type_slug)) ||
            (newEvent.type && AUTO_TYPES.includes(newEvent.type))
          ) {
            try {
              await triggerPriceReactionJob();
              await loadItems();
            } catch (err) {
              console.error('Автооновлення статистики помилилося', err);
            }
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, []);

  // Manual job runner.  Allows user to trigger the price reaction job on
  // demand and displays a summary of the operation.
  const runJob = async () => {
    setRunning(true);
    setJobError(null);
    setJobInfo('');
    try {
      const summary = await triggerPriceReactionJob();
      setJobInfo(
        `Скан завершено: опрацьовано ${summary.processed}, нових ${summary.inserted}, ` +
        `оновлено ${summary.updated}, пропущено ${summary.skipped}.` +
        (summary.errors ? ` Помилки: ${summary.errors}.` : ''),
      );
      await loadItems();
    } catch (err) {
      setJobError(err.message || 'Не вдалося запустити збір статистики');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Статистика</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
              Автоматичний трекінг Binance Tournaments та TS Bybit у моменти T0, +5 та +15 хвилин. Додані
              івенти з цих категорій зʼявляються тут автоматично.
            </p>
          </div>
          <button
            type="button"
            onClick={runJob}
            disabled={running}
            className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60"
          >
            {running ? 'Запускаємо…' : 'Оновити статистику'}
          </button>
        </div>
        {jobInfo && (
          <p className="text-sm text-emerald-600 dark:text-emerald-300">
            {jobInfo}
          </p>
        )}
        {jobError && <p className="text-sm text-red-500">{jobError}</p>}
      </header>

      {loading && <p className="text-sm text-gray-600">Завантаження…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !items.length && !error && (
        <p className="text-sm text-gray-600">Поки що немає завершених турнірів.</p>
      )}
      <div className="grid gap-4">
        {items.map((item) => (
          <PriceReactionCard key={item.eventId} item={item} />
        ))}
      </div>
    </div>
  );
}