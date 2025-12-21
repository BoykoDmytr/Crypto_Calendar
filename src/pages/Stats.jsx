import { useEffect, useMemo, useState } from 'react';
import PriceReactionCard from '../components/PriceReactionCard';
import { fetchCompletedTournaments, triggerPriceReactionJob } from '../lib/statsApi';
import { supabase } from '../lib/supabase';

// Event types that should be auto-added to the statistics page.  When
// events with these slugs or names are inserted into the events_approved
// table, the page will automatically trigger the price reaction job to
// capture their price points.
const AUTO_TYPES = ['Binance Tournaments', 'TS Bybit', 'Booster'];
const AUTO_SLUGS = ['binance_tournament', 'ts_bybit', 'booster'];
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Дата: новіші' },
  { value: 'date_asc', label: 'Дата: старіші' },
  { value: 'title_asc', label: 'Назва: A → Z' },
  { value: 'title_desc', label: 'Назва: Z → A' },
  { value: 'change_desc', label: 'Зміна: зростання' },
  { value: 'change_asc', label: 'Зміна: падіння' },
];

function getOverallChange(item) {
  const prices = item.priceReaction
    .map((entry) => entry.price)
    .filter((price) => price !== null && price !== undefined)
    .map((price) => Number(price))
    .filter((price) => Number.isFinite(price));
  if (prices.length < 2) return null;
  const base = prices[0];
  const last = prices[prices.length - 1];
  if (!Number.isFinite(base) || base === 0) return null;
  return ((last - base) / base) * 100;
}

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
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortKey, setSortKey] = useState('date_desc');

  const typeOptions = useMemo(() => {
    const types = new Set();
    items.forEach((item) => {
      if (item.type) types.add(item.type);
    });
    return ['all', ...Array.from(types)];
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered =
      typeFilter === 'all' ? items : items.filter((item) => item.type === typeFilter);
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'title_asc':
          return (a.title || '').localeCompare(b.title || '');
        case 'title_desc':
          return (b.title || '').localeCompare(a.title || '');
        case 'change_desc': {
          const aChange = getOverallChange(a);
          const bChange = getOverallChange(b);
          if (aChange == null && bChange == null) return 0;
          if (aChange == null) return 1;
          if (bChange == null) return -1;
          return bChange - aChange;
        }
        case 'change_asc': {
          const aChange = getOverallChange(a);
          const bChange = getOverallChange(b);
          if (aChange == null && bChange == null) return 0;
          if (aChange == null) return 1;
          if (bChange == null) return -1;
          return aChange - bChange;
        }
        case 'date_asc':
          return new Date(a.startAt || 0) - new Date(b.startAt || 0);
        case 'date_desc':
        default:
          return new Date(b.startAt || 0) - new Date(a.startAt || 0);
      }
    });
    return sorted;
  }, [items, sortKey, typeFilter]);

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
      <header className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-r from-white via-slate-50 to-emerald-50 p-5 shadow-xl text-slate-900 dark:border-white/5 dark:bg-gradient-to-r dark:from-[#121624] dark:via-[#0e1220] dark:to-[#0b101a] dark:text-white">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#22d3ee18,transparent_35%),radial-gradient(circle_at_80%_0,#22c55e12,transparent_30%)] dark:bg-[radial-gradient(circle_at_20%_20%,#22d3ee12,transparent_35%),radial-gradient(circle_at_80%_0,#22c55e14,transparent_30%)]"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-300/80">
              <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-1 shadow-sm dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/20">
                Live tracker
              </span>
              <span className="rounded-full bg-white border border-gray-200 px-2 py-1 text-gray-700 shadow-sm dark:bg-white/5 dark:border-white/10 dark:text-gray-300">
                T0 · +5 · +15 хв
              </span>
            </div>
            <h1 className="text-2xl font-bold">Статистика</h1>
            <p className="text-sm text-slate-700 dark:text-gray-300">
              Автоматичний трекінг Binance Tournaments та TS Bybit у моменти T0, +5 та +15 хвилин. Додані
              івенти з цих категорій зʼявляються тут автоматично.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-gray-400">
              <span className="rounded-full bg-white px-2 py-1 border border-gray-200 shadow-sm dark:bg-white/5 dark:border-white/10">
                Автооновлення щохвилини
              </span>
              <span className="rounded-full bg-white px-2 py-1 border border-gray-200 shadow-sm dark:bg-white/5 dark:border-white/10">
                Слухаємо нові івенти
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={runJob}
            disabled={running}
            className="relative inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-900 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-200 disabled:opacity-60 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-100 dark:shadow-[0_10px_30px_-12px_rgba(16,185,129,0.7)] dark:hover:border-emerald-300/60 dark:hover:bg-emerald-500/25"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-200 text-emerald-800 text-sm dark:bg-emerald-400/20 dark:text-emerald-200">
              ↺
            </span>
            {running ? 'Запускаємо…' : 'Оновити статистику'}
          </button>
        </div>
        {jobInfo && (
          <p className="relative mt-3 text-sm text-emerald-700 dark:text-emerald-200">
            {jobInfo}
          </p>
        )}
        {jobError && <p className="relative mt-3 text-sm text-red-600 dark:text-red-400">{jobError}</p>}
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-white">Фільтри</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Оберіть тип і спосіб сортування, щоб швидко знаходити потрібні івенти.
            </p>
          </div>
          <div className="text-xs text-slate-500 dark:text-gray-400">
            Показано: <span className="font-semibold text-slate-800 dark:text-white">{visibleItems.length}</span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">
            Тип
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:focus:border-emerald-400 dark:focus:ring-emerald-500/30"
            >
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Усі типи' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">
            Сортування
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:focus:border-emerald-400 dark:focus:ring-emerald-500/30"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {loading && <p className="text-sm text-gray-600">Завантаження…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !items.length && !error && (
        <p className="text-sm text-gray-600">Поки що немає завершених івентів.</p>
      )}
      {!loading && items.length > 0 && !visibleItems.length && !error && (
        <p className="text-sm text-gray-600">Нічого не знайдено для обраних фільтрів.</p>
      )}
      <div className="grid gap-4">
        {visibleItems.map((item) => (
          <PriceReactionCard key={item.eventId} item={item} />
        ))}
      </div>
    </div>
  );
}
