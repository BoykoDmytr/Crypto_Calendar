import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';

export default function SuggestEdit(){
  const { id } = useParams();
  const nav = useNavigate();
  const [ev, setEv] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{ (async()=>{
    const { data, error } = await supabase
      .from('events_approved')
      .select('*')
      .eq('id', id)
      .single();
    if(!error) setEv(data);
    setLoading(false);
  })() },[id]);

  const submit = async (payload) => {
    // що можна редагувати:
    const allowed = ['title','description','start_at','end_at','timezone','type','tge_exchanges','link'];
    const clean = Object.fromEntries(Object.entries(payload).filter(([k]) => allowed.includes(k)));

    const { error } = await supabase.from('event_edits_pending').insert({
      event_id: id,
      payload: clean,
      // submitter_email: ... (якщо потрібно)
    });
    if (error) return alert('Помилка: ' + error.message);
    alert('Дякуємо! Правку надіслано на модерацію.');
    nav('/events');
  };

  if (loading) return <p>Завантаження…</p>;
  if (!ev) return <p>Івент не знайдено.</p>;

  // попередньо заповнимо поля; для date/datetime підлаштовуй так, як у формі
  const initial = {
    ...ev,
    start_at: ev.type === 'Listing (TGE)'
      ? ev.start_at?.slice(0,10)          // YYYY-MM-DD
      : ev.start_at?.slice(0,16),         // YYYY-MM-DDTHH:mm
    end_at: ev.end_at ? ev.end_at.slice(0,16) : ''
  };

  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Запропонувати правку</h1>
      <div className="text-sm text-gray-500">Після модерації адміністратором зміни з’являться в івенті.</div>
      <div className="card p-4">
        <EventForm initial={initial} onSubmit={submit} loading={false} />
      </div>
    </div>
  );
}
