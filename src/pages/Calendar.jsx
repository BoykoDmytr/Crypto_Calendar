import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';

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

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Івенти</h1>
      {loading && <p className="text-sm text-gray-500">Завантаження…</p>}
      {!loading && events.length===0 && <p className="text-sm text-gray-600">Поки що немає подій.</p>}
      <div className="space-y-2">
        {events.map(ev => <EventCard key={ev.id} ev={ev} />)}
      </div>
    </div>
  );
}
