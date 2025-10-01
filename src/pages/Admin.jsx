import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import dayjs from 'dayjs'
import EventForm from '../components/EventForm'

function RowActions({ children }){ return <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">{children}</div> }

export default function Admin(){
  const [pass, setPass] = useState('')
  const [ok, setOk] = useState(false)
  const [pending, setPending] = useState([])
  const [approved, setApproved] = useState([])
  const [editId, setEditId] = useState(null)      // id, що редагується
  const [editTable, setEditTable] = useState(null) // 'events_pending' | 'events_approved'

  useEffect(()=>{ if(!ok) return; refresh() },[ok])

  const refresh = async ()=>{
    const [p,a] = await Promise.all([
      supabase.from('events_pending').select('*').order('created_at', { ascending: true }),
      supabase.from('events_approved').select('*').order('start_at', { ascending: true }),
    ])
    if(!p.error) setPending(p.data||[])
    if(!a.error) setApproved(a.data||[])
  }

  // ✅ вставляємо в approved тільки дозволені колонки
  const approve = async (ev) => {
  // лише дозволені поля в approved
  const allowed = [
    'title','description','start_at','end_at','timezone','type','tge_exchanges','link'
  ];
  const payload = Object.fromEntries(
    Object.entries(ev).filter(([k]) => allowed.includes(k))
  );

  const toMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s || "");
  if (!m) return Number.POSITIVE_INFINITY;
  return (+m[1]) * 60 + (+m[2]);
};

  // ⬇️ НОВЕ: відсортувати біржі за часом перед вставкою
  const ex = Array.isArray(ev.tge_exchanges) ? [...ev.tge_exchanges] : [];
  ex.sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));
  payload.tge_exchanges = ex;

  const { error } = await supabase.from('events_approved').insert(payload);
  if (error) return alert('Помилка: ' + error.message);

  await supabase.from('events_pending').delete().eq('id', ev.id);
  await refresh();
};

  // ❌ Відхилити = просто видалити заявку
  const reject = async (ev)=>{
    if(!confirm('Відхилити і видалити цю заявку?')) return
    const { error } = await supabase.from('events_pending').delete().eq('id', ev.id)
    if(error) return alert('Помилка: ' + error.message)
    await refresh()
  }

  const updateRow = async (table, id, payload)=>{
    const { error } = await supabase.from(table).update(payload).eq('id', id)
    if(error) return alert('Помилка: '+error.message)
    setEditId(null); setEditTable(null)
    await refresh()
  }

  const removeRow = async (table, id)=>{
    if(!confirm('Видалити запис?')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if(error) return alert('Помилка: '+error.message)
    await refresh()
  }

  if(!ok){
    return (
      <div className="max-w-sm mx-auto">
        <h1 className="text-xl font-semibold mb-2">Вхід в адмін-панель</h1>
        <div className="card p-4">
          <input autoFocus type="password" className="input" placeholder="Пароль" value={pass} onChange={e=>setPass(e.target.value)} />
          <button className="btn w-full mt-3" onClick={()=> setOk(pass === import.meta.env.VITE_ADMIN_PASS)}>Увійти</button>
          <p className="text-xs text-gray-500 mt-2">Пароль знає лише адміністратор.</p>
        </div>
      </div>
    )
  }

  const EditingCard = ({table, ev})=> (
    <div className="card p-4">
      <div className="text-sm text-gray-500 mb-2">Редагування ({table})</div>
      <EventForm
        initial={{ ...ev, start_at: ev.start_at?.slice(0,16), end_at: ev.end_at?.slice(0,16) }}
        onSubmit={(payload)=> updateRow(table, ev.id, payload)}
        loading={false}
      />
      <div className="flex gap-2 mt-3">
        <button className="btn-secondary px-4 py-2 rounded-xl" onClick={()=>{setEditId(null); setEditTable(null)}}>Скасувати</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Адмін-панель</h1>
        <button className="btn-secondary px-3 py-2 rounded-xl" onClick={refresh}>Оновити</button>
      </div>

      {/* Pending */}
      <section>
        <h2 className="font-semibold mb-2">Заявки на модерації</h2>
        {pending.length===0 && <p className="text-sm text-gray-600">Немає заявок.</p>}
        <div className="space-y-3">
          {pending.map(ev=> (
            <article key={ev.id} className="card p-4">
              {editId===ev.id && editTable==='events_pending' ? (
                <EditingCard table="events_pending" ev={ev} />
              ) : (
                <>
                  <div className="text-xs text-gray-500">{dayjs(ev.created_at).format('DD MMM HH:mm')}</div>
                  <h3 className="font-semibold">{ev.title}</h3>
                  {ev.description && <p className="text-sm text-gray-600 mt-1">{ev.description}</p>}
                  <div className="text-sm mt-2 flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded-md bg-gray-100">{ev.type}</span>
                    <span>🕒 {dayjs(ev.start_at).format('DD MMM YYYY, HH:mm')} {ev.timezone}</span>
                    {ev.link && <a className="underline" href={ev.link} target="_blank">Лінк</a>}
                  </div>

                  <RowActions>
                    <button className="btn" onClick={()=>approve(ev)}>Схвалити</button>
                    <button className="btn-secondary" onClick={()=>reject(ev)}>Відхилити</button>
                    <div className="flex gap-2">
                      <button className="btn-secondary" onClick={()=>{setEditId(ev.id); setEditTable('events_pending')}}>Редагувати</button>
                      <button className="btn-secondary" onClick={()=>removeRow('events_pending', ev.id)}>Видалити</button>
                    </div>
                  </RowActions>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Approved */}
      <section>
        <h2 className="font-semibold mb-2">Схвалені події</h2>
        {approved.length===0 && <p className="text-sm text-gray-600">Поки що немає.</p>}
        <div className="space-y-3">
          {approved.map(ev=> (
            <article key={ev.id} className="card p-4">
              {editId===ev.id && editTable==='events_approved' ? (
                <EditingCard table="events_approved" ev={ev} />
              ) : (
                <>
                  <div className="font-semibold">{ev.title}</div>
                  <div className="text-sm text-gray-600">{dayjs(ev.start_at).format('DD MMM YYYY, HH:mm')} {ev.timezone} • {ev.type}</div>
                  <RowActions>
                    <button className="btn-secondary" onClick={()=>{setEditId(ev.id); setEditTable('events_approved')}}>Редагувати</button>
                    <button className="btn-secondary" onClick={()=>removeRow('events_approved', ev.id)}>Видалити</button>
                  </RowActions>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
