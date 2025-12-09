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
      <header className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-r from-[#121624] via-[#0e1220] to-[#0b101a] p-5 shadow-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#22d3ee12,transparent_35%),radial-gradient(circle_at_80%_0,#22c55e14,transparent_30%)]" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-emerald-300/80 font-semibold">
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-1">Live tracker</span>
              <span className="rounded-full bg-white/5 border border-white/10 px-2 py-1 text-gray-300">T0 · +5 · +15 хв</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Статистика</h1>
            <p className="text-sm text-gray-300">
              Автоматичний трекінг Binance Tournaments та TS Bybit у моменти T0, +5 та +15 хвилин. Додані
              івенти з цих категорій зʼявляються тут автоматично.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
              <span className="rounded-full bg-white/5 px-2 py-1 border border-white/10">Автооновлення щохвилини</span>
              <span className="rounded-full bg-white/5 px-2 py-1 border border-white/10">Слухаємо нові івенти</span>
            </div>
          </div>
          <button
            type="button"
            onClick={runJob}
            disabled={running}
            className="relative inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.7)] transition hover:border-emerald-300/60 hover:bg-emerald-500/25 disabled:opacity-60"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-200 text-sm">↺</span>
            {running ? 'Запускаємо…' : 'Оновити статистику'}
          </button>
        </div>
        {jobInfo && (
           <p className="relative mt-3 text-sm text-emerald-200">
            {jobInfo}
          </p>
        )}
        {jobError && <p className="relative mt-3 text-sm text-red-400">{jobError}</p>}
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