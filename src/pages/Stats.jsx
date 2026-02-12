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
 * Supports filtering by event type and by pre/post/net returns as well as
 * event size relative to market cap.  A background timer periodically runs
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

  // Ranges for filtering; will be initialised once data is loaded.
  const [preRange, setPreRange] = useState({ min: -100, max: 100 });
  const [postRange, setPostRange] = useState({ min: -100, max: 100 });
  const [netRange, setNetRange] = useState({ min: -100, max: 100 });
  const [mcapRange, setMcapRange] = useState({ min: 0, max: 100 });
  const [sortOrder, setSortOrder] = useState('desc');
  // Store full ranges for resetting filters
  const fullRangesRef = useRef({ pre: null, post: null, net: null, mcap: null });

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

  // When items change, compute min/max ranges for filters and initialise if not set
  useEffect(() => {
    if (!items || !items.length) return;
    // compute min and max for each metric ignoring null/undefined
    const gather = (key) => items.map((it) => it[key]).filter((v) => v !== null && v !== undefined);
    const computeRange = (arr) => {
      if (!arr.length) return { min: 0, max: 0 };
      return { min: Math.min(...arr), max: Math.max(...arr) };
    };
    const preVals = gather('preReturn30m');
    const postVals = gather('postReturn30m');
    const netVals = gather('netReturn60m');
    const mcapVals = gather('eventPctMcap');
    fullRangesRef.current = {
      pre: computeRange(preVals),
      post: computeRange(postVals),
      net: computeRange(netVals),
      mcap: computeRange(mcapVals),
    };
    // initialise ranges only once when they are at defaults
    setPreRange((prev) => (prev && prev._init ? prev : { ...fullRangesRef.current.pre, _init: true }));
    setPostRange((prev) => (prev && prev._init ? prev : { ...fullRangesRef.current.post, _init: true }));
    setNetRange((prev) => (prev && prev._init ? prev : { ...fullRangesRef.current.net, _init: true }));
    setMcapRange((prev) => (prev && prev._init ? prev : { ...fullRangesRef.current.mcap, _init: true }));
  }, [items]);

  // Derive visible items based on filters
  const visibleItems = useMemo(() => {
    let filtered = items;
    if (typeFilter !== 'All') {
      filtered = filtered.filter((item) => item.type === typeFilter);
    }
    const inRange = (val, range) => {
      if (val === null || val === undefined) return true;
      return val >= range.min && val <= range.max;
    };
    filtered = filtered.filter((item) =>
      inRange(item.preReturn30m, preRange) &&
      inRange(item.postReturn30m, postRange) &&
      inRange(item.netReturn60m, netRange) &&
      inRange(item.eventPctMcap, mcapRange)
    );
    // sort by event size relative to mcap if specified
    const sorted = [...filtered];
    if (sortOrder === 'desc') {
      sorted.sort((a, b) => {
        const av = a.eventPctMcap ?? -Infinity;
        const bv = b.eventPctMcap ?? -Infinity;
        return bv - av;
      });
    } else if (sortOrder === 'asc') {
      sorted.sort((a, b) => {
        const av = a.eventPctMcap ?? Infinity;
        const bv = b.eventPctMcap ?? Infinity;
        return av - bv;
      });
    }
    return sorted;
  }, [items, typeFilter, preRange, postRange, netRange, mcapRange, sortOrder]);

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

  // Reset filters to full ranges
  const clearFilters = () => {
    const ranges = fullRangesRef.current;
    if (!ranges) return;
    setPreRange({ ...ranges.pre });
    setPostRange({ ...ranges.post });
    setNetRange({ ...ranges.net });
    setMcapRange({ ...ranges.mcap });
    setSortOrder('desc');
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
      <section className="rounded-2xl p-4 card space-y-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-gray-600 dark:text-gray-300">Pre return (%)</span>
            <div className="flex gap-1 items-center">
              <input
                type="number"
                step="0.01"
                value={preRange.min}
                onChange={(e) => setPreRange({ ...preRange, min: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
              <span>–</span>
              <input
                type="number"
                step="0.01"
                value={preRange.max}
                onChange={(e) => setPreRange({ ...preRange, max: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-gray-600 dark:text-gray-300">Post return (%)</span>
            <div className="flex gap-1 items-center">
              <input
                type="number"
                step="0.01"
                value={postRange.min}
                onChange={(e) => setPostRange({ ...postRange, min: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
              <span>–</span>
              <input
                type="number"
                step="0.01"
                value={postRange.max}
                onChange={(e) => setPostRange({ ...postRange, max: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-gray-600 dark:text-gray-300">Net return (%)</span>
            <div className="flex gap-1 items-center">
              <input
                type="number"
                step="0.01"
                value={netRange.min}
                onChange={(e) => setNetRange({ ...netRange, min: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
              <span>–</span>
              <input
                type="number"
                step="0.01"
                value={netRange.max}
                onChange={(e) => setNetRange({ ...netRange, max: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-gray-600 dark:text-gray-300">% of MCap</span>
            <div className="flex gap-1 items-center">
              <input
                type="number"
                step="0.01"
                value={mcapRange.min}
                onChange={(e) => setMcapRange({ ...mcapRange, min: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
              <span>–</span>
              <input
                type="number"
                step="0.01"
                value={mcapRange.max}
                onChange={(e) => setMcapRange({ ...mcapRange, max: Number(e.target.value) })}
                className="w-1/2 rounded border border-gray-300 dark:border-gray-600 px-1 py-0.5 bg-white dark:bg-[#0b0f1a]"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs mt-2">
          <span className="font-semibold text-gray-600 dark:text-gray-300">Sort by:</span>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a] text-sm"
          >
            <option value="desc">Event % of MCap (desc)</option>
            <option value="asc">Event % of MCap (asc)</option>
            <option value="none">None</option>
          </select>
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0b0f1a] hover:bg-gray-100 dark:hover:bg-[#121a31]"
          >
            Clear filters
          </button>
        </div>
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