import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);

export default function Calendar(){
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{ (async()=>{
    setLoading(true);
    const { data, error } = await supabase
      .from('events_approved')
      .select('*')
      .order('start_at',{ ascending: true });
    if(!error) setEvents(data||[]);
    setLoading(false);
  })() },[]);

  // Групуємо за ДАТОЮ В UTC (як у прикладі)
  const groups = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      dayjs.extend(timezone);
      const d = dayjs.utc(ev.start_at).tz('Europe/Kyiv');             // <-- групування за UTC
      const key = d.format('YYYY-MM-DD');
      const item = map.get(key) ?? {
        key,
        label: d.format('DD MMM'),
        year: d.format('YYYY'),
        items: []
      };
      item.items.push(ev);
      map.set(key, item);
    }
    return Array.from(map.values()).sort((a,b)=> a.key.localeCompare(b.key));
  }, [events]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Івенти</h1>

      {loading && <p className="text-sm text-gray-500">Завантаження…</p>}
      {!loading && groups.length===0 && (
        <p className="text-sm text-gray-600">Поки що немає подій.</p>
      )}

      <div className="space-y-6">
        {groups.map(g => (
          <section key={g.key}>
            {/* Рядок-шапка дня */}
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
              <div className="font-semibold text-gray-700">{g.label}</div>
              <div className="h-px bg-gray-200 flex-1" />
            </div>

            {/* Події цього дня */}
            <div className="space-y-2">
              {g.items.map(ev => <EventCard key={ev.id} ev={ev} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
