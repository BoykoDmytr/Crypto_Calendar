// src/pages/Admin.jsx
import { useEffect, useState } from 'react';
import { toLocalInput } from "../utils/timeLocal";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';
import { formatQuantity as formatTokenQuantity } from '../hooks/useTokenPrice';

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

const formatCoinQuantity = (value) => {
  const formatted = formatTokenQuantity(value);
  return formatted ?? '—';
};
const formatNickname = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
};
/* ===== Helpers for edit preview (правки) ===== */
const prettyDate = (type, ts, tz) => {
  if (!ts) return '—';
  const d = dayjs(ts);
  const base = type === 'Listing (TGE)' ? d.format('DD MMM YYYY') : d.format('DD MMM YYYY, HH:mm');
  return tz ? `${base} ${tz}` : base;
};

const normEx = (arr = []) =>
  arr
    .map((x) => ({ name: (x?.name || '').trim(), time: (x?.time || '').trim() }))
    .filter((x) => x.name || x.time)
    .sort(
      (a, b) =>
        (a.name || '').localeCompare(b.name || '') ||
        (a.time || '').localeCompare(b.time || '')
    );

const sameExchanges = (a, b) => {
  const A = normEx(a), B = normEx(b);
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++)
    if (A[i].name !== B[i].name || A[i].time !== B[i].time) return false;
  return true;
};

const Chips = ({ list = [] }) => (
  <div className="chips flex flex-wrap gap-1.5">
    {normEx(list).map((x, i) => (
      <span key={`${x.name}-${x.time}-${i}`} className="exchange-chip">
        {x.name}{x.time ? ` • ${x.time}` : ''}
      </span>
    ))}
  </div>
);

const TypeBadge = ({ type }) => (
  <span className="badge-type badge-type--yellow">
    {type}
  </span>
);



const DiffRow = ({ label, oldVal, newVal, chips = false }) => (
  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
    <div className="text-xs font-medium text-amber-800">{label}</div>
    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
      <div className="text-sm text-amber-900 line-through decoration-2 decoration-amber-400">
        {chips ? <Chips list={oldVal || []} /> : oldVal ?? '—'}
      </div>
      <div className="text-sm font-semibold text-amber-900">
        {chips ? <Chips list={newVal || []} /> : newVal ?? '—'}
      </div>
    </div>
  </div>
);

/* ===== Компонент рядка довідника бірж ===== */
function ExchangeRow({ ex, onSave, onDelete }) {
  const [row, setRow] = useState(ex);
  useEffect(() => setRow(ex), [ex.id, ex.name, ex.segment, ex.active]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,120px,120px,auto] gap-2 items-center p-2 rounded-xl border border-gray-200">
      <input
        className="input"
        value={row.name}
        onChange={(e) => setRow((r) => ({ ...r, name: e.target.value }))}
        placeholder="Назва біржі"
      />
      <select
        className="input"
        value={row.segment}
        onChange={(e) => setRow((r) => ({ ...r, segment: e.target.value }))}
      >
        <option>Spot</option>
        <option>Futures</option>
      </select>

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!row.active}
          onChange={(e) => setRow((r) => ({ ...r, active: e.target.checked }))}
        />
        <span className="text-sm">Активна</span>
      </label>

      <div className="flex gap-2 justify-end">
        <button className="btn" onClick={() => onSave(row)}>
          Зберегти
        </button>
        <button className="btn-secondary" onClick={() => onDelete(row.id)}>
          Видалити
        </button>
      </div>
    </div>
  );
}

/* ===== Компонент рядка довідника типів ===== */
function TypeRow({ t, onSave, onDelete, moveType, isFirst, isLast }) {
  const [row, setRow] = useState(t);
  useEffect(() => setRow(t), [t.id, t.label, t.slug, t.active, t.is_tge]);

  // автогенерація slug, якщо користувач міняє label і slug порожній або збігається із старим
  const slugify = (s) =>
    s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,220px,110px,auto] gap-2 items-center p-2 rounded-xl border border-gray-200">
      <input
        className="input"
        value={row.label}
        onChange={(e) => {
          const label = e.target.value;
          setRow((r) => ({
            ...r,
            label,
            slug: !r.slug || r.slug === slugify(r.label) ? slugify(label) : r.slug,
          }));
        }}
        placeholder="Напр., Binance Alpha"
      />

      <input
        className="input"
        value={row.slug || ''}
        onChange={(e) => setRow((r) => ({ ...r, slug: e.target.value }))}
        placeholder="slug (binance-alpha)"
      />

      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!row.active}
            onChange={(e) => setRow((r) => ({ ...r, active: e.target.checked }))}
          />
          <span className="text-sm">Активний</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!row.is_tge}
            onChange={(e) => setRow((r) => ({ ...r, is_tge: e.target.checked }))}
          />
          <span className="text-sm">TGE</span>
        </label>
      </div>

      <div className="flex gap-2 justify-end">
        {/* Рух вгору/вниз лише стрілками */}
        <button
          className="btn-secondary w-9 h-9 rounded-full"
          title="Вгору"
          onClick={() => moveType(t.id, 'up')}
          disabled={isFirst}
        >↑</button>

        <button
          className="btn-secondary w-9 h-9 rounded-full"
          title="Вниз"
          onClick={() => moveType(t.id, 'down')}
          disabled={isLast}
        >↓</button>

        <button className="btn" onClick={() => onSave(row)}>Зберегти</button>
        <button className="btn-secondary" onClick={() => onDelete(t.id)}>Видалити</button>
      </div>
    </div>
  );
}

export default function Admin() {
  const [pass, setPass] = useState('');
  const [ok, setOk] = useState(false);

  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [edits, setEdits] = useState([]);

  // довідник бірж
  const [exchanges, setExchanges] = useState([]);
  const [newEx, setNewEx] = useState({ name: '', segment: 'Spot', active: true });

  // довідник типів
  const [types, setTypes] = useState([]);
  const [newType, setNewType] = useState({
    label: '',
    slug: '',
    is_tge: false,
    active: true,
  });

  const [editId, setEditId] = useState(null);
  const [editTable, setEditTable] = useState(null);

  useEffect(() => {
    if (ok) refresh();
  }, [ok]);

  const refresh = async () => {
    const [p, a, e, x, t] = await Promise.all([
      supabase.from('events_pending').select('*').order('created_at', { ascending: true }),
      supabase.from('events_approved').select('*').order('start_at', { ascending: true }),
      supabase
        .from('event_edits_pending')
        .select(
          'id,event_id,payload,submitter_email,created_at,events_approved(id,title,start_at,timezone,type,tge_exchanges)'
        )
        .order('created_at', { ascending: true }),
      supabase
        .from('exchanges')
        .select('*')
        .order('segment', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('event_types')
        .select('*')
        .order('order_index', { ascending: true })
        .order('label', { ascending: true }),
    ]);

    if (!p.error) setPending(p.data || []);
    if (!a.error) setApproved(a.data || []);
    if (!e.error) setEdits(e.data || []);
    if (!x.error) setExchanges(x.data || []);
    if (!t.error) setTypes(t.data || []);
  };

  // ====== Переміщення типів (order_index) ======
  // поміняти місцями order_index двох типів
  const swapTypeOrder = async (a, b) => {
    await Promise.all([
      supabase.from('event_types').update({ order_index: b.order_index }).eq('id', a.id),
      supabase.from('event_types').update({ order_index: a.order_index }).eq('id', b.id),
    ]);
  };

  // рух типу на 1 позицію вгору/вниз у відсортованому списку
  const moveType = async (id, dir) => {
    const list = [...types].sort(
      (x, y) => (x.order_index ?? 0) - (y.order_index ?? 0) || (x.label || '').localeCompare(y.label || '')
    );
    const i = list.findIndex(t => t.id === id);
    if (i < 0) return;

    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return; // межі

    await swapTypeOrder(list[i], list[j]);
    await refresh(); // перечитати список після апдейту
  };

  // ===== МОДЕРАЦІЯ ЗАЯВОК =====
  const approve = async (ev) => {
    const allowed = [
      'title','description','start_at','end_at','timezone','type','tge_exchanges','link','nickname',
      'coin_name','coin_quantity','coin_price_link',
    ];
    const payload = Object.fromEntries(Object.entries(ev).filter(([k]) => allowed.includes(k)));

    if (Array.isArray(ev.tge_exchanges)) {
      payload.tge_exchanges = [...ev.tge_exchanges].sort(
        (a, b) => toMinutes(a?.time) - toMinutes(b?.time)
      );
    }
    if (payload.end_at === '' || payload.end_at == null) delete payload.end_at;
    if ('nickname' in payload) {
      const trimmed = (payload.nickname || '').trim();
      if (trimmed) payload.nickname = trimmed;
      else delete payload.nickname;
    }

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
    if ('nickname' in clean) {
      if (clean.nickname === null) {
        // leave as null to clear the value
      } else {
        const trimmed = (clean.nickname || '').trim();
        if (trimmed) clean.nickname = trimmed;
        else delete clean.nickname;
      }
    }

    const { error } = await supabase.from(table).update(clean).eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    setEditId(null);
    setEditTable(null);
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
    const allowed = [
      'title','description','start_at','end_at','timezone','type','tge_exchanges','link','nickname',
      'coin_name','coin_quantity','coin_price_link',
    ];
    const patch = Object.fromEntries(
      Object.entries(edit.payload || {}).filter(([k]) => allowed.includes(k))
    );

    if (Array.isArray(patch.tge_exchanges)) {
      patch.tge_exchanges = [...patch.tge_exchanges].sort(
        (a, b) => toMinutes(a?.time) - toMinutes(b?.time)
      );
    }
    if ('nickname' in patch) {
      if (patch.nickname === null) {
        // keep null to clear the field
      } else {
        const trimmed = (patch.nickname || '').trim();
        if (trimmed) patch.nickname = trimmed;
        else delete patch.nickname;
      }
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

  // ===== ДОВІДНИК ТИПІВ =====
  const slugify = (s) =>
    (s || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');


    const makeUniqueSlug = (raw, existingSlugs) => {
    let base = slugify((raw || '').trim() || 'type');
    if (!existingSlugs.has(base)) return base;
    let i = 2;
    while (existingSlugs.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  };
  // Додаємо тип — автоматично у кінець списку
  // додати тип
const addType = async () => {
  const label = newType.label.trim();
  if (!label) return alert('Вкажіть назву типу');

  const { data: all, error: e0 } = await supabase.from('event_types').select('slug');
  if (e0) return alert('Помилка: ' + e0.message);

  const existing = new Set((all || []).map(x => (x.slug || '').trim()));
  const slug = makeUniqueSlug(newType.slug || label, existing);

  const payload = {
    label,
    slug,
    is_tge: !!newType.is_tge,
    active: !!newType.active,
    order_index: Number(newType.order_index || 0),
  };

  const { error } = await supabase.from('event_types').insert(payload);
  if (error) return alert('Помилка: ' + error.message);

  setNewType({ label: '', slug: '', is_tge: false, active: true, order_index: 0 });
  await refresh();
};

// зберегти тип
const saveType = async (row) => {
  const label = row.label.trim();

  const { data: all, error: e0 } = await supabase.from('event_types').select('id, slug');
  if (e0) return alert('Помилка: ' + e0.message);

  const existing = new Set(
    (all || []).filter(x => x.id !== row.id).map(x => (x.slug || '').trim())
  );

  const desired = (row.slug || label).trim();
  const slug = makeUniqueSlug(desired, existing);

  const payload = {
    label,
    slug,
    is_tge: !!row.is_tge,
    active: !!row.active,
    order_index: Number(row.order_index || 0),
  };

  const { error } = await supabase.from('event_types').update(payload).eq('id', row.id);
  if (error) return alert('Помилка: ' + error.message);
  await refresh();
};


  const deleteType = async (id) => {
    if (
      !confirm(
        'Видалити тип? Якщо він використовується в подіях — спершу змініть тип подій або відключіть цей тип (active=false).'
      )
    )
      return;
    const { error } = await supabase.from('event_types').delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== РЕДАГУВАЛКА КАРТКИ =====
  const EditingCard = ({ table, ev }) => {
    const isTGE = ev?.type === 'Listing (TGE)';
    const initial = {
      ...ev,
      // важливо: передаємо в інпут ЛОКАЛЬНИЙ рядок без 'Z'
      start_at: isTGE
        ? toLocalInput(ev.start_at, ev.timezone, 'date')
        : toLocalInput(ev.start_at, ev.timezone, 'datetime'),
      end_at: ev.end_at
        ? toLocalInput(ev.end_at, ev.timezone, 'datetime')
        : '',
    };

    return (
      <div className="card p-4">
        <div className="text-sm text-gray-500 mb-2">Редагування ({table})</div>
        <EventForm
          initial={initial}
          onSubmit={(payload)=> updateRow(table, ev.id, payload)}
          loading={false}
        />
        <div className="flex gap-2 mt-3">
          <button
            className="btn-secondary px-4 py-2 rounded-xl"
            onClick={()=>{ setEditId(null); setEditTable(null); }}
          >
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
            autoFocus
            type="password"
            className="input"
            placeholder="Пароль"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button className="btn w-full mt-3" onClick={() => setOk(pass === import.meta.env.VITE_ADMIN_PASS)}>
            Увійти
          </button>
          <p className="text-xs text-gray-500 mt-2">Пароль знає лише адміністратор.</p>
        </div>
      </div>
    );
  }

  // Відсортований список для коректної роботи стрілок
  const sortedTypes = [...types].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || (a.label || '').localeCompare(b.label || '')
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Адмін-панель</h1>
        <button className="btn-secondary px-3 py-2 rounded-xl" onClick={refresh}>
          Оновити
        </button>
      </div>

      {/* Заявки на модерації */}
      <section>
        <h2 className="font-semibold mb-2">Заявки на модерації</h2>
        {pending.length === 0 && <p className="text-sm text-gray-600">Немає заявок.</p>}
        <div className="space-y-3">
          {pending.map((ev) => (
            <article key={ev.id} className="card p-4">
              {editId === ev.id && editTable === 'events_pending' ? (
                <EditingCard table="events_pending" ev={ev} />
              ) : (
                <>
                  <div className="text-xs text-gray-500">
                    {dayjs(ev.created_at).format('DD MMM HH:mm')}
                  </div>
                  <h3 className="font-semibold">{ev.title}</h3>
                  {ev.description && (
                    <p className="text-sm text-gray-600 mt-1">{ev.description}</p>
                  )}
                  <div className="text-sm mt-2 flex flex-wrap items-center gap-2">
                    <TypeBadge type={ev.type} />
                    <span className="event-when">🕒 {formatEventDate(ev)}</span>
                    {ev.link && (
                      <a className="underline" href={ev.link} target="_blank" rel="noreferrer">Лінк</a>
                    )}
                  </div>

                  {(ev.coin_name || ev.coin_quantity !== undefined || ev.coin_price_link) && (
                    <div className="mt-2 text-xs text-gray-600 flex flex-wrap items-center gap-3">
                      {ev.coin_name && (
                        <span>
                          Монета: <span className="font-medium text-gray-800">{ev.coin_name}</span>
                        </span>
                      )}
                      {ev.coin_quantity !== undefined && ev.coin_quantity !== null && !Number.isNaN(Number(ev.coin_quantity)) && (
                        <span>
                          Кількість:{' '}
                          <span className="font-medium text-gray-800">
                            {formatCoinQuantity(ev.coin_quantity)}
                          </span>
                        </span>
                      )}
                      {ev.coin_price_link && (
                        <a
                          className="underline"
                          href={ev.coin_price_link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Debot
                        </a>
                      )}
                    </div>
                  )}
                  {formatNickname(ev.nickname) && (
                    <div className="mt-2 text-xs text-gray-500">
                      Нікнейм: {formatNickname(ev.nickname)}
                    </div>
                  )}
                  <RowActions>
                    <button className="btn" onClick={() => approve(ev)}>
                      Схвалити
                    </button>
                    <button className="btn-secondary" onClick={() => reject(ev)}>
                      Відхилити
                    </button>
                    <div className="flex gap-2">
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setEditId(ev.id);
                          setEditTable('events_pending');
                        }}
                      >
                        Редагувати
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => removeRow('events_pending', ev.id)}
                      >
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
          {edits.map((ed) => {
            const base = ed.events_approved || {};
            const patch = ed.payload || {};
            const next = { ...base, ...patch };

            const changed = [];
            if (patch.title && patch.title !== base.title)
              changed.push(
                <DiffRow key="title" label="Заголовок" oldVal={base.title} newVal={patch.title} />
              );
            if (patch.description !== undefined && patch.description !== base.description)
              changed.push(
                <DiffRow
                  key="desc"
                  label="Опис"
                  oldVal={base.description || '—'}
                  newVal={patch.description || '—'}
                />
              );
            if (patch.type && patch.type !== base.type)
              changed.push(<DiffRow key="type" label="Тип" oldVal={base.type} newVal={patch.type} />);
            if (patch.timezone && patch.timezone !== base.timezone)
              changed.push(
                <DiffRow
                  key="tz"
                  label="Часова зона"
                  oldVal={base.timezone || 'UTC'}
                  newVal={patch.timezone || 'UTC'}
                />
              );

            const baseStart = prettyDate(base.type, base.start_at, base.timezone);
            const nextStart = prettyDate(next.type, next.start_at, next.timezone);
            if (patch.start_at !== undefined || patch.type !== undefined || patch.timezone !== undefined)
              if (baseStart !== nextStart)
                changed.push(
                  <DiffRow key="start" label="Початок" oldVal={baseStart} newVal={nextStart} />
                );

            const baseEnd = prettyDate(base.type, base.end_at, base.timezone);
            const nextEnd = prettyDate(next.type, next.end_at, next.timezone);
            if (patch.end_at !== undefined || patch.type !== undefined || patch.timezone !== undefined)
              if (baseEnd !== nextEnd)
                changed.push(<DiffRow key="end" label="Кінець" oldVal={baseEnd} newVal={nextEnd} />);

            if (
              patch.tge_exchanges !== undefined &&
              !sameExchanges(base.tge_exchanges, patch.tge_exchanges)
            )
              changed.push(
                <DiffRow
                  key="ex"
                  label="Біржі (TGE)"
                  oldVal={base.tge_exchanges}
                  newVal={patch.tge_exchanges}
                  chips
                />
              );

            if (patch.link !== undefined && patch.link !== base.link)
              changed.push(
                <DiffRow key="link" label="Посилання" oldVal={base.link || '—'} newVal={patch.link || '—'} />
              );
            if (patch.nickname !== undefined && patch.nickname !== base.nickname)
              changed.push(
                <DiffRow
                  key="nickname"
                  label="Нікнейм"
                  oldVal={formatNickname(base.nickname) || '—'}
                  newVal={
                    patch.nickname === null
                      ? '—'
                      : formatNickname(patch.nickname) || '—'
                  }
                />
              );
            if (patch.coin_name !== undefined && patch.coin_name !== base.coin_name)
              changed.push(
                <DiffRow
                  key="coin_name"
                  label="Монета"
                  oldVal={base.coin_name || '—'}
                  newVal={patch.coin_name || '—'}
                />
              );

            if (patch.coin_quantity !== undefined) {
              const baseQty =
                base.coin_quantity === undefined || base.coin_quantity === null
                  ? null
                  : Number(base.coin_quantity);
              const patchQty =
                patch.coin_quantity === undefined || patch.coin_quantity === null
                  ? null
                  : Number(patch.coin_quantity);
              const qtyChanged =
                (baseQty === null && patchQty !== null) ||
                (baseQty !== null && patchQty === null) ||
                (baseQty !== null && patchQty !== null && !Object.is(baseQty, patchQty));
              if (qtyChanged)
                changed.push(
                  <DiffRow
                    key="coin_quantity"
                    label="Кількість монет"
                    oldVal={baseQty === null ? '—' : formatCoinQuantity(baseQty)}
                    newVal={patchQty === null ? '—' : formatCoinQuantity(patchQty)}
                  />
                );
            }

            if (patch.coin_price_link !== undefined && patch.coin_price_link !== base.coin_price_link)
              changed.push(
                <DiffRow
                  key="coin_price_link"
                  label="Посилання на ціну"
                  oldVal={base.coin_price_link || '—'}
                  newVal={patch.coin_price_link || '—'}
                />
              );
            
            return (
              <article key={ed.id} className="card p-4">
                <div className="text-xs text-gray-500 mb-2">
                  Для івенту <span className="font-medium">#{ed.event_id}</span>
                  {base?.title ? <> • {base.title}</> : null}
                  {' • '}
                  {dayjs(ed.created_at).format('DD MMM HH:mm')}
                </div>

                {changed.length === 0 ? (
                  <div className="text-sm text-gray-600">Зміни не відрізняються від поточного стану.</div>
                ) : (
                  <div className="space-y-2">{changed}</div>
                )}

                <div className="mt-3 flex gap-2">
                  <button className="btn" onClick={() => approveEdit(ed)}>
                    Застосувати
                  </button>
                  <button className="btn-secondary" onClick={() => rejectEdit(ed.id)}>
                    Відхилити
                  </button>
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
          {approved.map((ev) => (
            <article key={ev.id} className="card p-4">
              {editId === ev.id && editTable === 'events_approved' ? (
                <EditingCard table="events_approved" ev={ev} />
              ) : (
                <>
                  <div className="font-semibold">{ev.title}</div>
                  <div className="text-sm mt-1 flex flex-wrap items-center gap-2">
                    <span className="event-when">{formatEventDate(ev)}</span>
                    <TypeBadge type={ev.type} />
                  </div>

                  {(ev.coin_name || ev.coin_quantity !== undefined || ev.coin_price_link) && (
                    <div className="mt-2 text-xs text-gray-600 flex flex-wrap items-center gap-3">
                      {ev.coin_name && (
                        <span>
                          Монета: <span className="font-medium text-gray-800">{ev.coin_name}</span>
                        </span>
                      )}
                      {ev.coin_quantity !== undefined && ev.coin_quantity !== null && !Number.isNaN(Number(ev.coin_quantity)) && (
                        <span>
                          Кількість:{' '}
                          <span className="font-medium text-gray-800">
                            {formatCoinQuantity(ev.coin_quantity)}
                          </span>
                        </span>
                      )}
                      {ev.coin_price_link && (
                        <a
                          className="underline"
                          href={ev.coin_price_link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Debot
                        </a>
                      )}
                    </div>
                  )}
                  {formatNickname(ev.nickname) && (
                    <div className="mt-2 text-xs text-gray-500">
                      Нікнейм: {formatNickname(ev.nickname)}
                    </div>
                  )}
                  <RowActions>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setEditId(ev.id);
                        setEditTable('events_approved');
                      }}
                    >
                      Редагувати
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => removeRow('events_approved', ev.id)}
                    >
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
            <input
              className="input"
              placeholder="Назва (напр., Binance Spot)"
              value={newEx.name}
              onChange={(e) => setNewEx((s) => ({ ...s, name: e.target.value }))}
            />
            <select
              className="input"
              value={newEx.segment}
              onChange={(e) => setNewEx((s) => ({ ...s, segment: e.target.value }))}
            >
              <option>Spot</option>
              <option>Futures</option>
            </select>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={newEx.active}
                onChange={(e) => setNewEx((s) => ({ ...s, active: e.target.checked }))}
              />
              <span className="text-sm">Активна</span>
            </label>
            <div className="flex justify-end">
              <button className="btn" onClick={addExchange}>
                + Додати біржу
              </button>
            </div>
          </div>
        </div>

        {/* Список бірж */}
        {exchanges.length === 0 ? (
          <p className="text-sm text-gray-600">Поки що немає записів.</p>
        ) : (
          <div className="space-y-2">
            {exchanges.map((ex) => (
              <ExchangeRow key={ex.id} ex={ex} onSave={saveExchange} onDelete={deleteExchange} />
            ))}
          </div>
        )}
      </section>

      {/* ===== ДОВІДНИК ТИПІВ ===== */}
      <section>
        <h2 className="font-semibold mb-2">Довідник типів</h2>

        {/* Додавання типу (без інпуту порядку) */}
        <div className="card p-4 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,220px,auto] gap-2">
            <input
              className="input"
              placeholder="Напр., Binance Alpha"
              value={newType.label}
              onChange={(e) => setNewType((s) => ({ ...s, label: e.target.value }))}
            />
            <input
              className="input"
              placeholder="slug (авто з назви)"
              value={newType.slug}
              onChange={(e) => setNewType((s) => ({ ...s, slug: e.target.value }))}
            />
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newType.active}
                    onChange={(e) => setNewType((s) => ({ ...s, active: e.target.checked }))}
                  />
                  <span className="text-sm">Активний</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newType.is_tge}
                    onChange={(e) => setNewType((s) => ({ ...s, is_tge: e.target.checked }))}
                  />
                  <span className="text-sm">TGE</span>
                </label>
              </div>
              <button className="btn" onClick={addType}>
                + Додати тип
              </button>
            </div>
          </div>
        </div>

        {/* Список типів (відсортований) */}
        {sortedTypes.length === 0 ? (
          <p className="text-sm text-gray-600">Поки що немає записів.</p>
        ) : (
          <div className="space-y-2">
            {sortedTypes.map((t, idx) => (
              <TypeRow
                key={t.id}
                t={t}
                onSave={saveType}
                onDelete={deleteType}
                moveType={moveType}
                isFirst={idx === 0}
                isLast={idx === sortedTypes.length - 1}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-2">
          Порада: познач «TGE» лише для типу <b>Listing (TGE)</b>. Інші типи (Binance Alpha, OKX
          Alpha, Token Sales, Claim / Airdrop, Unlocks тощо) залишай як звичайні — для них час
          опційний у формах і відображенні.
        </p>
      </section>
    </div>
  );
}
