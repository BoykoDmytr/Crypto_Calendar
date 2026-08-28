import { useEffect, useMemo, useState } from 'react'
import { fetchCreatorCampaigns } from '../lib/creatorsApi'
import ExchangeIcon, { exchangeMeta } from '../components/ExchangeIcon'
import RewardBlock from '../components/RewardBlock'

// Прихована вкладка /creators: креатор-кампанії бірж. Мінімум слів, максимум суті.

// Компактні теги типу нагороди. Кампанія може мати кілька (кошти + ваучери).
const CLASS_TAG = {
  real: { text: '💵 Кошти', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  locked: { text: '🎟 Ваучери', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  physical: { text: '📦 Мерч', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  near_zero: { text: '⚪ Символічна', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  unclear: { text: '❔', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
}

// Підпис лічильника залежить від того, ДЕ рахуємо пости
const SOURCE_LABEL = { x: 'у X', 'bitget-insights': 'в Insights', 'binance-square': 'у Square' }

function classesOf(c) {
  const arr = Array.isArray(c.reward_classes) && c.reward_classes.length
    ? c.reward_classes
    : [c.reward_class || 'unclear']
  return [...new Set(arr)].slice(0, 2)
}

function timeLeft(endsAt) {
  if (!endsAt) return null
  const ms = Date.parse(endsAt) - Date.now()
  if (ms <= 0) return { text: 'завершено', urgent: false, over: true }
  const d = Math.floor(ms / 86400e3)
  const h = Math.floor((ms % 86400e3) / 3600e3)
  const m = Math.floor((ms % 3600e3) / 60e3)
  return { text: d > 0 ? `${d}д ${h}г` : h > 0 ? `${h}г ${m}хв` : `${m}хв`, urgent: ms < 36 * 3600e3, over: false }
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null

const isNew = (c) => c.created_at && Date.now() - Date.parse(c.created_at) < 24 * 3600e3

function CampaignCard({ c }) {
  const left = timeLeft(c.ends_at)
  const meta = exchangeMeta(c.exchange)
  const hasStats = c.posts_observed != null
  const steps = Array.isArray(c.steps) ? c.steps : []
  const hashtags = Array.isArray(c.hashtags) ? c.hashtags : []
  const tiers = Array.isArray(c.reward_tiers) ? c.reward_tiers : []
  const srcLabel = SOURCE_LABEL[c.track_source] || ''

  return (
    <article
      className="card relative overflow-hidden p-5 flex flex-col gap-3 border-l-4"
      style={{ borderLeftColor: meta.color }}
    >
      {/* NEW живе на банері зліва зверху: не займає місця в рядку заголовка */}
      {isNew(c) && (
        <span
          className="absolute left-0 top-0 z-10 text-[9px] font-bold leading-none tracking-widest text-white px-1.5 py-1 rounded-br-lg"
          style={{ background: meta.color }}
        >
          NEW
        </span>
      )}

      <div className="flex items-center gap-2 flex-wrap min-h-[24px]">
        <ExchangeIcon exchange={c.exchange} size={22} />
        <span className="font-semibold" title={c.platform || meta.label}>{meta.label}</span>
        {classesOf(c).map((k) => {
          const t = CLASS_TAG[k] || CLASS_TAG.unclear
          return (
            <span key={k} className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${t.cls}`}>{t.text}</span>
          )
        })}
        {left ? (
          <span
            className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
              left.over ? 'bg-gray-500/15 text-gray-400' : left.urgent ? 'bg-red-500/15 text-red-500' : 'bg-brand-500/15 text-brand-500'
            }`}
            title={c.ends_at ? `до ${fmtDate(c.ends_at)} (Київ)` : ''}
          >
            {left.over ? 'завершено' : `⏳ ${left.text}`}
          </span>
        ) : (
          // Порожнє місце читалось як «забули дату». Пишемо прямо: дедлайну немає.
          <span
            className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-500/10 text-gray-400"
            title="Біржа не оголошувала дату завершення — перевірено за первинним анонсом"
          >
            без дедлайну
          </span>
        )}
      </div>

      <div className="min-w-0">
        <h3 className="font-semibold text-lg leading-snug break-words">{c.title}</h3>
        {c.subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 break-words">{c.subtitle}</p>}
      </div>

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
              <span className="min-w-0 break-words">{s}</span>
            </li>
          ))}
        </ol>
      )}

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

      {/* нагорода: окремі рядки + курс окремим рядком унизу (без ховера) */}
      <RewardBlock reward={c.reward} tiers={tiers} slots={c.slots} accent={meta.color} />

      {hasStats && (
        <div className="flex items-start justify-between gap-3 text-sm rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="flex flex-wrap gap-x-4 gap-y-1 min-w-0">
            <span className="whitespace-nowrap" title={`Пости ${srcLabel}, що відповідають умовам`}>
              📝 <b>{c.posts_observed ?? 0}</b> постів {srcLabel}
            </span>
            <span className="whitespace-nowrap" title={`Унікальні автори ${srcLabel}`}>
              👥 <b>{c.unique_authors ?? 0}</b> авторів {srcLabel}
            </span>
            {c.authors_today != null && c.authors_today > 0 && (
              <span className="text-emerald-500 whitespace-nowrap" title="Нові автори з 03:00 за Києвом">
                +{c.authors_today} сьогодні
              </span>
            )}
          </div>
          {c.slots != null && c.unique_authors != null && (
            <span className="shrink-0 text-xs text-gray-500 whitespace-nowrap pt-0.5">
              ~{Math.min(100, Math.round((c.unique_authors / c.slots) * 100))}% зайнято
            </span>
          )}
        </div>
      )}

      {c.track_note && (
        <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">ⓘ {c.track_note}</p>
      )}

      <div className="flex items-center flex-wrap gap-x-3 gap-y-2 mt-auto pt-1">
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="btn text-sm !py-1.5">
            Взяти участь →
          </a>
        )}
        {c.stats_synced_at && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">
            дані: {fmtDate(c.stats_synced_at)}
          </span>
        )}
      </div>
    </article>
  )
}

export default function Creators() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [exchange, setExchange] = useState('all')
  const [kind, setKind] = useState('all') // all | real | locked

  useEffect(() => {
    let alive = true
    const load = () =>
      fetchCreatorCampaigns()
        .then((r) => alive && setRows(r))
        .catch((e) => alive && setError(e.message))
    load()
    const t = setInterval(load, 120e3)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const exchanges = useMemo(() => [...new Set((rows || []).map((r) => r.exchange))].sort(), [rows])

  const visible = useMemo(
    () =>
      (rows || [])
        .filter((r) => exchange === 'all' || r.exchange === exchange)
        .filter((r) => kind === 'all' || classesOf(r).includes(kind)),
    [rows, exchange, kind]
  )

  const chip = (active) =>
    `px-3 py-1.5 rounded-full text-sm font-medium border transition inline-flex items-center gap-1.5 ${
      active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-500'
    }`

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-5 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Пости і стріми за нагороди</h1>
      </header>

      {/* один компактний ряд: біржі + перемикач типу нагороди */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button type="button" onClick={() => setExchange('all')} className={chip(exchange === 'all')}>
          Всі{rows ? ` · ${rows.length}` : ''}
        </button>
        {exchanges.map((ex) => {
          const meta = exchangeMeta(ex)
          const n = (rows || []).filter((r) => r.exchange === ex).length
          return (
            <button key={ex} type="button" onClick={() => setExchange(ex)} className={chip(exchange === ex)}>
              <ExchangeIcon exchange={ex} size={16} />
              {meta.label} · {n}
            </button>
          )
        })}

        {/* сегментований перемикач: Кошти / Ваучери. Мінімалістичний, тягнеться і на мобілці */}
        <div className="ml-auto inline-flex rounded-full border border-gray-300 dark:border-gray-700 p-0.5 text-sm">
          {[
            ['all', 'Все'],
            ['real', '💵 Кошти'],
            ['locked', '🎟 Ваучери'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1 rounded-full transition ${
                kind === k
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:text-brand-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card p-4 text-red-500 text-sm">Не вдалося завантажити: {error}</div>}
      {!rows && !error && <div className="text-gray-500 text-sm">Завантаження…</div>}
      {rows && !visible.length && (
        <div className="card p-8 text-center text-gray-500">Нічого не знайдено за цим фільтром.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((c) => (
          <CampaignCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  )
}
