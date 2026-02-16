import { useEffect, useMemo, useRef, useState } from 'react';
import PriceReactionCard from '../components/PriceReactionCard';
import {
  fetchCompletedEvents,
  fetchStatsTypeFilters,
  triggerPriceReactionJob,
} from '../lib/statsApi';
import { supabase } from '../lib/supabase';

// A horizontal scroller for type filter buttons.
function FilterScroller({ children }) {
  const ref = useRef(null);
  const by = (px) => ref.current?.scrollBy({ left: px, behavior: 'smooth' });
  return (
    <div className="relative">
      <div
        ref={ref}
        className="overflow-x-auto no-scrollbar scroll-smooth flex gap-2 items-center px-8 md:px-10"
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => by(-240)}
        className="glass-icon-btn hidden md:flex absolute -left-6 top-1/2 -translate-y-1/2
                   items-center justify-center"
        aria-label="Прокрутити ліворуч"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => by(240)}
        className="glass-icon-btn hidden md:flex absolute -right-6 top-1/2 -translate-y-1/2
                   items-center justify-center"
        aria-label="Прокрутити праворуч"
      >
        ›
      </button>
    </div>
  );
}

/**
 * Stats page
 *
 * Displays completed events with their ±30m reaction curves and profit calculators.
 * Supports filtering by event type. A background timer periodically runs
 * the price reaction job and updates the list.  Users can also trigger
 * the job manually.
 */
export default function Stats() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [jobInfo, setJobInfo] = useState('');
  const [jobError, setJobError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('All');
  const statsFiltersRef = useRef({ slugs: [], typeNames: [] });

  // Compute available type options based on loaded items
  const typeOptions = useMemo(() => {
    const types = new Set();
    items.forEach((item) => {
      if (item.type) types.add(item.type);
    });
    return ['All', ...Array.from(types)];
  }, [items]);

  // Helper: load the list of completed events
  const loadItems = async () => {
    try {
      const [filters, data] = await Promise.all([
        fetchStatsTypeFilters(),
        fetchCompletedEvents(),
      ]);
      statsFiltersRef.current = filters;
      setItems(data);
    } catch (err) {
      setError(err.message || 'Не вдалося завантажити статистику');
    }
  };

  // Initialise list and set up periodic refresh and realtime listener
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [filters, data] = await Promise.all([
          fetchStatsTypeFilters(),
          fetchCompletedEvents(),
        ]);
        if (mounted) {
          statsFiltersRef.current = filters;
          setItems(data);
        }
      } catch (err) {
        setError(err.message || 'Не вдалося завантажити статистику');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    // periodic job run every 60 seconds
    const intervalId = setInterval(async () => {
      try {
        await triggerPriceReactionJob();
        await loadItems();
      } catch (err) {
        console.error('Автоматичний збір статистики помилився', err);
      }
    }, 60_000);
    // realtime listener for new events
    const channel = supabase
      .channel('stats_auto_add')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events_approved' },
        async (payload) => {
          const newEvent = payload.new;
          const { slugs = [], typeNames = [] } = statsFiltersRef.current || {};
          if (
            (newEvent.event_type_slug && slugs.includes(newEvent.event_type_slug)) ||
            (newEvent.type && typeNames.includes(newEvent.type))
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

  // Derive visible items based on filters
  const visibleItems = useMemo(() => {
    let filtered = items;
    if (typeFilter !== 'All') {
      filtered = filtered.filter((item) => item.type === typeFilter);
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const av = a.eventPctMcap ?? -Infinity;
      const bv = b.eventPctMcap ?? -Infinity;
      return bv - av;
    });
    return sorted;
  }, [items, typeFilter]);

  // Manual job runner
  const runJob = async () => {
    setRunning(true);
    setJobError(null);
    setJobInfo('');
    try {
      const summary = await triggerPriceReactionJob();
      setJobInfo(
        `Скан завершено: опрацьовано ${summary.processed}, нових ${summary.inserted}, ` +
        `оновлено ${summary.updated}, пропущено ${summary.skipped}.` +
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
    <div className="space-y-6">
      {/* header */}
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
                ±30 хв
              </span>
            </div>
            <h1 className="text-2xl font-bold">Статистика</h1>
            <p className="text-sm text-slate-700 dark:text-gray-300">
              Автоматичний трекінг івентів та їх цінових реакцій у вікні ±30 хвилин. Івенти з відстежуваних категорій додаються автоматично.
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
      {/* filters */}
      <section className="space-y-4">
        <FilterScroller>
          {typeOptions.map((option) => (
            <button
              key={option}
              onClick={() => setTypeFilter(option)}
              className={`chip ${typeFilter === option ? 'chip--active' : ''}`}
            >
              {option}
            </button>
          ))}
        </FilterScroller>
      </section>
      {/* content */}
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