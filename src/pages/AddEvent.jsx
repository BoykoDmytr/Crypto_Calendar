import { useState } from 'react'
import { supabase } from '../lib/supabase'
import EventForm from '../components/EventForm'
import Toast from '../components/Toast'


export default function AddEvent(){
const [loading, setLoading] = useState(false)
const [toast, setToast] = useState('')


const submit = async (form) => {
setLoading(true)
const payload = { ...form }
// перетворюємо datetime-local → ISO
if(payload.start_at) payload.start_at = new Date(payload.start_at).toISOString()
if(payload.end_at) payload.end_at = new Date(payload.end_at).toISOString()


const { error } = await supabase.from('events_pending').insert(payload)
setLoading(false)
if(error){ setToast('Помилка: ' + error.message) }
else { setToast('Надіслано! Піде на модерацію.'); }
}


return (
<div className="space-y-4">
<h1 className="text-xl font-semibold">Додати подію</h1>
<p className="text-sm text-gray-600">Після надсилання подія з’явиться після схвалення адміністратором.</p>
<div className="card p-4">
<EventForm onSubmit={submit} loading={loading} />
</div>
<Toast text={toast} onClose={()=>setToast('')} />
</div>
)
}