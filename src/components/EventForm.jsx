import { useState } from 'react'


const TYPES = ['TGE','Listing','Airdrop','Product','AMA','Mainnet','Other']


export default function EventForm({ onSubmit, loading }){
const [form, setForm] = useState({ type: 'Other', timezone: 'UTC' })


const change = (k,v)=> setForm(s=>({ ...s, [k]: v }))
const submit = (e)=>{ e.preventDefault(); onSubmit?.(form) }


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
<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
<div>
<label className="label">Початок (UTC) *</label>
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
<label className="label">Таймзона (label)</label>
<input className="input" value={form.timezone||''} onChange={e=>change('timezone', e.target.value)} placeholder="UTC / EET / PST ..."/>
</div>
</div>
<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
<div>
<label className="label">Локація</label>
<input className="input" value={form.location||''} onChange={e=>change('location', e.target.value)} placeholder="Онлайн / Нью-Йорк ..."/>
</div>
<div>
<label className="label">Посилання</label>
<input className="input" value={form.link||''} onChange={e=>change('link', e.target.value)} placeholder="https://..."/>
</div>
</div>
<div>
<label className="label">Ваш email для статусу (необов’язково)</label>
<input className="input" value={form.submitter_email||''} onChange={e=>change('submitter_email', e.target.value)} placeholder="name@email.com"/>
</div>
<div className="pt-2">
<button disabled={loading} className="btn">{loading? 'Надсилаю...' : 'Надіслати на модерацію'}</button>
</div>
</form>
)
}