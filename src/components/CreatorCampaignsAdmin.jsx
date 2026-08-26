import { useEffect, useState } from 'react'
import { fetchCreatorCampaigns, updateCampaign, deleteCampaign } from '../lib/creatorsApi'
import ExchangeIcon, { exchangeMeta } from './ExchangeIcon'

// Секція «Креатор-кампанії» всередині ЄДИНОЇ адмінки сайту (/admin).
// Кампанії лежать в основній базі сайту, тож тут працює та сама сесія, що й
// у решті адмінки — жодних окремих логінів і паролів.

const STATUS_LABEL = { draft: '📝 чернетка', published: '🟢 опубліковано', archived: '🗄 архів' }

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
    track_enabled: c.track_enabled !== false,
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
        track_enabled: form.track_enabled,
      })
      setMsg('✅ Збережено')
      onSaved()
    } catch (e) {
      setMsg('❌ ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Видалити картку назавжди?')) return
    setBusy(true)
    try { await deleteCampaign(c.id); onSaved() }
    catch (e) { setMsg('❌ ' + e.message); setBusy(false) }
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

      {/* Трекінг: система визначає його сама, тут видно результат і можна вимкнути */}
      <div className="rounded-xl px-3 py-2 mt-1 bg-gray-50 dark:bg-gray-800/60 text-xs">
        {c.track_source ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500 font-medium">📊 Лічильник: {c.track_source}</span>
              <label className="ml-auto flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.track_enabled}
                  onChange={(e) => setForm((f) => ({ ...f, track_enabled: e.target.checked }))}
                />
                увімкнено
              </label>
            </div>
            <div className="text-gray-500 mt-1 font-mono break-all">
              {JSON.stringify(c.track_config)}
            </div>
          </>
        ) : (
          <span className="text-gray-500">
            📊 Лічильника немає — {c.track_note || 'джерело недоступне'}
          </span>
        )}
        {c.stats_synced_at && (
          <div className="text-gray-400 mt-1">
            останнє оновлення: {new Date(c.stats_synced_at).toLocaleString('uk-UA')}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1">
        <select className="input !w-auto" value={form.status} onChange={set('status')}>
          <option value="draft">📝 чернетка</option>
          <option value="published">🟢 опубліковано</option>
          <option value="archived">🗄 архів</option>
        </select>
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? 'Зберігаю…' : 'Зберегти'}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={remove}>
          Видалити
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  )
}

export default function CreatorCampaignsAdmin() {
  const [err, setErr] = useState('')
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)

  async function load() {
    setRows(await fetchCreatorCampaigns({ all: true }))
  }
  useEffect(() => { load().catch((e) => setErr(e.message)) }, [])

  return (
    <div className="grid gap-3">
      {err && <p className="text-red-500 text-sm">{err}</p>}
      {rows.map((c) => {
        const meta = exchangeMeta(c.exchange)
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
                {c.posts_observed != null ? ` · 📝${c.posts_observed}` : ''}
              </span>
            </button>
            {open === c.id && <Editor c={c} onSaved={load} />}
          </div>
        )
      })}
      {!rows.length && !err && (
        <p className="text-sm text-gray-500">Кампаній ще немає — тисни «🌐 На сайт» у боті.</p>
      )}
    </div>
  )
}
