import { useState } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const TYPES = [
  'Listing (TGE)',
  'Binance Alpha',
  'OKX Alpha',
  'Token Sales',
  'Claim / Airdrop',
  'Unlocks',
]

const kyivTZ = 'Europe/Kyiv'

export default function EventForm({ onSubmit, loading, initial }){
  const [form, setForm] = useState(() => ({
    type: 'Listing (TGE)',
    timezone: 'UTC', // label що показуємо поруч із часом
    tge_exchanges: [],
    ...initial
  }))

  const change = (k,v)=> setForm(s=>({ ...s, [k]: v }))

  const addExchange = ()=> change('tge_exchanges', [ ...(form.tge_exchanges||[]), { name: '', time: '' } ])
  const setExchange = (i, key, val)=> {
    const arr = [...(form.tge_exchanges||[])]
    arr[i] = { ...arr[i], [key]: val }
    change('tge_exchanges', arr)
  }
  const removeExchange = (i)=> {
    const arr = [...(form.tge_exchanges||[])]
    arr.splice(i,1)
    change('tge_exchanges', arr)
  }

  const toISO = (localStr, mode)=>{
    if(!localStr) return null
    if(mode==='UTC') return new Date(localStr + 'Z').toISOString() // трактуємо як UTC
    // Europe/Kyiv → UTC
    return dayjs.tz(localStr, kyivTZ).toDate().toISOString()
  }

  const submit = (e)=>{
    e.preventDefault()
    const payload = { ...form }
    // Перетворюємо times у UTC ISO
    if(payload.start_at) payload.start_at = toISO(payload.start_at, form.timezone)
    if(payload.end_at)   payload.end_at   = toISO(payload.end_at,   form.timezone)
    onSubmit?.(payload)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label">Заголовок *</label>
        <input className="input" required value={form.title||''} onChange={e=>change('title', e.target.value)} placeholder="Напр., ASTER TGE"/>
      </div>
      <div>
        <label className="label">Опис</label>
        <textarea className="input min-h-[90px]" value={form.description||''} onChange={e=>change('description', e.target.value)} placeholder="Короткий опис події"/>
      </div>

      {/* Часова зона вибору часу */}
      <div>
        <label className="label">Часова зона вводу</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={()=>change('timezone','UTC')} className={`px-3 py-2 rounded-xl border ${form.timezone==='UTC'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>UTC</button>
          <button type="button" onClick={()=>change('timezone','Kyiv')} className={`px-3 py-2 rounded-xl border ${form.timezone==='Kyiv'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>Київський час</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Вводь час у вибраній зоні — ми збережемо в UTC.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Початок *</label>
          <input type="datetime-local" required className="input" value={form.start_at||''} onChange={e=>change('start_at', e.target.value)} />
        </div>
        <div>
          <label className="label">Кінець (необов’язково)</label>
          <input type="datetime-local" className="input" value={form.end_at||''} onChange={e=>change('end_at', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Тип</label>
          <select className="input" value={form.type} onChange={e=>change('type', e.target.value)}>
            {TYPES.map(t=> <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Посилання</label>
          <input className="input" value={form.link||''} onChange={e=>change('link', e.target.value)} placeholder="https://..."/>
        </div>
      </div>

      {/* Додатковий блок для TGE: біржі + час */}
      {form.type==='Listing (TGE)' && (
        <div className="space-y-2">
          <div className="label">Біржі та час (опц.)</div>
          {(form.tge_exchanges||[]).map((x,i)=> (
            <div key={i} className="grid grid-cols-5 gap-2">
              <input className="input col-span-3" placeholder="Напр., Binance" value={x.name||''} onChange={e=>setExchange(i,'name',e.target.value)} />
              <input type="time" step="60" className="input col-span-1"
       value={x.time || ''} onChange={e=>setExchange(i,'time', e.target.value)} />
              <button type="button" className="btn-secondary" onClick={()=>removeExchange(i)}>–</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={addExchange}>+ Додати біржу</button>
        </div>
      )}

      <div className="pt-2">
        <button disabled={loading} className="btn">{loading? 'Зберігаю...' : 'Надіслати на модерацію'}</button>
      </div>
    </form>
  )
}
