import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import dayjs from 'dayjs'

export default function Admin(){
  const [pass, setPass] = useState('')
  const [ok, setOk] = useState(false)
  const [pending, setPending] = useState([])
  const [approved, setApproved] = useState([])
  const [commentMap, setCommentMap] = useState({})

  useEffect(()=>{ if(!ok) return; refresh() },[ok])

  const refresh = async ()=>{
    const [p,a] = await Promise.all([
      supabase.from('events_pending').select('*').order('created_at', { ascending: true }),
      supabase.from('events_approved').select('*').order('start_at', { ascending: true }),
    ])
    if(!p.error) setPending(p.data||[])
    if(!a.error) setApproved(a.data||[])
  }

  const approve = async (ev)=>{
    if(!ok) return
    const payload = { ...ev }
    delete payload.id
    delete payload.status
    delete payload.admin_comment
    // запис у approved
    const { error } = await supabase.from('events_approved').insert({ ...payload })
    if(error) return alert('Помилка: '+error.message)
    // видалення з pending
    await supabase.from('events_pending').delete().eq('id', ev.id)
    await refresh()
  }

  const reject = async (ev)=>{
    const admin_comment = commentMap[ev.id] || ''
    const { error } = await supabase.from('events_pending')
      .update({ status: 'rejected', admin_comment })
      .eq('id', ev.id)
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-gray-500">{dayjs(ev.created_at).format('DD MMM HH:mm')}</div>
                  <h3 className="font-semibold">{ev.title}</h3>
                  {ev.description && <p className="text-sm text-gray-600 mt-1">{ev.description}</p>}
                  <div className="text-sm mt-2 flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded-md bg-gray-100">{ev.type}</span>
                    <span>🕒 {dayjs(ev.start_at).format('DD MMM YYYY, HH:mm')} {ev.timezone}</span>
                    {ev.location && <span>📍 {ev.location}</span>}
                    {ev.link && <a className="underline" href={ev.link} target="_blank">Лінк</a>}
                    {ev.submitter_email && <span>✉️ {ev.submitter_email}</span>}
                  </div>
                  {ev.status==='rejected' && <div className="mt-2 text-sm text-red-600">Відхилено: {ev.admin_comment||'без коментаря'}</div>}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button className="btn" onClick={()=>approve(ev)}>Схвалити</button>
                <input className="input" placeholder="Коментар для відмови (опц.)"
                       value={commentMap[ev.id]||''}
                       onChange={e=> setCommentMap(m=>({ ...m, [ev.id]: e.target.value }))} />
                <button className="btn-secondary" onClick={()=>reject(ev)}>Відхилити</button>
              </div>
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
              <div className="font-semibold">{ev.title}</div>
              <div className="text-sm text-gray-600">{dayjs(ev.start_at).format('DD MMM YYYY, HH:mm')} {ev.timezone} • {ev.type}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
