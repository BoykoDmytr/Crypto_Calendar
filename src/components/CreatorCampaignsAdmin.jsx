import { useEffect, useState } from 'react'
import {
  fetchCreatorCampaigns, fetchCampaignStats, updateCampaign,
  adminSignIn, adminSession,
} from '../lib/earnApi'
import ExchangeIcon, { exchangeMeta } from './ExchangeIcon'

// Секція «Креатор-кампанії» всередині ЄДИНОЇ адмінки сайту (/admin).
// Дані живуть у базі romasya06 (пише бот), тому редагування йде під окремою
// supaRoma-сесією: разовий інпут пароля тут же, в секції. Після переносу
// таблиці в основну базу цей інпут зникне — редагуватиме рідна сесія адмінки.

const STATUS_LABEL = { draft: '📝 чернетка', published: '🟢 опубліковано', archived: '🗄 архів' }
const ADMIN_EMAIL = 'earn-admin@cryptoeventscalendar.com'

function Editor({ c, onSaved }) {
  const [form, setForm] = useState({
    title: c.title || '',
    subtitle: c.subtitle || '',
    steps: (Array.isArray(c.steps) ? c.steps : []).join('\n'),
    reward: c.reward || '',
    reward_class: c.reward_class || 'unclear',
    slots: c.slots ?? '',
    url: c.url || '',
    hashtags: (Array.isArray(c.hashtags) ? c.hashtags : []).join(' '),
    ends_at: c.ends_at ? c.ends_at.slice(0, 16) : '',
    status: c.status,
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    setBusy(true); setMsg('')
    try {
      await updateCampaign(c.id, {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        steps: form.steps.split('\n').map((s) => s.trim()).filter(Boolean),
        reward: form.reward.trim() || null,
        reward_class: form.reward_class,
        slots: form.slots === '' ? null : Number(form.slots),
        url: form.url.trim() || null,
        hashtags: form.hashtags.split(/\s+/).filter(Boolean),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        status: form.status,
      })
      setMsg('✅ Збережено')
      onSaved()
    } catch (e) {
      setMsg('❌ ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 mt-3 text-sm">
      <label className="label">Заголовок</label>
      <input className="input" value={form.title} onChange={set('title')} />
      <label className="label">Підзаголовок</label>
      <input className="input" value={form.subtitle} onChange={set('subtitle')} />
      <label className="label">Кроки (один на рядок)</label>
      <textarea className="input font-mono" rows={5} value={form.steps} onChange={set('steps')} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Нагорода</label>
          <input className="input" value={form.reward} onChange={set('reward')} />
        </div>
        <div>
          <label className="label">Тип нагороди</label>
          <select className="input" value={form.reward_class} onChange={set('reward_class')}>
            <option value="real">💵 реальні</option>
            <option value="locked">🔒 ваучер</option>
            <option value="near_zero">⚪ символічна</option>
            <option value="unclear">❔ не вказано</option>
          </select>
        </div>
        <div>
          <label className="label">Місць (порожньо = без ліміту)</label>
          <input className="input" type="number" value={form.slots} onChange={set('slots')} />
        </div>
        <div>
          <label className="label">Дедлайн (Київ)</label>
          <input className="input" type="datetime-local" value={form.ends_at} onChange={set('ends_at')} />
        </div>
      </div>
      <label className="label">Посилання на кампанію</label>
      <input className="input" value={form.url} onChange={set('url')} />
      <label className="label">Теги (через пробіл)</label>
      <input className="input font-mono" value={form.hashtags} onChange={set('hashtags')} />
      <div className="flex items-center gap-2 mt-1">
        <select className="input !w-auto" value={form.status} onChange={set('status')}>
          <option value="draft">📝 чернетка</option>
          <option value="published">🟢 опубліковано</option>
          <option value="archived">🗄 архів</option>
        </select>
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? 'Зберігаю…' : 'Зберегти'}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  )
}

export default function CreatorCampaignsAdmin() {
  const [session, setSession] = useState(undefined)
  const [pass, setPass] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState({})
  const [open, setOpen] = useState(null)

  useEffect(() => { adminSession().then(setSession) }, [])

  async function load() {
    const [r, s] = await Promise.all([fetchCreatorCampaigns({ all: true }), fetchCampaignStats()])
    setRows(r); setStats(s)
  }
  useEffect(() => { if (session) load().catch((e) => setAuthErr(e.message)) }, [session])

  async function login(e) {
    e.preventDefault()
    setAuthErr('')
    try { setSession(await adminSignIn(ADMIN_EMAIL, pass)) }
    catch (err) { setAuthErr(err.message) }
  }

  if (session === undefined) return <p className="text-sm text-gray-500">…</p>

  if (!session) {
    return (
      <form onSubmit={login} className="flex items-center gap-2 max-w-md">
        <input
          className="input"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="пароль секції кампаній"
        />
        <button className="btn shrink-0" type="submit">Відкрити</button>
        {authErr && <span className="text-red-500 text-sm">{authErr}</span>}
      </form>
    )
  }

  return (
    <div className="grid gap-3">
      {rows.map((c) => {
        const meta = exchangeMeta(c.exchange)
        const st = c.cp_campaign_id != null ? stats[c.cp_campaign_id] : null
        return (
          <div key={c.id} className="card p-4 border-l-4" style={{ borderLeftColor: meta.color }}>
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left"
              onClick={() => setOpen(open === c.id ? null : c.id)}
            >
              <ExchangeIcon exchange={c.exchange} size={18} />
              <span className="font-medium truncate">{c.title}</span>
              <span className="text-xs text-gray-500 ml-auto shrink-0">
                {STATUS_LABEL[c.status] || c.status}
                {st ? ` · 📝${st.posts_observed}` : ''}
              </span>
            </button>
            {open === c.id && <Editor c={c} onSaved={load} />}
          </div>
        )
      })}
      {!rows.length && (
        <p className="text-sm text-gray-500">Кампаній ще немає — тисни «🌐 На сайт» у боті.</p>
      )}
    </div>
  )
}
