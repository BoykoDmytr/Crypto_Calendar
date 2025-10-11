// src/pages/Calendar.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import TelegramCTA from '../components/TelegramCTA';

// посилання беруться з .env (за потреби підстав фолбеки)
const TG_COMMUNITY = import.meta.env.VITE_TG_COMMUNITY_URL || 'https://t.me/yourcommunity';
const TG_CHAT      = import.meta.env.VITE_TG_CHAT_URL || 'https://t.me/yourchat';

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

  // типи з БД (довідник подій)
  const [eventTypes, setEventTypes] = useState([]); // [{label, slug, ...}]
  const [type, setType] = useState('All');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [ev, et] = await Promise.all([
        supabase.from('events_approved')
          .select('*')
          .order('start_at', { ascending: true }),
        supabase.from('event_types')
          .select('label, slug, is_tge, active')
          .eq('active', true)
          .order('sort_order', { ascending: true })
      ]);

      if (!ev.error) setAllEvents(ev.data || []);
      if (!et.error) setEventTypes((et.data || []).map(x => ({ label: x.label, slug: x.slug, is_tge: !!x.is_tge })));
      setLoading(false);
    })();
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
        map.get(key) ?? {
          key,
          label: d.format('DD MMM (ddd)'),
          items: [],
        };
      item.items.push(ev);
      map.set(key, item);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  return (
    <div className="space-y-4 sm:space-y-6">
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
      {loading && (
        <p className="text-sm text-gray-500 px-3 sm:px-4">Завантаження…</p>
      )}
      {!loading && groups.length === 0 && (
        <p className="text-sm text-gray-600 px-3 sm:px-4">
          Немає подій за цим фільтром.
        </p>
      )}

      <div className="space-y-6 px-3 sm:px-4">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
              <div className="font-semibold text-gray-700">{g.label}</div>
              <div className="h-px bg-gray-200 flex-1" />
            </div>

            <div className="space-y-2">
              {g.items.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ── КНОПКИ TELEGRAM ВНИЗУ ─────────────────────────────────────────────── */}
      <div className="px-3 sm:px-4 pb-2 flex justify-center">
        <TelegramCTA href={import.meta.env.VITE_TG_CHANNEL_URL || 'https://t.me/your_channel'} />
      </div>
    </div>
  );
}
