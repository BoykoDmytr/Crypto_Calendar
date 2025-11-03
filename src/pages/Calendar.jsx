// src/pages/Calendar.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import TelegramCTA from '../components/TelegramCTA';
import { compareMinutes, timeStringToMinutes } from '../utils/time';

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

      {/* Ліва / права кнопки — лише на ПК */}
      <button
        type="button"
        onClick={() => by(-240)}
        className="hidden md:flex absolute -left-6 top-1/2 -translate-y-1/2
                   w-9 h-9 rounded-full border bg-white shadow-sm hover:bg-gray-50
                   items-center justify-center"
        aria-label="Прокрутити ліворуч"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => by(240)}
        className="hidden md:flex absolute -right-6 top-1/2 -translate-y-1/2
                   w-9 h-9 rounded-full border bg-white shadow-sm hover:bg-gray-50
                   items-center justify-center"
        aria-label="Прокрутити праворуч"
      >
        ›
      </button>
    </div>
  );
}

export default function Calendar() {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [now, setNow] = useState(dayjs());
  const touchStartRef = useRef(null);
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

  // типи з БД (довідник подій)
  const [eventTypes, setEventTypes] = useState([]); // [{label, slug, is_tge, order_index?, sort_order?}]
  const [type, setType] = useState('All');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [ev, et] = await Promise.all([
        supabase
          .from('events_approved')
          .select('*')
          .order('start_at', { ascending: true }),
        // тягнемо обидва поля сортування
        supabase
          .from('event_types')
          .select('label, slug, is_tge, active, order_index, sort_order')
          .eq('active', true),
      ]);

      if (!ev.error) setAllEvents(ev.data || []);

      if (!et.error) {
        const rows = (et.data || []).slice();

        // сортуємо за sort_order ?? order_index, далі — за назвою
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

  // застосовуємо фільтр за типом (у подіях поле ev.type містить людську назву типу)
  const filtered = useMemo(
    () => (type === 'All' ? allEvents : allEvents.filter((ev) => ev.type === type)),
    [allEvents, type]
  );

  // групування за датою + день тижня
  const groups = useMemo(() => {
    const map = new Map();
    for (const ev of filtered) {
      const d = dayjs(ev.start_at);
      const key = d.format('YYYY-MM-DD');
      const item =
        map.get(key) ??
        {
          key,
          label: d.format('DD MMM (ddd)'),
          items: [],
        };
      item.items.push(ev);
      map.set(key, item);
    }
    const getStartMinutes = (event) => {
      const start = event?.start_at ? dayjs(event.start_at) : null;
      if (!start) return Number.POSITIVE_INFINITY;
      const hours = start.hour();
      const minutes = start.minute();
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
    return { pastGroups: past, upcomingGroups: upcoming };
  }, [groups, todayStartValue]);

  const hasPast = pastGroups.length > 0;
  const hasUpcoming = upcomingGroups.length > 0;
  const latestPastMonthLabel = hasPast
    ? dayjs(pastGroups[pastGroups.length - 1].key).format('MMMM YYYY')
    : '';

  useEffect(() => {
    if (!hasPast && showPast) {
      setShowPast(false);
    }
  }, [hasPast, showPast]);

  const openPast = useCallback(() => {
    setShowPast(true);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const closePast = useCallback(() => {
    setShowPast(false);
  }, []);

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
      // Disable the swipe gesture on phone-sized, coarse-pointer devices per product request.
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
              <EventCard key={ev.id} ev={ev} isPast={variant === 'past'} />
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
      <div className="sticky top-14 z-[5] -mx-3 sm:-mx-4 px-3 sm:px-4 pt-0 pb-0 bg-transparent">
        <FilterScroller>
          {/* All */}
          <button
            onClick={() => setType('All')}
            className={`px-3 py-1.5 rounded-full border text-sm whitespace-nowrap ${
              type === 'All'
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
          >
            All
          </button>

          {/* Динамічні типи з БД (лише активні) */}
          {eventTypes.map((t) => (
            <button
              key={t.slug}
              onClick={() => setType(t.label)}
              className={`px-3 py-1.5 rounded-full border text-sm whitespace-nowrap ${
                type === t.label
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </FilterScroller>

        {/* Кнопка «Додати івент» під фільтрами */}
        <div className="mt-3">
          <Link to="/add" className="btn h-9 px-3 text-sm w-full sm:w-auto">
            + Додати івент
          </Link>
        </div>
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
          <div className={`past-events-panel ${showPast ? 'past-events-panel--open' : ''}`}>
            <div className="past-events-panel__header">
              <div>
                <p className="past-events-panel__title">Минулі події</p>
                <p className="past-events-panel__subtitle">
                </p>
              </div>
              <button type="button" onClick={closePast} className="past-events-panel__close">
                Сховати
              </button>
            </div>

            <div className="space-y-6">
              {renderSections(pastGroups, 'past')}
            </div>
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

      {/* ── КНОПКА TELEGRAM ВНИЗУ ─────────────────────────────────────────────── */}
      <div className="px-3 sm:px-4 pb-2 flex justify-center">
        <TelegramCTA href={import.meta.env.VITE_TG_CHANNEL_URL || 'https://t.me/your_channel'} />
      </div>
    </div>
  );
}
