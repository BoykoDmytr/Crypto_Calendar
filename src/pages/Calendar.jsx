// src/pages/Calendar.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import TelegramCTA from '../components/TelegramCTA';

// наші типи з БД (точні значення!)
const TYPES = [
  'Listing (TGE)',
  'Binance Alpha',
  'OKX Alpha',
  'Token Sales',
  'Claim / Airdrop',
  'Unlocks',
];

export default function Calendar() {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('All'); // фільтр

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('events_approved')
        .select('*')
        .order('start_at', { ascending: true });
      if (!error) setAllEvents(data || []);
      setLoading(false);
    })();
  }, []);

  // застосовуємо фільтр за типом
  const filtered = useMemo(
    () => (type === 'All' ? allEvents : allEvents.filter((ev) => ev.type === type)),
    [allEvents, type]
  );

  // групуємо за датою + додаємо день тижня в лейбл
  const groups = useMemo(() => {
    const map = new Map();
    for (const ev of filtered) {
      const d = dayjs(ev.start_at); // без примусової зміни TZ
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
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* --- HERO-БАНЕР З ФОНОМ --- */}
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
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
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

          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-full border text-sm whitespace-nowrap ${
                type === t
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Кнопка одразу під фільтрами без зайвих відступів */}
        <div className="mt-3">
          <Link to="/add" className="btn h-9 px-3 text-sm w-full sm:w-auto">
            + Додати івент
          </Link>
        </div>
      </div>

      {/* --- СПИСОК ПОДІЙ --- */}
      {loading && <p className="text-sm text-gray-500 px-3 sm:px-4">Завантаження…</p>}
      {!loading && groups.length === 0 && (
        <p className="text-sm text-gray-600 px-3 sm:px-4">Немає подій за цим фільтром.</p>
      )}

      <div className="space-y-6 px-3 sm:px-4">
        {groups.map((g) => (
          <section key={g.key}>
            {/* шапка дня з днем тижня */}
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
    {/* ✅ Telegram CTA – під фільтрами, перед списком подій */}
      <div className="px-3 sm:px-4">
        <TelegramCTA
          href={import.meta.env.VITE_TG_CHANNEL_URL || 'https://t.me/your_channel'}
        />
      </div>
    </div>
  );
}
