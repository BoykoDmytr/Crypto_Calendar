// src/pages/AddEvent.jsx
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';
import Toast from '../components/Toast';
import { useNavigate } from 'react-router-dom'

export default function AddEvent() {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const navigate = useNavigate();

  // невелике прибирання: не відправляємо порожні/undefined поля
  const sanitize = (obj) =>
    Object.fromEntries(
      Object.entries(obj).filter(([k, v]) => {
        if (v === '' || v === undefined || v === null) return false;
        if (k === 'tge_exchanges' && Array.isArray(v) && v.length === 0) return false;
        if (k === 'coins' && Array.isArray(v) && v.length === 0) return false
        return true;
      })
    );

  const submit = async (form) => {
    try {
      setLoading(true);

      // EventForm вже робить:
      // - TGE: start_at = дата + (опц.) час (00:00, якщо не задано), без end_at
      // - Binance Alpha: дата + опційний час у start_at, без start_time
      // - Інші типи: стандартний datetime-local
      const payload = sanitize(form);

      // Нормалізуємо тип перед вставкою: інколи у формі може лишитися
      // невалідний slug (або людська назва замість slug), що ламає FK.
      const { data: eventTypes, error: typeErr } = await supabase
        .from('event_types')
        .select('slug, name, label');
      if (typeErr) throw typeErr;

      const rows = eventTypes || [];
      const normalizedSlug = String(payload.event_type_slug || '').trim().toLowerCase();
      const normalizedType = String(payload.type || '').trim().toLowerCase();

      const matchedType = rows.find((row) => {
        const slug = String(row.slug || '').trim().toLowerCase();
        const name = String(row.name || '').trim().toLowerCase();
        const label = String(row.label || '').trim().toLowerCase();
        return (
          (normalizedSlug && slug === normalizedSlug) ||
          (normalizedType && (name === normalizedType || label === normalizedType))
        );
      });

      if (matchedType) {
        payload.event_type_slug = matchedType.slug;
        payload.type = matchedType.name || matchedType.label || payload.type;
      }

      const { error } = await supabase.from('events_pending').insert(payload);
      if (error) throw error;

     setToast('✅Івент було відправлено на модерацію');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      navigate('/events', { state: { showModerationNotice: true } });
    } catch (err) {
      setToast('Помилка: ' + (err?.message || 'невідома'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Додати івент</h1>
      <p className="text-sm text-gray-600">
        Після надсилання івент з’явиться після схвалення адміністратором.
      </p>

      <div className="card p-4">
        <EventForm onSubmit={submit} loading={loading} />
      </div>

      <Toast text={toast} onClose={() => setToast('')} />
    </div>
  );
}
