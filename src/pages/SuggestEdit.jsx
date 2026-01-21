// Modified SuggestEdit.jsx to support contract address and circulating supply edits.
// The form now allows editing of coin_address and coin_circulating_supply fields.
// It leaves coin_price_link untouched (managed by backend resolution) but retains backward
// compatibility by allowing existing price links to be displayed.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';
import { toLocalInput } from '../utils/timeLocal';

/**
 * Підтягнути довідник типів (active=true) у тому ж форматі,
 * який очікує EventForm: { label, slug, is_tge, active }
 */
async function fetchEventTypes() {
  const { data, error } = await supabase
    .from('event_types')
    .select('label, slug, is_tge, active')
    .eq('active', true)
    .order('order_index', { ascending: true });
  if (error) throw error;
  return (data || []).map((t) => ({
    label: t.label,
    slug: t.slug,
    is_tge: !!t.is_tge,
    active: !!t.active,
  }));
}

/** Пошук типу за людською назвою події */
function matchTypeByLabel(types, label) {
  if (!label) return null;
  const L = String(label).trim().toLowerCase();
  return (
    types.find((t) => String(t.label).trim().toLowerCase() === L) ||
    null
  );
}

export default function SuggestEdit() {
  const { id } = useParams();
  const nav = useNavigate();

  const [ev, setEv] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // завантаження події та довідника типів
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);

        const [evRes, typesRes] = await Promise.all([
          supabase.from('events_approved').select('*').eq('id', id).single(),
          fetchEventTypes(),
        ]);

        if (!evRes.error && alive) setEv(evRes.data || null);
        if (alive) setTypes(typesRes);
      } catch (e) {
        console.error('Failed to load event or types', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const initial = useMemo(() => {
    if (!ev) return null;

    // знаходимо тип у довіднику за людською назвою з події (ev.type)
    const matchedType = matchTypeByLabel(types, ev.type) || null;
    const isTGE = matchedType?.is_tge || ev.type === 'Listing (TGE)';

    // час у форму — ТІЛЬКИ локальний (без 'Z'), щоб нічого не “з’їжджало”
    const startDateLocal = toLocalInput(ev.start_at, ev.timezone, isTGE ? 'date' : 'datetime');
    const startTimeLocal = isTGE ? toLocalInput(ev.start_at, ev.timezone, 'time') : '';
    const normalizedTime = startTimeLocal === '00:00' ? '' : startTimeLocal;
    const startLocal = isTGE && normalizedTime
      ? `${startDateLocal}T${startTimeLocal}`
      : startDateLocal;
    const endLocal = ev.end_at
      ? toLocalInput(ev.end_at, ev.timezone, 'datetime')
      : '';

    return {
      ...ev,
      // важливо: передати і людську назву, і event_type_slug — щоб EventForm не скидав тип
      type: ev.type || matchedType?.label || '',
      event_type_slug: matchedType?.slug || '',

      timezone: ev.timezone || 'UTC',

      start_at: startLocal, // 'YYYY-MM-DD' або 'YYYY-MM-DDTHH:mm'
       ...(isTGE ? { start_time: normalizedTime } : {}),
      end_at: endLocal,

      // не втрачати закріплені біржі
      tge_exchanges: Array.isArray(ev.tge_exchanges) ? ev.tge_exchanges : [],
    };
  }, [ev, types]);

  const submit = async (payload) => {
    // що можна редагувати:
    const allowed = [
      'title',
      'description',
      'start_at',
      'end_at',
      'timezone',
      'type',
      'event_type_slug',
      'tge_exchanges',
      'link',
      'coins',
      'nickname',
      'coin_name',
      'coin_quantity',
      // ✅ allow editing of address and circulating supply; price link is resolved automatically
      'coin_address',
      'coin_circulating_supply',
      // leave coin_price_link out to avoid manual edits
    ];
    const clean = Object.fromEntries(
      Object.entries(payload).filter(([k]) => allowed.includes(k))
    );

    const { error } = await supabase.from('event_edits_pending').insert({
      event_id: id,
      payload: clean,
      // submitter_email: ... (якщо потрібно)
    });
    if (error) {
      alert('Помилка: ' + error.message);
      return;
    }
    alert('Дякуємо! Правку надіслано на модерацію.');
    nav('/events');
  };

  if (loading) return <p>Завантаження…</p>;
  if (!ev) return <p>Івент не знайдено.</p>;
  if (!initial) return null;

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