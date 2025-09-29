import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import EventCard from '../components/EventCard'


const TYPES = ['All','TGE','Listing','Airdrop','Product','AMA','Mainnet','Other']


export default function Calendar(){
const [events, setEvents] = useState([])
const [type, setType] = useState('All')
const [loading, setLoading] = useState(true)


useEffect(()=>{ (async()=>{
setLoading(true)
let q = supabase.from('events_approved').select('*').order('start_at',{ ascending: true })
const { data, error } = await q
if(!error) setEvents(data || [])
setLoading(false)
})() },[])


const items = events.filter(ev => type==='All' ? true : ev.type===type)


return (
<div>
<div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-1">
{TYPES.map(t=> (
<button key={t} onClick={()=>setType(t)} className={`px-3 py-1 rounded-full border ${type===t?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>{t}</button>
))}
</div>


<div className="mt-3">
{loading && <p>Завантаження...</p>}
{!loading && items.length===0 && <p>Поки що немає подій.</p>}
{items.map(ev => <EventCard key={ev.id} ev={ev} />)}
</div>
</div>
)
}