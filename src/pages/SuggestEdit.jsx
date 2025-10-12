// src/pages/Suggest.jsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';
import { toLocalInput } from '../utils/timeLocal'; // ← додаємо хелпер локалізації

export default function SuggestEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const [ev, setEv] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('events_approved')
        .select('*')
        .eq('id', id)
        .single();
      if (!error) setEv(data);
      setLoading(false);
    })();
  }, [id]);

  const submit = async (payload) => {
    // що можна редагувати
    const allowed = [
      'title',
      'description',
      'start_at',
      'end_at',
      'timezone',
      'type',
      'tge_exchanges',
      'link',
    ];
    const clean = Object.fromEntries(
      Object.entries(payload).filter(([k]) => allowed.includes(k))
    );

    const { error } = await supabase.from('event_edits_pending').insert({
      event_id: id,
      payload: clean,
      // submitter_email: ... (за потреби)
    });
    if (error) return alert('Помилка: ' + error.message);
    alert('Дякуємо! Правку надіслано на модерацію.');
    nav('/events');
  };

  if (loading) return <p>Завантаження…</p>;
  if (!ev) return <p>Івент не знайдено.</p>;

  const isTGE = ev?.type === 'Listing (TGE)';
  const tz = ev?.timezone || 'UTC';

  // ВАЖЛИВО: показуємо користувачу ЛОКАЛЬНИЙ час у його інпуті,
  // щоб значення не стрибало на −3 години
  const initial = {
    ...ev,
    start_at: isTGE
      ? toLocalInput(ev.start_at, tz, 'date')      // YYYY-MM-DD
      : toLocalInput(ev.start_at, tz, 'datetime'), // YYYY-MM-DDTHH:mm
    end_at: ev.end_at ? toLocalInput(ev.end_at, tz, 'datetime') : '',
  };

  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Запропонувати правку</h1>
      <div className="text-sm text-gray-500">
        Після модерації адміністратором зміни з’являться в івенті.
      </div>
      <div className="card p-4">
        <EventForm initial={initial} onSubmit={submit} loading={false} />
      </div>
    </div>
  );
}
