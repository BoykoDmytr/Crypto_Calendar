import { useState } from 'react'
import { supabase } from '../lib/supabase'
import EventForm from '../components/EventForm'
import Toast from '../components/Toast'

export default function AddEvent(){
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')

  const submit = async (form) => {
    setLoading(true)
    const { error } = await supabase.from('events_pending').insert(form)
    setLoading(false)
    if(error){ setToast('Помилка: ' + error.message) }
    else { setToast('Надіслано! Піде на модерацію.'); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Додати івент</h1>
      <p className="text-sm text-gray-600">Після надсилання івент з’явиться після схвалення адміністратором.</p>
      <div className="card p-4">
        <EventForm onSubmit={submit} loading={loading} />
      </div>
      <Toast text={toast} onClose={()=>setToast('')} />
    </div>
  )
}
