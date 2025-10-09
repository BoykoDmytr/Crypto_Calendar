import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { Link } from 'react-router-dom';

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV = 'Europe/Kyiv';

function startOfGrid(monthStart) {
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
  const [monthCursor, setMonthCursor] = useState(dayjs());
  const [events, setEvents] = useState([]);
  const [selectedISO, setSelectedISO] = useState(dayjs().format('YYYY-MM-DD'));
  const [loading, setLoading] = useState(true);

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

  const byDate = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const base = dayjs.utc(ev.start_at);
      const local = ev.timezone === 'Kyiv' ? base.tz(KYIV) : base; // UTC за замовч.
      const key = local.format('YYYY-MM-DD');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events]);

  const gridStart = startOfGrid(monthCursor);
  const gridEnd = endOfGrid(monthCursor);
  const days = [];
  for (let d = gridStart; d.isBefore(gridEnd) || d.isSame(gridEnd, 'day'); d = d.add(1, 'day')) {
    days.push(d);
  }

  const selectedEvents = byDate.get(selectedISO) || [];
  const todayISO = dayjs().format('YYYY-MM-DD');

  return (
    <div className="overflow-x-hidden space-y-3 sm:space-y-4">
      {/* Заголовок місяця + навігація */}
      <div className="flex items-center justify-between mt-2 sm:mt-0">
        <button
          className="px-3 py-2 rounded-xl border border-gray-200 bg-white active:scale-[.98]"
          onClick={() => setMonthCursor(m => m.subtract(1, 'month'))}
        >←</button>
        <h1 className="text-lg sm:text-xl font-semibold">
          {monthCursor.format('MMMM YYYY')}
        </h1>
        <button
          className="px-3 py-2 rounded-xl border border-gray-200 bg-white active:scale-[.98]"
          onClick={() => setMonthCursor(m => m.add(1, 'month'))}
        >→</button>
      </div>

      {/* Заголовки днів тижня */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2 text-[11px] sm:text-xs text-gray-500 px-0.5">
        {['Mo','Tu','We','Th','Fr','Sa','Su'].map(w => (
          <div key={w} className="text-center py-1">{w}</div>
        ))}
      </div>

      {/* Сітка місяця */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {days.map(d => {
          const iso = d.format('YYYY-MM-DD');
          const inMonth = d.month() === monthCursor.month();
          const has = (byDate.get(iso) || []).length > 0;
          const isSelected = iso === selectedISO;
          const isToday = iso === todayISO;

          return (
            <button
              key={iso}
              onClick={() => setSelectedISO(iso)}
              className={[
                'relative rounded-xl border select-none',
                'h-12 sm:h-24 p-1 sm:p-3 text-left',
                inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400',
                isSelected ? 'ring-2 ring-brand-500 border-transparent' : 'border-gray-200',
                isToday && !isSelected ? 'outline outline-1 outline-brand-200' : '',
              ].join(' ')}
            >
              <div className="text-[12px] sm:text-sm font-medium">{d.date()}</div>
              {has && <div className="absolute right-1.5 bottom-1.5 w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-brand-500" />}
            </button>
          );
        })}
      </div>

      <div className="pt-1"> <Link to="/add" className="btn w-full sm:w-auto">+ Додати івент</Link> </div>
      
      {/* Події на обрану дату */}
      <div className="mt-2 sm:mt-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm sm:text-base">
            Події на {dayjs(selectedISO).format('DD MMM YYYY')}
          </h2>
          {loading && <span className="text-xs text-gray-500">Завантаження…</span>}
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
