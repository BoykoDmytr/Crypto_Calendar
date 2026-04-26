// src/pages/Calendar.jsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import TelegramCTA from '../components/TelegramCTA';
import { compareMinutes, timeStringToMinutes } from '../utils/time';
import { toEventLocal, eventDateKey } from '../utils/eventTime';
import { useReactionsBatch } from '../hooks/useReactionsBatch';

// ───────────────────────────────── Filter scroller (стрілки) ─────────────────────────────────
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

const PAST_EVENTS_BATCH_SIZE = 5;
const PAST_WINDOW_DAYS = 90;
const EVENT_COLUMNS = 'id,title,description,start_at,end_at,timezone,type,event_type_slug,link,tge_exchanges,coins,coin_name,coin_quantity,coin_price_link,coin_pct_circ,show_mcap,nickname';

export default function Calendar() {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [visiblePastCount, setVisiblePastCount] = useState(PAST_EVENTS_BATCH_SIZE);
  const [oldestLoadedDays, setOldestLoadedDays] = useState(PAST_WINDOW_DAYS);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [now, setNow] = useState(dayjs());
  const touchStartRef = useRef(null);
  const pastPanelRef = useRef(null);
  const [pastPanelMaxHeight, setPastPanelMaxHeight] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [moderationNotice, setModerationNotice] = useState(
    () => location.state?.showModerationNotice ?? false
  );

  useEffect(() => {
    if (location.state?.showModerationNotice) {
      setModerationNotice(true);
      const nextState = { ...location.state };
      delete nextState.showModerationNotice;
      navigate(location.pathname, { replace: true, state: nextState });
    }
  }, [location, navigate]);

  const [eventTypes, setEventTypes] = useState([]);
  const [type, setType] = useState('All');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const sinceISO = dayjs().subtract(PAST_WINDOW_DAYS, 'day').toISOString();
      const [ev, et] = await Promise.all([
        supabase
          .from('events_approved')
          .select(EVENT_COLUMNS)
          .gte('start_at', sinceISO)
          .order('start_at', { ascending: true }),
        supabase
          .from('event_types')
          .select('label, slug, is_tge, active, order_index, sort_order')
          .eq('active', true),
      ]);

      if (!ev.error) setAllEvents(ev.data || []);

      if (!et.error) {
        const rows = (et.data || []).slice();
        rows.sort((a, b) => {
          const ao = (a.sort_order ?? a.order_index ?? 0);
          const bo = (b.sort_order ?? b.order_index ?? 0);
          if (ao !== bo) return ao - bo;
          return String(a.label || '').localeCompare(String(b.label || ''));
        });

        setEventTypes(
          rows.map(x => ({
            label: x.label,
            slug: x.slug,
            is_tge: !!x.is_tge,
          }))
        );
      }

      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(dayjs()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(
    () => (type === 'All' ? allEvents : allEvents.filter((ev) => ev.type === type)),
    [allEvents, type]
  );

  const allEventIds = useMemo(
    () => allEvents.map((ev) => ev?.id).filter(Boolean),
    [allEvents]
  );
  const { reactionsMap, onReact } = useReactionsBatch(allEventIds);

  // ✅ FIX: Групуємо по даті в TZ ІВЕНТУ, а не браузера
  const groups = useMemo(() => {
    const map = new Map();
    for (const ev of filtered) {
      const tz = ev.timezone || 'UTC';
      const key = eventDateKey(ev.start_at, tz); // ← використовуємо TZ івенту
      if (!key) continue;

      const local = toEventLocal(ev.start_at, tz);
      const item =
        map.get(key) ??
        {
          key,
          label: local ? local.format('DD MMM (ddd)') : key,
          items: [],
        };
      item.items.push(ev);
      map.set(key, item);
    }

    const getStartMinutes = (event) => {
      const tz = event?.timezone || 'UTC';
      const local = toEventLocal(event?.start_at, tz);
      if (!local) return Number.POSITIVE_INFINITY;
      const hours = local.hour();
      const minutes = local.minute();
      if (hours === 0 && minutes === 0) return Number.POSITIVE_INFINITY;
      return hours * 60 + minutes;
    };

    const getBadgeMinutes = (event) => {
      if (!Array.isArray(event?.tge_exchanges)) return Number.POSITIVE_INFINITY;
      let best = Number.POSITIVE_INFINITY;
      for (const ex of event.tge_exchanges) {
        const candidate = timeStringToMinutes(ex?.time);
        if (candidate < best) best = candidate;
      }
      return best;
    };

    const byTime = (a, b) => {
      const startDiff = compareMinutes(getStartMinutes(a), getStartMinutes(b));
      if (startDiff !== 0) return startDiff;

      const badgeDiff = compareMinutes(getBadgeMinutes(a), getBadgeMinutes(b));
      if (badgeDiff !== 0) return badgeDiff;

      const titleA = a?.title || '';
      const titleB = b?.title || '';
      return titleA.localeCompare(titleB);
    };

    return Array.from(map.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((group) => ({
        ...group,
        items: group.items.slice().sort(byTime),
      }));
  }, [filtered]);

  const todayStart = useMemo(() => now.startOf('day'), [now]);
  const todayStartValue = todayStart.valueOf();

  const { pastGroups, upcomingGroups } = useMemo(() => {
    const past = [];
    const upcoming = [];
    for (const group of groups) {
      const groupDateValue = dayjs(group.key).startOf('day').valueOf();
      if (groupDateValue < todayStartValue) {
        past.push(group);
      } else {
        upcoming.push(group);
      }
    }

    past.reverse();

    return { pastGroups: past, upcomingGroups: upcoming };
  }, [groups, todayStartValue]);

  const hasPast = pastGroups.length > 0;
  const hasUpcoming = upcomingGroups.length > 0;
  const latestPastMonthLabel = hasPast
    ? dayjs(pastGroups[0].key).format('MMMM YYYY')
    : '';

  const totalPastEvents = useMemo(
    () => pastGroups.reduce((sum, group) => sum + group.items.length, 0),
    [pastGroups]
  );

  const visiblePastGroups = useMemo(() => {
    if (visiblePastCount >= totalPastEvents) return pastGroups;

    const limited = [];
    let remaining = visiblePastCount;

    for (const group of pastGroups) {
      if (remaining <= 0) break;
      const takeCount = Math.min(remaining, group.items.length);
      const items = group.items.slice(0, takeCount);
      limited.push({ ...group, items });
      remaining -= takeCount;
    }

    return limited;
  }, [pastGroups, totalPastEvents, visiblePastCount]);

  const shownPastCount = Math.min(visiblePastCount, totalPastEvents);
  const canLoadMorePast = visiblePastCount < totalPastEvents;

  useEffect(() => {
    if (!hasPast && showPast) {
      setShowPast(false);
    }
  }, [hasPast, showPast]);

  useEffect(() => {
    setVisiblePastCount(PAST_EVENTS_BATCH_SIZE);
  }, [pastGroups]);

  const openPast = useCallback(() => {
    setShowPast(true);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const closePast = useCallback(() => {
    setShowPast(false);
    setVisiblePastCount(PAST_EVENTS_BATCH_SIZE);
  }, []);

  const handleLoadMorePast = useCallback(() => {
    setVisiblePastCount((prev) => Math.min(prev + PAST_EVENTS_BATCH_SIZE, totalPastEvents));
  }, [totalPastEvents]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder) return;
    setLoadingOlder(true);
    try {
      const fromDays = oldestLoadedDays + PAST_WINDOW_DAYS;
      const sinceISO = dayjs().subtract(fromDays, 'day').toISOString();
      const untilISO = dayjs().subtract(oldestLoadedDays, 'day').toISOString();
      const { data, error } = await supabase
        .from('events_approved')
        .select(EVENT_COLUMNS)
        .gte('start_at', sinceISO)
        .lt('start_at', untilISO)
        .order('start_at', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      setOldestLoadedDays(fromDays);
      if (rows.length === 0) {
        setHasMoreOlder(false);
      } else {
        setAllEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const merged = prev.slice();
          for (const r of rows) {
            if (!seen.has(r.id)) merged.push(r);
          }
          merged.sort((a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
          );
          return merged;
        });
        setVisiblePastCount((prev) => prev + rows.length);
      }
    } catch (err) {
      console.error('[calendar] loadOlder failed', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMoreOlder, loadingOlder, oldestLoadedDays]);

  const updatePastPanelMaxHeight = useCallback(() => {
    if (!showPast) return;
    const panel = pastPanelRef.current;
    if (!panel) return;

    const prev = panel.style.maxHeight;
    panel.style.maxHeight = 'none';
    const measured = panel.scrollHeight;
    panel.style.maxHeight = prev;

    const nextHeight = measured + 48;

    if (nextHeight > 0) {
      setPastPanelMaxHeight((current) =>
        current != null && Math.abs(current - nextHeight) < 1 ? current : nextHeight
      );
    }
  }, [showPast]);


  useLayoutEffect(() => {
    if (!showPast) return;
    updatePastPanelMaxHeight();
  }, [showPast, visiblePastGroups, updatePastPanelMaxHeight]);

  useEffect(() => {
    if (!showPast) return;
    const handleResize = () => {
      updatePastPanelMaxHeight();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showPast, updatePastPanelMaxHeight]);

  useEffect(() => {
    if (!hasPast) return;

    const handleWheel = (event) => {
      if (showPast) return;
      if (typeof window === 'undefined') return;
      if (window.scrollY <= 2 && event.deltaY < -24) {
        openPast();
      }
    };

    const handleTouchStart = (event) => {
      if (showPast) return;
      if (typeof window === 'undefined') return;
      if (window.scrollY <= 2) {
        touchStartRef.current = event.touches?.[0]?.clientY ?? null;
      } else {
        touchStartRef.current = null;
      }
    };

    const handleTouchMove = (event) => {
      if (showPast) return;
      const startY = touchStartRef.current;
      if (startY == null) return;
      const currentY = event.touches?.[0]?.clientY ?? startY;
      if (currentY - startY > 30) {
        touchStartRef.current = null;
        openPast();
      }
    };

    const handleTouchEnd = () => {
      touchStartRef.current = null;
    };

     const shouldHandleTouch = (() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
      }
      const prefersCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
      return !prefersCoarsePointer;
    })();

    window.addEventListener('wheel', handleWheel, { passive: true });
    if (shouldHandleTouch) {
      window.addEventListener('touchstart', handleTouchStart, { passive: true });
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    return () => {
      window.removeEventListener('wheel', handleWheel);
      if (shouldHandleTouch) {
        window.removeEventListener('touchstart', handleTouchStart);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [hasPast, openPast, showPast]);

  const renderSections = (groupList, variant) => {
    let prevMonth = null;
    return groupList.map((g) => {
      const monthLabel = dayjs(g.key).format('MMMM YYYY');
      const isNewMonth = monthLabel !== prevMonth;
      prevMonth = monthLabel;
      const headingText = variant === 'past' ? `Earlier in ${monthLabel}` : monthLabel;
      const lineClass =
        variant === 'past'
          ? 'bg-gradient-to-r from-transparent via-zinc-300 to-transparent dark:via-zinc-700'
          : 'bg-gradient-to-r from-transparent via-zinc-400 to-transparent dark:via-zinc-600';
      const headingClass =
        variant === 'past'
          ? 'text-xs md:text-sm font-semibold uppercase tracking-[0.45em] text-center text-zinc-600 dark:text-zinc-400'
          : 'text-sm md:text-base font-extrabold uppercase tracking-widest text-center text-zinc-900 dark:text-white drop-shadow-none dark:drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]';

      return (
        <section key={`${variant}-${g.key}`}>
          {isNewMonth && (
            <div className="mb-6">
              <div className="flex flex-wrap items-center justify-center gap-3 text-center">
                <div className={`h-px flex-1 min-w-[32px] ${lineClass}`} aria-hidden="true" />
                <div className={headingClass}>{headingText}</div>
                <div className={`h-px flex-1 min-w-[32px] ${lineClass}`} aria-hidden="true" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            {g.items.map((ev) => (
              <EventCard
                key={ev.id}
                ev={ev}
                isPast={variant === 'past'}
                reaction={reactionsMap.get(ev.id) ?? { likes: 0, dislikes: 0, myReaction: null }}
                onReact={onReact}
              />
            ))}
          </div>
        </section>
      );
    });
  };

  return (
    <div className="events-page space-y-4 sm:space-y-6">
      {/* --- HERO-БАНЕР --- */}
      <section className="-mx-3 sm:-mx-4">
        <div className="relative h-28 sm:h-40 rounded-b-2xl overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "url('/hero-events.jpg')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/40" />
          <div className="relative h-full flex items-end sm:items-center px-3 sm:px-4">
            <h1 className="text-white font-extrabold text-2xl sm:text-4xl drop-shadow">
              Events
            </h1>
          </div>
        </div>
      </section>

      {/* --- РЯД ФІЛЬТРІВ + КНОПКА (sticky) --- */}
      <div className="sticky sticky-filters top-14 z-[5] -mx-3 sm:-mx-4 px-3 sm:px-4 pt-0 pb-0">
        <FilterScroller>
          <button
            onClick={() => setType('All')}
            className={`chip ${type === 'All' ? 'chip--active' : ''}`}
          >
            All
          </button>

          {eventTypes.map((t) => (
            <button
              key={t.slug}
              onClick={() => setType(t.label)}
              className={`chip ${type === t.label ? 'chip--active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </FilterScroller>
      </div>

      {/* --- СПИСОК ПОДІЙ --- */}
      {loading && <p className="text-sm text-gray-500 px-3 sm:px-4">Завантаження…</p>}
      {!loading && !hasUpcoming && (
        <p className="text-sm text-gray-600 px-3 sm:px-4">
          Немає майбутніх подій за цим фільтром.
        </p>
      )}

      {hasPast && (
        <div className="px-3 sm:px-4">
          {!showPast && (
            <button
              type="button"
              onClick={openPast}
              className="past-pull-hint"
            >
              <span className="past-pull-hint__label past-pull-hint__label--desktop">Потягніть вгору, щоб побачити минулі події</span>
              <span className="past-pull-hint__label past-pull-hint__label--mobile">Натисність, щоб побачити минулі події</span>
              {latestPastMonthLabel && (
                <span className="past-pull-hint__sub">Останні: {latestPastMonthLabel}</span>
              )}
              <span className="past-pull-hint__icon" aria-hidden="true">↑</span>
            </button>
          )}
          <div
            ref={pastPanelRef}
            className={`past-events-panel ${showPast ? 'past-events-panel--open' : ''}`}
            style={
              showPast && pastPanelMaxHeight != null
                ? {
                    '--past-panel-max-height':
                      pastPanelMaxHeight != null ? `${pastPanelMaxHeight}px` : '9999px',
                  }
                : undefined
            }
          >
            <div className="past-events-panel__header">
              <div>
                <p className="past-events-panel__title">Минулі події</p>
                <p className="past-events-panel__subtitle">
                  Показано {shownPastCount} з {totalPastEvents} подій
                </p>
              </div>
              <button type="button" onClick={closePast} className="past-events-panel__close">
                Сховати
              </button>
            </div>

            <div className="space-y-6">
              {renderSections(visiblePastGroups, 'past')}
            </div>
            {canLoadMorePast && (
              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMorePast}
                  className="btn h-9 px-4 text-sm"
                >
                  Показати більше
                </button>
              </div>
            )}
            {!canLoadMorePast && hasMoreOlder && (
              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="btn h-9 px-4 text-sm disabled:opacity-60"
                >
                  {loadingOlder ? 'Завантаження…' : 'Завантажити старіші події'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}


              <div className="space-y-6 px-3 sm:px-4">
        {hasUpcoming ? (
          renderSections(upcomingGroups, 'future')
        ) : (
          !loading && (
            <p className="text-sm text-gray-600">
              Перегляньте минулі події вище або змініть фільтр.
            </p>
          )
        )}
      </div>

      {moderationNotice && (
        <div className="px-3 sm:px-4">
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 shadow-sm">
            ✅Івент було відправлено на модерацію
          </div>
        </div>
      )}

      <div className="px-3 sm:px-4 pb-2 flex justify-center">
        <TelegramCTA communityHref={import.meta.env.VITE_TG_CHANNEL_URL || 'https://t.me/cryptohornettg'} />
      </div>
    </div>
  );
}