import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV = 'Europe/Kyiv';

function startOfGrid(monthStart) {
  // починаємо з понеділка тижня, що перетинає 1-е число
  let d = monthStart.startOf('month');
  const weekday = (d.day() + 6) % 7; // 0 = Mon
  return d.subtract(weekday, 'day');
}
function endOfGrid(monthStart) {
  const end = monthStart.endOf('month');
  const weekday = (end.day() + 6) % 7; // 0 = Mon
  return end.add(6 - weekday, 'day');
}

export default function MonthCalendar() {
  const [monthCursor, setMonthCursor] = useState(dayjs()); // поточний місяць
  const [events, setEvents] = useState([]);
  const [selectedISO, setSelectedISO] = useState(dayjs().format('YYYY-MM-DD'));
  const [loading, setLoading] = useState(true);

  // 1) тягнемо всі схвалені події
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('events_approved')
        .select('*')
        .order('start_at', { ascending: true });
      if (!error) setEvents(data || []);
      setLoading(false);
    })();
  }, []);

  // 2) групуємо по даті з урахуванням зони кожної події:
  //    якщо подія зі зоною 'Kyiv' — беремо дату у київському часі,
  //    інакше — у UTC.
  const byDate = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const base = dayjs.utc(ev.start_at);
      const local = ev.timezone === 'Kyiv' ? base.tz(KYIV) : base; // UTC by default
      const key = local.format('YYYY-MM-DD');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    // На випадок TGE — відсортуємо біржі вже на рендері EventCard
    return map;
  }, [events]);

  // 3) побудова сітки місяця
  const gridStart = startOfGrid(monthCursor);
  const gridEnd = endOfGrid(monthCursor);
  const days = [];
  for (let d = gridStart; d.isBefore(gridEnd) || d.isSame(gridEnd, 'day'); d = d.add(1, 'day')) {
    days.push(d);
  }

  const selectedEvents = byDate.get(selectedISO) || [];

  return (
    <div className="space-y-4">
      {/* Заголовок місяця + навігація */}
      <div className="flex items-center justify-between">
        <button
          className="btn-secondary px-3 py-2 rounded-xl"
          onClick={() => setMonthCursor(m => m.subtract(1, 'month'))}
        >
          ←
        </button>
        <h1 className="text-xl font-semibold">
          {monthCursor.format('MMMM YYYY')}
        </h1>
        <button
          className="btn-secondary px-3 py-2 rounded-xl"
          onClick={() => setMonthCursor(m => m.add(1, 'month'))}
        >
          →
        </button>
      </div>

      {/* Сітка днів (мобільно-дружня, але й на десктопі гарно) */}
      <div className="grid grid-cols-7 gap-2 text-xs text-gray-500">
        {['Mo','Tu','We','Th','Fr','Sa','Su'].map((w) => (
          <div key={w} className="text-center py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map(d => {
          const iso = d.format('YYYY-MM-DD');
          const inMonth = d.month() === monthCursor.month();
          const has = (byDate.get(iso) || []).length > 0;
          const isSelected = iso === selectedISO;

          return (
            <button
              key={iso}
              onClick={() => setSelectedISO(iso)}
              className={[
                'rounded-xl border p-3 h-24 text-left relative focus:outline-none',
                inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400',
                isSelected ? 'ring-2 ring-brand-500 border-transparent' : 'border-gray-200',
              ].join(' ')}
            >
              <div className="text-sm font-medium">{d.date()}</div>
              {has && <div className="absolute right-2 bottom-2 w-2 h-2 rounded-full bg-brand-500" />}
            </button>
          );
        })}
      </div>

      {/* Події на обрану дату */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Події на {dayjs(selectedISO).format('DD MMM YYYY')}
          </h2>
          {loading && <span className="text-sm text-gray-500">Завантаження…</span>}
        </div>
        {selectedEvents.length === 0 ? (
          <p className="text-sm text-gray-600 mt-2">Немає подій на цю дату.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {selectedEvents.map(ev => <EventCard key={ev.id} ev={ev} />)}
          </div>
        )}
      </div>
    </div>
  );
}
