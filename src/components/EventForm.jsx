// EventForm.jsx
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../lib/supabase';

dayjs.extend(utc);
dayjs.extend(timezone);

const kyivTZ = 'Europe/Kyiv';
const TYPES = [
  'Listing (TGE)',
  'Binance Alpha',
  'OKX Alpha',
  'Token Sales',
  'Claim / Airdrop',
  'Unlocks',
];

export default function EventForm({ onSubmit, loading, initial = {} }) {
  // --- state форми
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    type: 'Listing (TGE)',
    timezone: 'Kyiv',          // 'UTC' | 'Kyiv'
    start_at: '',
    end_at: '',
    link: '',
    tge_exchanges: [],
    ...initial,
  }));

  // --- довідник бірж (Spot/Futures)
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

  const isTGE = form.type === 'Listing (TGE)';

  const change = (k, v) => setForm(s => ({ ...s, [k]: v }));

  // керування рядками бірж
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
  //const toISO = (localStr, mode) => {
  //  if (!localStr) return null;
  //  if (mode === 'UTC') return new Date(localStr + 'Z').toISOString();
  //  return dayjs.tz(localStr.replace('T', ' '), kyivTZ).toDate().toISOString();
  //};
  const toISOorNull = (localStr, mode) => {
    if (!localStr) return null;                         // ← порожнє = null
    if (mode === 'UTC') return new Date(localStr + 'Z').toISOString();
    return dayjs.tz(localStr.replace('T',' '), kyivTZ).toDate().toISOString();
  };

  const submit = (e) => {
    e.preventDefault();
    const payload = { ...form };

    if (isTGE) {
      // для TGE зберігаємо лише дату; кінець взагалі не шлемо
      payload.start_at = toISODateOnly(form.start_at, form.timezone);
      delete payload.end_at;                            // ← важливо
    } else {
      payload.start_at = toISOorNull(form.start_at, form.timezone);
      payload.end_at   = toISOorNull(form.end_at,   form.timezone);
      if (payload.end_at == null) delete payload.end_at; // ← не відправляємо порожнє
    }

    // очистка дрібниць
    if (!payload.link) delete payload.link;
    if (!payload.description) delete payload.description;

    // tge_exchanges: залишаємо тільки непорожні рядки
    if (isTGE) {
      payload.tge_exchanges = (payload.tge_exchanges || [])
        .filter(x => (x?.name || '').trim() || (x?.time || '').trim());
    } else {
      delete payload.tge_exchanges;
    }

    onSubmit?.(payload);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label">Заголовок *</label>
        <input className="input" required value={form.title}
               onChange={e=>change('title', e.target.value)} placeholder="Напр., ASTER TGE" />
      </div>

      <div>
        <label className="label">Опис</label>
        <textarea className="input min-h-[90px]" value={form.description}
                  onChange={e=>change('description', e.target.value)}
                  placeholder="Короткий опис події" />
      </div>

      {/* Часова зона */}
      <div>
        <label className="label">Часова зона вводу</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button"
                  onClick={()=>change('timezone','UTC')}
                  className={`px-3 py-2 rounded-xl border ${form.timezone==='UTC'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>
            UTC
          </button>
          <button type="button"
                  onClick={()=>change('timezone','Kyiv')}
                  className={`px-3 py-2 rounded-xl border ${form.timezone==='Kyiv'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>
            Київський час
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Вводь час у вибраній зоні — ми збережемо в UTC.</p>
      </div>

      {/* Дата/час */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Початок *</label>
          {isTGE ? (
            <input type="date" required className="input"
                   value={form.start_at || ''} onChange={e=>change('start_at', e.target.value)} />
          ) : (
            <input type="datetime-local" required className="input"
                   value={form.start_at || ''} onChange={e=>change('start_at', e.target.value)} />
          )}
        </div>
        {!isTGE && (
          <div>
            <label className="label">Кінець (необов’язково)</label>
            <input type="datetime-local" className="input"
                   value={form.end_at || ''} onChange={e=>change('end_at', e.target.value)} />
          </div>
        )}
      </div>

      {/* Тип + Посилання */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Тип</label>
          <select className="input" value={form.type} onChange={e=>change('type', e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Посилання</label>
          <input className="input" value={form.link || ''}
                 onChange={e=>change('link', e.target.value)} placeholder="https://…" />
        </div>
      </div>

      {/* Біржі + час (лише для TGE) */}
      {isTGE && (
        <div className="space-y-2">
          <div className="label">Біржі та час (опц.)</div>
          {(form.tge_exchanges || []).map((x, i) => (
            <div key={i} className="grid grid-cols-5 gap-2">
              <select className="input col-span-3"
                      value={x.name || ''} onChange={e=>setExchange(i,'name', e.target.value)}>
                <option value="" disabled>Оберіть біржу…</option>
                <optgroup label="Spot">
                  {dictExchanges.spot.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
                <optgroup label="Futures">
                  {dictExchanges.futures.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              </select>

              <input type="time" step="60" className="input col-span-1"
                     value={x.time || ''} onChange={e=>setExchange(i,'time', e.target.value)} />
              <button type="button" className="btn-secondary" onClick={()=>removeExchange(i)}>–</button>
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
