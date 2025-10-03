// src/pages/Admin.jsx
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = 'Europe/Kyiv';

function RowActions({ children }) {
  return <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">{children}</div>;
}

// форматування дати/часу у списках адмінки
function formatEventDate(ev) {
  const tz = ev?.timezone || 'UTC';
  const base = tz === 'Kyiv' ? dayjs.utc(ev.start_at).tz(KYIV_TZ) : dayjs.utc(ev.start_at);
  if (ev?.type === 'Listing (TGE)') return `${base.format('DD MMM YYYY')} ${tz}`;
  return `${base.format('DD MMM YYYY, HH:mm')} ${tz}`;
}

// утиліта для сорту часу бірж (HH:mm)
const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  return (+m[1]) * 60 + (+m[2]);
};

/* ===== Helpers for edit preview (правки) ===== */
const prettyDate = (type, ts, tz) => {
  if (!ts) return '—';
  const d = dayjs(ts);
  const base = type === 'Listing (TGE)' ? d.format('DD MMM YYYY') : d.format('DD MMM YYYY, HH:mm');
  return tz ? `${base} ${tz}` : base;
};

const normEx = (arr=[]) =>
  arr
    .map(x => ({ name: (x?.name || '').trim(), time: (x?.time || '').trim() }))
    .filter(x => x.name || x.time)
    .sort((a,b) => (a.name || '').localeCompare(b.name || '') || (a.time || '').localeCompare(b.time || ''));

const sameExchanges = (a, b) => {
  const A = normEx(a), B = normEx(b);
  if (A.length !== B.length) return false;
  for (let i=0; i<A.length; i++) if (A[i].name !== B[i].name || A[i].time !== B[i].time) return false;
  return true;
};

const Chips = ({ list=[] }) => (
  <div className="flex flex-wrap gap-1.5">
    {normEx(list).map((x,i)=>(
      <span key={`${x.name}-${x.time}-${i}`} className="text-xs px-2 py-1 rounded-full bg-blue-50 border border-blue-100">
        {x.name}{x.time ? ` • ${x.time}` : ''}
      </span>
    ))}
  </div>
);

const DiffRow = ({ label, oldVal, newVal, chips=false }) => (
  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
    <div className="text-xs font-medium text-amber-800">{label}</div>
    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
      <div className="text-sm text-amber-900 line-through decoration-2 decoration-amber-400">
        {chips ? <Chips list={oldVal||[]} /> : (oldVal ?? '—')}
      </div>
      <div className="text-sm font-semibold text-amber-900">
        {chips ? <Chips list={newVal||[]} /> : (newVal ?? '—')}
      </div>
    </div>
  </div>
);

/* ===== Компонент одного рядка довідника бірж ===== */
function ExchangeRow({ ex, onSave, onDelete }) {
  const [row, setRow] = useState(ex);
  useEffect(()=> setRow(ex), [ex.id, ex.name, ex.segment, ex.active]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,120px,120px,auto] gap-2 items-center p-2 rounded-xl border border-gray-200">
      <input className="input" value={row.name}
             onChange={e=>setRow(r=>({ ...r, name: e.target.value }))} placeholder="Назва біржі" />
      <select className="input" value={row.segment}
              onChange={e=>setRow(r=>({ ...r, segment: e.target.value }))}>
        <option>Spot</option>
        <option>Futures</option>
      </select>

      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={!!row.active}
               onChange={e=>setRow(r=>({ ...r, active: e.target.checked }))}/>
        <span className="text-sm">Активна</span>
      </label>

      <div className="flex gap-2 justify-end">
        <button className="btn" onClick={()=>onSave(row)}>Зберегти</button>
        <button className="btn-secondary" onClick={()=>onDelete(row.id)}>Видалити</button>
      </div>
    </div>
  );
}

export default function Admin() {
  const [pass, setPass] = useState('');
  const [ok, setOk] = useState(false);

  const [pending, setPending]   = useState([]);
  const [approved, setApproved] = useState([]);
  const [edits, setEdits]       = useState([]);

  // довідник бірж
  const [exchanges, setExchanges] = useState([]);
  const [newEx, setNewEx] = useState({ name: '', segment: 'Spot', active: true });

  const [editId, setEditId] = useState(null);
  const [editTable, setEditTable] = useState(null);

  useEffect(() => { if (ok) refresh(); }, [ok]);

  const refresh = async () => {
    const [p, a, e, x] = await Promise.all([
      supabase.from('events_pending')
        .select('*')
        .order('created_at', { ascending: true }),
      supabase.from('events_approved')
        .select('*')
        .order('start_at', { ascending: true }),
      supabase.from('event_edits_pending')
        .select('id,event_id,payload,submitter_email,created_at,events_approved(id,title,start_at,timezone,type,tge_exchanges)')
        .order('created_at', { ascending: true }),
      supabase.from('exchanges')
        .select('*')
        .order('segment', { ascending: true })
        .order('name', { ascending: true }),
    ]);

    if (!p.error) setPending(p.data || []);
    if (!a.error) setApproved(a.data || []);
    if (!e.error) setEdits(e.data || []);
    if (!x.error) setExchanges(x.data || []);
  };

  // ===== МОДЕРАЦІЯ ЗАЯВОК =====
  const approve = async (ev) => {
    const allowed = ['title','description','start_at','end_at','timezone','type','tge_exchanges','link'];
    const payload = Object.fromEntries(Object.entries(ev).filter(([k]) => allowed.includes(k)));

    if (Array.isArray(ev.tge_exchanges)) {
      payload.tge_exchanges = [...ev.tge_exchanges].sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));
    }
    if (payload.end_at === '' || payload.end_at == null) delete payload.end_at;

    const { error } = await supabase.from('events_approved').insert(payload);
    if (error) return alert('Помилка: ' + error.message);

    await supabase.from('events_pending').delete().eq('id', ev.id);
    await refresh();
  };

  const reject = async (ev) => {
    if (!confirm('Відхилити і видалити цю заявку?')) return;
    const { error } = await supabase.from('events_pending').delete().eq('id', ev.id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  const updateRow = async (table, id, payload) => {
    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== '' && v !== undefined)
    );
    if (clean.end_at === '') delete clean.end_at;

    const { error } = await supabase.from(table).update(clean).eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    setEditId(null); setEditTable(null);
    await refresh();
  };

  const removeRow = async (table, id) => {
    if (!confirm('Видалити запис?')) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== ПРАВКИ =====
  const approveEdit = async (edit) => {
    const allowed = ['title','description','start_at','end_at','timezone','type','tge_exchanges','link'];
    const patch = Object.fromEntries(Object.entries(edit.payload || {}).filter(([k]) => allowed.includes(k)));

    if (Array.isArray(patch.tge_exchanges)) {
      patch.tge_exchanges = [...patch.tge_exchanges].sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));
    }
    if (patch.end_at === '' || patch.end_at == null) delete patch.end_at;

    const { error } = await supabase.from('events_approved').update(patch).eq('id', edit.event_id);
    if (error) return alert('Помилка: ' + error.message);

    await supabase.from('event_edits_pending').delete().eq('id', edit.id);
    await refresh();
  };

  const rejectEdit = async (id) => {
    const { error } = await supabase.from('event_edits_pending').delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== ДОВІДНИК БІРЖ =====
  const addExchange = async () => {
    const name = newEx.name.trim();
    if (!name) return alert('Вкажіть назву біржі');
    const payload = { name, segment: newEx.segment, active: !!newEx.active };
    const { error } = await supabase.from('exchanges').insert(payload);
    if (error) return alert('Помилка: ' + error.message);
    setNewEx({ name: '', segment: 'Spot', active: true });
    await refresh();
  };

  const saveExchange = async (row) => {
    const payload = {
      name: row.name.trim(),
      segment: row.segment,
      active: !!row.active,
    };
    const { error } = await supabase.from('exchanges').update(payload).eq('id', row.id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  const deleteExchange = async (id) => {
    if (!confirm('Видалити біржу? Це може вплинути на існуючі події.')) return;
    const { error } = await supabase.from('exchanges').delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== РЕДАГУВАЛКА КАРТКИ =====
  const EditingCard = ({ table, ev }) => {
    const initial = {
      ...ev,
      start_at: ev?.type === 'Listing (TGE)'
        ? ev.start_at?.slice(0, 10)
        : ev.start_at?.slice(0, 16),
      end_at: ev.end_at ? ev.end_at.slice(0, 16) : '',
    };
    return (
      <div className="card p-4">
        <div className="text-sm text-gray-500 mb-2">Редагування ({table})</div>
        <EventForm initial={initial} onSubmit={(payload)=> updateRow(table, ev.id, payload)} loading={false} />
        <div className="flex gap-2 mt-3">
          <button className="btn-secondary px-4 py-2 rounded-xl"
                  onClick={()=>{ setEditId(null); setEditTable(null); }}>
            Скасувати
          </button>
        </div>
      </div>
    );
  };

  // ===== ЛОГІН =====
  if (!ok) {
    return (
      <div className="max-w-sm mx-auto">
        <h1 className="text-xl font-semibold mb-2">Вхід в адмін-панель</h1>
        <div className="card p-4">
          <input
            autoFocus type="password" className="input" placeholder="Пароль"
            value={pass} onChange={(e)=>setPass(e.target.value)}
          />
          <button className="btn w-full mt-3"
                  onClick={()=> setOk(pass === import.meta.env.VITE_ADMIN_PASS)}>
            Увійти
          </button>
          <p className="text-xs text-gray-500 mt-2">Пароль знає лише адміністратор.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Адмін-панель</h1>
        <button className="btn-secondary px-3 py-2 rounded-xl" onClick={refresh}>Оновити</button>
      </div>

      {/* Заявки на модерації */}
      <section>
        <h2 className="font-semibold mb-2">Заявки на модерації</h2>
        {pending.length === 0 && <p className="text-sm text-gray-600">Немає заявок.</p>}
        <div className="space-y-3">
          {pending.map(ev => (
            <article key={ev.id} className="card p-4">
              {editId === ev.id && editTable === 'events_pending' ? (
                <EditingCard table="events_pending" ev={ev} />
              ) : (
                <>
                  <div className="text-xs text-gray-500">{dayjs(ev.created_at).format('DD MMM HH:mm')}</div>
                  <h3 className="font-semibold">{ev.title}</h3>
                  {ev.description && <p className="text-sm text-gray-600 mt-1">{ev.description}</p>}
                  <div className="text-sm mt-2 flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded-md bg-gray-100">{ev.type}</span>
                    <span>🕒 {formatEventDate(ev)}</span>
                    {ev.link && <a className="underline" href={ev.link} target="_blank" rel="noreferrer">Лінк</a>}
                  </div>

                  <RowActions>
                    <button className="btn" onClick={()=>approve(ev)}>Схвалити</button>
                    <button className="btn-secondary" onClick={()=>reject(ev)}>Відхилити</button>
                    <div className="flex gap-2">
                      <button className="btn-secondary"
                              onClick={()=>{ setEditId(ev.id); setEditTable('events_pending'); }}>
                        Редагувати
                      </button>
                      <button className="btn-secondary" onClick={()=>removeRow('events_pending', ev.id)}>
                        Видалити
                      </button>
                    </div>
                  </RowActions>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Запропоновані правки (з підсвіткою змін) */}
      <section>
        <h2 className="font-semibold mb-2">Запропоновані правки</h2>
        {edits.length === 0 && <p className="text-sm text-gray-600">Поки що немає.</p>}
        <div className="space-y-3">
          {edits.map(ed => {
            const base  = ed.events_approved || {};
            const patch = ed.payload || {};
            const next  = { ...base, ...patch };

            const changed = [];
            if (patch.title && patch.title !== base.title)
              changed.push(<DiffRow key="title" label="Заголовок" oldVal={base.title} newVal={patch.title} />);
            if (patch.description !== undefined && patch.description !== base.description)
              changed.push(<DiffRow key="desc" label="Опис" oldVal={base.description||'—'} newVal={patch.description||'—'} />);
            if (patch.type && patch.type !== base.type)
              changed.push(<DiffRow key="type" label="Тип" oldVal={base.type} newVal={patch.type} />);
            if (patch.timezone && patch.timezone !== base.timezone)
              changed.push(<DiffRow key="tz" label="Часова зона" oldVal={base.timezone||'UTC'} newVal={patch.timezone||'UTC'} />);

            const baseStart = prettyDate(base.type, base.start_at, base.timezone);
            const nextStart = prettyDate(next.type, next.start_at, next.timezone);
            if (patch.start_at !== undefined || patch.type !== undefined || patch.timezone !== undefined)
              if (baseStart !== nextStart)
                changed.push(<DiffRow key="start" label="Початок" oldVal={baseStart} newVal={nextStart} />);

            const baseEnd = prettyDate(base.type, base.end_at, base.timezone);
            const nextEnd = prettyDate(next.type, next.end_at, next.timezone);
            if (patch.end_at !== undefined || patch.type !== undefined || patch.timezone !== undefined)
              if (baseEnd !== nextEnd)
                changed.push(<DiffRow key="end" label="Кінець" oldVal={baseEnd} newVal={nextEnd} />);

            if (patch.tge_exchanges !== undefined && !sameExchanges(base.tge_exchanges, patch.tge_exchanges))
              changed.push(<DiffRow key="ex" label="Біржі (TGE)" oldVal={base.tge_exchanges} newVal={patch.tge_exchanges} chips />);

            if (patch.link !== undefined && patch.link !== base.link)
              changed.push(<DiffRow key="link" label="Посилання" oldVal={base.link||'—'} newVal={patch.link||'—'} />);

            return (
              <article key={ed.id} className="card p-4">
                <div className="text-xs text-gray-500 mb-2">
                  Для івенту <span className="font-medium">#{ed.event_id}</span>
                  {base?.title ? <> • {base.title}</> : null}
                  {' • '}{dayjs(ed.created_at).format('DD MMM HH:mm')}
                </div>

                {changed.length === 0 ? (
                  <div className="text-sm text-gray-600">Зміни не відрізняються від поточного стану.</div>
                ) : (
                  <div className="space-y-2">{changed}</div>
                )}

                <div className="mt-3 flex gap-2">
                  <button className="btn" onClick={()=>approveEdit(ed)}>Застосувати</button>
                  <button className="btn-secondary" onClick={()=>rejectEdit(ed.id)}>Відхилити</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Схвалені події */}
      <section>
        <h2 className="font-semibold mb-2">Схвалені події</h2>
        {approved.length === 0 && <p className="text-sm text-gray-600">Поки що немає.</p>}
        <div className="space-y-3">
          {approved.map(ev => (
            <article key={ev.id} className="card p-4">
              {editId === ev.id && editTable === 'events_approved' ? (
                <EditingCard table="events_approved" ev={ev} />
              ) : (
                <>
                  <div className="font-semibold">{ev.title}</div>
                  <div className="text-sm text-gray-600">
                    {formatEventDate(ev)} • {ev.type}
                  </div>
                  <RowActions>
                    <button className="btn-secondary"
                            onClick={()=>{ setEditId(ev.id); setEditTable('events_approved'); }}>
                      Редагувати
                    </button>
                    <button className="btn-secondary" onClick={()=>removeRow('events_approved', ev.id)}>
                      Видалити
                    </button>
                  </RowActions>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* ===== ДОВІДНИК БІРЖ ===== */}
      <section>
        <h2 className="font-semibold mb-2">Довідник бірж</h2>

        {/* Форма додавання */}
        <div className="card p-4 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px,120px,auto] gap-2">
            <input className="input" placeholder="Назва (напр., Binance Spot)"
                   value={newEx.name}
                   onChange={e=>setNewEx(s=>({ ...s, name: e.target.value }))}/>
            <select className="input" value={newEx.segment}
                    onChange={e=>setNewEx(s=>({ ...s, segment: e.target.value }))}>
              <option>Spot</option>
              <option>Futures</option>
            </select>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={newEx.active}
                     onChange={e=>setNewEx(s=>({ ...s, active: e.target.checked }))}/>
              <span className="text-sm">Активна</span>
            </label>
            <div className="flex justify-end">
              <button className="btn" onClick={addExchange}>+ Додати біржу</button>
            </div>
          </div>
        </div>

        {/* Список бірж */}
        {exchanges.length === 0 ? (
          <p className="text-sm text-gray-600">Поки що немає записів.</p>
        ) : (
          <div className="space-y-2">
            {exchanges.map(ex => (
              <ExchangeRow key={ex.id} ex={ex} onSave={saveExchange} onDelete={deleteExchange} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
