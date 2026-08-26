import { useEffect, useMemo, useState } from 'react'
import { fetchCreatorCampaigns, fetchCampaignStats } from '../lib/earnApi'
import ExchangeIcon, { exchangeMeta } from '../components/ExchangeIcon'

// Прихована вкладка /earn: креатор-кампанії бірж (пости, стріми) — що зробити,
// яка нагорода і скільки людей уже пише. Лінка в навбарі свідомо немає.

const REWARD_BADGE = {
  real: { text: '💵 Реальні кошти', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  locked: { text: '🔒 Ваучер — не виводиться', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  near_zero: { text: '⚪ Символічна', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  unclear: { text: '❔ Тип не вказано', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
}

function timeLeft(endsAt) {
  if (!endsAt) return null
  const ms = Date.parse(endsAt) - Date.now()
  if (ms <= 0) return { text: 'завершено', urgent: false, over: true }
  const d = Math.floor(ms / 86400e3)
  const h = Math.floor((ms % 86400e3) / 3600e3)
  const m = Math.floor((ms % 3600e3) / 60e3)
  const text = d > 0 ? `${d}д ${h}г` : h > 0 ? `${h}г ${m}хв` : `${m}хв`
  return { text, urgent: ms < 36 * 3600e3, over: false }
}

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('uk-UA', {
    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function CampaignCard({ c, stats }) {
  const badge = REWARD_BADGE[c.reward_class] || REWARD_BADGE.unclear
  const left = timeLeft(c.ends_at)
  const meta = exchangeMeta(c.exchange)
  const st = c.cp_campaign_id != null ? stats[c.cp_campaign_id] : null
  const steps = Array.isArray(c.steps) ? c.steps : []
  const hashtags = Array.isArray(c.hashtags) ? c.hashtags : []

  return (
    <article
      className="card p-5 flex flex-col gap-3 border-l-4"
      style={{ borderLeftColor: meta.color }}
    >
      {/* шапка: біржа + бейджі */}
      <div className="flex items-center gap-2 flex-wrap">
        <ExchangeIcon exchange={c.exchange} size={22} />
        <span className="font-semibold">{meta.label}</span>
        {c.platform && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400">
            {c.platform}
          </span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
        {left && (
          <span
            className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
              left.over
                ? 'bg-gray-500/15 text-gray-400'
                : left.urgent
                  ? 'bg-red-500/15 text-red-500'
                  : 'bg-brand-500/15 text-brand-500'
            }`}
            title={c.ends_at ? `до ${fmtDate(c.ends_at)} (Київ)` : ''}
          >
            {left.over ? 'завершено' : `⏳ ${left.text}`}
          </span>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-lg leading-snug">{c.title}</h3>
        {c.subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{c.subtitle}</p>}
      </div>

      {/* що зробити */}
      {steps.length > 0 && (
        <ol className="text-sm space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span
                className="shrink-0 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white"
                style={{ background: meta.color }}
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}

      {/* теги — по кліку копіюються */}
      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => navigator.clipboard?.writeText(hashtags.join(' '))}
              className="text-xs font-mono px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Клік — скопіювати всі теги"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      {/* нагорода */}
      <div className="text-sm">
        <span className="text-gray-500 dark:text-gray-400">Нагорода: </span>
        <span className="font-medium">{c.reward || 'не вказано'}</span>
        {c.slots != null && (
          <span className="text-gray-500 dark:text-gray-400"> · місць: {c.slots}</span>
        )}
      </div>

      {/* лічильник конкуренції — лише там, де працює трекер */}
      {st && (
        <div className="flex items-center gap-4 text-sm rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <span title="Постів, що відповідають умовам кампанії">
            📝 <b>{st.posts_observed ?? 0}</b> постів
          </span>
          <span title="Унікальних авторів">
            👥 <b>{st.unique_authors ?? 0}</b> авторів
          </span>
          {st.posts_last_60_min > 0 && (
            <span className="text-emerald-500" title="За останню годину">+{st.posts_last_60_min}/год</span>
          )}
          {c.slots != null && st.unique_authors != null && (
            <span className="ml-auto text-xs text-gray-500">
              зайнято ~{Math.min(100, Math.round((st.unique_authors / c.slots) * 100))}%
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-auto pt-1">
        {c.url && (
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            className="btn text-sm !py-1.5"
          >
            Взяти участь →
          </a>
        )}
        {st?.last_synced && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">
            дані: {fmtDate(st.last_synced)}
          </span>
        )}
      </div>
    </article>
  )
}

export default function Earn() {
  const [rows, setRows] = useState(null)
  const [stats, setStats] = useState({})
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let alive = true
    Promise.all([fetchCreatorCampaigns(), fetchCampaignStats()])
      .then(([r, s]) => { if (alive) { setRows(r); setStats(s) } })
      .catch((e) => alive && setError(e.message))
    const t = setInterval(() => {
      fetchCampaignStats().then((s) => alive && setStats(s)).catch(() => {})
    }, 120e3)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const exchanges = useMemo(() => {
    const set = new Set((rows || []).map((r) => r.exchange))
    return [...set].sort()
  }, [rows])

  const visible = useMemo(
    () => (rows || []).filter((r) => filter === 'all' || r.exchange === filter),
    [rows, filter]
  )

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Заробіток на постах і стрімах</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Кампанії бірж, де платять за контент. Показуємо умови, тип нагороди і — де це можливо —
          живу кількість постів конкурентів.
        </p>
      </header>

      {/* фільтри */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
            filter === 'all'
              ? 'bg-brand-600 text-white border-brand-600'
              : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-500'
          }`}
        >
          All{rows ? ` · ${rows.length}` : ''}
        </button>
        {exchanges.map((ex) => {
          const meta = exchangeMeta(ex)
          const n = (rows || []).filter((r) => r.exchange === ex).length
          return (
            <button
              key={ex}
              type="button"
              onClick={() => setFilter(ex)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition inline-flex items-center gap-1.5 ${
                filter === ex
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-500'
              }`}
            >
              <ExchangeIcon exchange={ex} size={16} />
              {meta.label} · {n}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="card p-4 text-red-500 text-sm">Не вдалося завантажити: {error}</div>
      )}
      {!rows && !error && <div className="text-gray-500 text-sm">Завантаження…</div>}
      {rows && !visible.length && (
        <div className="card p-8 text-center text-gray-500">
          Поки що немає опублікованих кампаній{filter !== 'all' ? ' по цій біржі' : ''}.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((c) => (
          <CampaignCard key={c.id} c={c} stats={stats} />
        ))}
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-8">
        Лічильники — це публікації, які система спостерігала і які відповідають перевірним умовам
        кампанії. Це не офіційне підтвердження біржі. Умови завжди звіряй на сторінці кампанії.
      </p>
    </div>
  )
}
