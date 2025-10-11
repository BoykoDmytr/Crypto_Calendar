// src/components/EventForm.jsx
import { useEffect, useState, useMemo } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../lib/supabase';
import { fetchEventTypes } from '../lib/api';

dayjs.extend(utc);
dayjs.extend(timezone);

const kyivTZ = 'Europe/Kyiv';

export default function EventForm({ onSubmit, loading, initial = {} }) {
  const [types, setTypes] = useState([]); // довідник типів
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    // важливо: тепер зберігаємо slug типу
    event_type_slug: initial.event_type_slug || 'listing-tge',
    type: initial.type || 'Listing (TGE)', // лишаємо для відображення у картках/легасі
    timezone: 'Kyiv',
    start_at: '',
    end_at: '',
    start_date: '',
    start_time: '',
    link: '',
    tge_exchanges: [],
    ...initial,
  }));

  // завантажити довідник типів
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchEventTypes();
        setTypes(data);
        // якщо в initial немає slug — виставимо перший активний
        if (!initial.event_type_slug && data.length) {
          setForm(s => ({ ...s,
            event_type_slug: data[0].slug,
            type: data[0].name
          }));
        }
      } catch(e) {
        console.error('Failed to load event_types', e);
      }
    })();
  }, []);

  const currentType = useMemo(
    () => types.find(t => t.slug === form.event_type_slug) || { is_tge: true, time_optional: true, name: 'Listing (TGE)' },
    [types, form.event_type_slug]
  );

  // довідник бірж
  const [dictExchanges, setDictExchanges] = useState({ spot: [], futures: [] });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('exchanges')
        .select('name, segment')
        .eq('active', true)
        .order('segment', { ascending: true })
        .order('name', { ascending: true });
      if (!error && alive) {
        const spot = [], futures = [];
        (data || []).forEach(x => (x.segment === 'Futures' ? futures : spot).push(x.name));
        setDictExchanges({ spot, futures });
      }
    })();
    return () => { alive = false; };
  }, []);

  const change = (k, v) => setForm(s => ({ ...s, [k]: v }));

  // ряди бірж (TGE)
  const addExchange = () =>
    change('tge_exchanges', [ ...(form.tge_exchanges || []), { name: '', time: '' } ]);
  const setExchange = (i, key, val) => {
    const arr = [ ...(form.tge_exchanges || []) ];
    arr[i] = { ...arr[i], [key]: val };
    change('tge_exchanges', arr);
  };
  const removeExchange = (i) => {
    const arr = [ ...(form.tge_exchanges || []) ];
    arr.splice(i, 1);
    change('tge_exchanges', arr);
  };

  // конвертації
  const toISODateOnly = (yyyy_mm_dd, mode) => {
    if (!yyyy_mm_dd) return null;
    if (mode === 'UTC') return new Date(`${yyyy_mm_dd}T00:00:00Z`).toISOString();
    return dayjs.tz(`${yyyy_mm_dd} 00:00`, kyivTZ).toDate().toISOString();
  };
  const toISOorNull = (localStr, mode) => {
    if (!localStr) return null;
    if (mode === 'UTC') return new Date(localStr + 'Z').toISOString();
    return dayjs.tz(localStr.replace('T', ' '), kyivTZ).toDate().toISOString();
  };

  // prefills для «дата + (опц.)час»
  const datePrefill = () =>
    form.start_date || (form.start_at ? String(form.start_at).slice(0,10) : '');
  const timePrefill = () => {
    if (form.start_time) return form.start_time;
    if (!form.start_at) return '';
    const t = dayjs(form.start_at).format('HH:mm');
    return t === '00:00' ? '' : t;
  };

  const submit = (e) => {
    e.preventDefault();
    const payload = { ...form };

    // записуємо «людську» назву типу (для картки/легасі)
    payload.type = currentType.name;

    if (currentType.is_tge) {
      // тільки дата + біржі
      payload.start_at = toISODateOnly(form.start_at, form.timezone);
      delete payload.end_at;
      payload.tge_exchanges = (payload.tge_exchanges || [])
        .filter(x => (x?.name || '').trim() || (x?.time || '').trim());
      delete payload.start_date;
      delete payload.start_time;
    } else if (currentType.time_optional) {
      // дата + опційний час
      const date = (form.start_date && String(form.start_date).trim())
                || (form.start_at && String(form.start_at).slice(0,10))
                || '';
      const time = (form.start_time || '').trim(); // може бути порожнім
      const local = time ? `${date}T${time}` : `${date}T00:00`;
      payload.start_at = toISOorNull(local, form.timezone);
      payload.end_at   = toISOorNull(form.end_at, form.timezone);
      if (!payload.end_at) delete payload.end_at;
      delete payload.start_date;
      delete payload.start_time;
      delete payload.tge_exchanges;
    } else {
      // повний datetime-local
      payload.start_at = toISOorNull(form.start_at, form.timezone);
      payload.end_at   = toISOorNull(form.end_at,   form.timezone);
      if (!payload.end_at) delete payload.end_at;
      delete payload.start_date;
      delete payload.start_time;
      delete payload.tge_exchanges;
    }

    if (!payload.link)        delete payload.link;
    if (!payload.description) delete payload.description;

    onSubmit?.(payload);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Заголовок */}
      <div>
        <label className="label">Заголовок *</label>
        <input className="input" required
          value={form.title}
          onChange={e => change('title', e.target.value)}
          placeholder="Напр., ASTER TGE" />
      </div>

      {/* Опис */}
      <div>
        <label className="label">Опис</label>
        <textarea className="input min-h-[90px]"
          value={form.description}
          onChange={e => change('description', e.target.value)}
          placeholder="Короткий опис події" />
      </div>

      {/* Часова зона вводу */}
      <div>
        <label className="label">Часова зона вводу</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button"
            onClick={()=>change('timezone','UTC')}
            className={`px-3 py-2 rounded-xl border ${form.timezone==='UTC'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>UTC</button>
          <button type="button"
            onClick={()=>change('timezone','Kyiv')}
            className={`px-3 py-2 rounded-xl border ${form.timezone==='Kyiv'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>Київський час</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Вводь час у вибраній зоні — ми збережемо в UTC.</p>
      </div>

      {/* Поля дат/часу згідно з типом */}
      {currentType.is_tge ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Початок *</label>
            <input type="date" required className="input"
              value={form.start_at || ''}
              onChange={e=>change('start_at', e.target.value)} />
          </div>
        </div>
      ) : currentType.time_optional ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Дата *</label>
              <input type="date" required className="input"
                value={datePrefill()}
                onChange={e=>change('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Час (опц.)</label>
              <input type="time" step="60" className="input"
                value={timePrefill()}
                onChange={e=>change('start_time', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Кінець (необов’язково)</label>
            <input type="datetime-local" className="input"
              value={form.end_at || ''}
              onChange={e=>change('end_at', e.target.value)} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Початок *</label>
            <input type="datetime-local" required className="input"
              value={form.start_at || ''}
              onChange={e=>change('start_at', e.target.value)} />
          </div>
          <div>
            <label className="label">Кінець (необов’язково)</label>
            <input type="datetime-local" className="input"
              value={form.end_at || ''}
              onChange={e=>change('end_at', e.target.value)} />
          </div>
        </div>
      )}

      {/* Тип + Посилання */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Тип</label>
          <select className="input"
            value={form.event_type_slug}
            onChange={e=>{
              const slug = e.target.value;
              const t = types.find(x=>x.slug===slug);
              change('event_type_slug', slug);
              change('type', t?.name || '');
            }}>
            {types.map(t => (
              <option key={t.id} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Посилання</label>
          <input className="input" value={form.link || ''}
            onChange={e=>change('link', e.target.value)}
            placeholder="https://…" />
        </div>
      </div>

      {/* Біржі + час (лише для TGE) */}
      {currentType.is_tge && (
        <div className="space-y-2">
          <div className="label">Біржі та час (опц.)</div>
          {(form.tge_exchanges || []).map((x, i)=>(
            <div key={i} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <select className="input sm:col-span-3"
                value={x.name || ''} onChange={e=>setExchange(i,'name', e.target.value)}>
                <option value="" disabled>Оберіть біржу…</option>
                <optgroup label="Spot">
                  {dictExchanges.spot.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
                <optgroup label="Futures">
                  {dictExchanges.futures.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              </select>
              <input type="time" step="60" className="input sm:col-span-1"
                value={x.time || ''} onChange={e=>setExchange(i,'time', e.target.value)} />
              <button type="button" className="btn-secondary sm:col-span-1"
                onClick={()=>removeExchange(i)}>–</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={addExchange}>+ Додати біржу</button>
          <p className="text-xs text-gray-500">Дата задається вище, час — для кожної біржі окремо.</p>
        </div>
      )}

      <div className="pt-2">
        <button disabled={loading} className="btn">
          {loading ? 'Зберігаю…' : 'Надіслати на модерацію'}
        </button>
      </div>
    </form>
  );
}
