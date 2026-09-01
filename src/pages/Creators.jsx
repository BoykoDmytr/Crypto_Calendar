import { useEffect, useMemo, useState } from 'react'
import { fetchCreatorCampaigns } from '../lib/creatorsApi'
import ExchangeIcon, { exchangeMeta } from '../components/ExchangeIcon'
import RewardBlock from '../components/RewardBlock'
import Icon from '../components/Icon'

// Вкладка /creators: креатор-кампанії бірж. Мінімум слів, максимум суті.

// Компактні теги типу нагороди. Кампанія може мати кілька (кошти + ваучери).
const CLASS_TAG = {
  real: { icon: 'cash', text: 'Кошти', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  locked: { icon: 'ticket', text: 'Ваучери', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  physical: { icon: 'box', text: 'Мерч', cls: 'bg-sky-500/15 text-sky-500 border-sky-500/30' },
  near_zero: { icon: 'circle', text: 'Символічна', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  unclear: { icon: 'help', text: '—', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
}

// Підпис лічильника залежить від того, ДЕ рахуємо пости
const SOURCE_LABEL = { x: 'у X', 'bitget-insights': 'в Insights', 'binance-square': 'у Square' }

// Скільки кроків показуємо згорнуто. Через різну кількість кроків (3…6) картки
// в сітці розповзались по висоті — головна причина «неохайного» вигляду.
const VISIBLE_STEPS = 3

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

// «Гаряча» = за останню годину зʼявився хоча б один допис. Такі кампанії
// цікаві просто зараз, тому вони йдуть першими (див. сортування нижче).
const isDone = (c) => Boolean(c.ends_at) && Date.parse(c.ends_at) <= Date.now()
const isHot = (c) => !isDone(c) && Number(c.posts_last_60_min || 0) > 0

// Текст на кольорі біржі: жовтий Binance вимагає темного, синій Gate — білого.
function readableOn(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '#FFFFFF'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0B1020' : '#FFFFFF'
}

function CampaignCard({ c }) {
  const [stepsOpen, setStepsOpen] = useState(false)
  const left = timeLeft(c.ends_at)
  const meta = exchangeMeta(c.exchange)
  const hasStats = c.posts_observed != null
  const steps = Array.isArray(c.steps) ? c.steps : []
  const hashtags = Array.isArray(c.hashtags) ? c.hashtags : []
  const tiers = Array.isArray(c.reward_tiers) ? c.reward_tiers : []
  const srcLabel = SOURCE_LABEL[c.track_source] || ''
  const shownSteps = stepsOpen ? steps : steps.slice(0, VISIBLE_STEPS)
  const pct = c.slots != null && c.unique_authors != null
    ? Math.min(100, Math.round((c.unique_authors / c.slots) * 100))
    : null

  return (
    <article
      className="card relative overflow-hidden p-5 flex flex-col gap-3 border-l-4 transition-shadow duration-200 hover:shadow-lg dark:hover:shadow-black/40"
      style={{ borderLeftColor: meta.color }}
    >
      {/* NEW — «язичок» з верхнього краю. Свідомо НЕ в куті: банер у куті
          обтікав border-radius картки й виглядав зламаним. */}
      {isNew(c) && (
        <span className="absolute top-0 left-4 z-10 px-2 pt-[3px] pb-[4px] text-[9px] font-bold leading-none tracking-widest text-black bg-amber-400 rounded-b-md shadow-sm">
          NEW
        </span>
      )}

      <div className="flex items-center gap-2 flex-wrap min-h-[24px]">
        <ExchangeIcon exchange={c.exchange} size={22} />
        <span className="font-semibold c-strong" title={c.platform || meta.label}>{meta.label}</span>
        {classesOf(c).map((k) => {
          const t = CLASS_TAG[k] || CLASS_TAG.unclear
          return (
            <span
              key={k}
              className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap inline-flex items-center gap-1 ${t.cls}`}
            >
              <Icon name={t.icon} size={12} />
              {t.text}
            </span>
          )
        })}

        <span className="ml-auto inline-flex items-center gap-1.5">
          {isHot(c) && (
            <span
              className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-500 inline-flex items-center gap-1"
              title="Дописи зʼявляються просто зараз"
            >
              <Icon name="flame" size={11} />
              гаряче
            </span>
          )}
          {left ? (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1 ${
                left.over ? 'bg-gray-500/15 c-faint' : left.urgent ? 'bg-red-500/15 text-red-500' : 'bg-brand-500/15 text-brand-500'
              }`}
              title={c.ends_at ? `до ${fmtDate(c.ends_at)} (Київ)` : ''}
            >
              {!left.over && <Icon name="clock" size={11} />}
              {left.over ? 'завершено' : left.text}
            </span>
          ) : (
            // Порожнє місце читалось як «забули дату». Пишемо прямо.
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-500/10 c-faint"
              title="Біржа не оголошувала дату завершення — перевірено за первинним анонсом"
            >
              без дедлайну
            </span>
          )}
        </span>
      </div>

      {/* Підзаголовок навмисно НЕ показуємо: ШІ переказував у ньому те саме,
          що вже є в заголовку, кроках і блоці нагороди. Дані в базі лишились —
          якщо колись знадобиться, повернути можна одним рядком. */}
      <h3 className="font-semibold text-lg leading-snug break-words c-strong min-w-0">{c.title}</h3>

      {steps.length > 0 && (
        <div>
          <ol className="text-sm space-y-1.5">
            {shownSteps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className="shrink-0 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: meta.color, color: readableOn(meta.color) }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 break-words">{s}</span>
              </li>
            ))}
          </ol>
          {steps.length > VISIBLE_STEPS && (
            <button
              type="button"
              onClick={() => setStepsOpen((v) => !v)}
              className="mt-1.5 ml-7 text-[12px] font-medium text-brand-500 hover:underline"
            >
              {stepsOpen ? 'згорнути кроки' : `показати всі ${steps.length} кроки ▾`}
            </button>
          )}
        </div>
      )}

      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => navigator.clipboard?.writeText(hashtags.join(' '))}
              className="text-xs font-mono px-2 py-0.5 rounded-md c-panel c-muted hover:c-strong"
              title="Клік — скопіювати всі теги"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      {/* нагорода: головна цифра великим, деталі дрібніше, курс окремим рядком */}
      <RewardBlock reward={c.reward} tiers={tiers} slots={c.slots} accent={meta.color} />

      {hasStats && (
        <div className="rounded-xl px-3 py-2.5 c-panel">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="whitespace-nowrap inline-flex items-center gap-1.5" title={`Пости ${srcLabel}, що відповідають умовам`}>
              <Icon name="post" className="c-faint" />
              <b className="c-strong">{c.posts_observed ?? 0}</b>
              <span className="c-muted">постів {srcLabel}</span>
            </span>
            <span className="whitespace-nowrap inline-flex items-center gap-1.5" title={`Унікальні автори ${srcLabel}`}>
              <Icon name="users" className="c-faint" />
              <b className="c-strong">{c.unique_authors ?? 0}</b>
              <span className="c-muted">авторів</span>
            </span>
            {/* Темп: головне число для рішення «чи варто писати зараз».
                На завершених ховаємо — там він завжди нуль. */}
            {!left?.over && c.posts_last_60_min != null && (
              <span
                className={`whitespace-nowrap inline-flex items-center gap-1.5 ${c.posts_last_60_min > 0 ? 'text-orange-500' : ''}`}
                title="Дописів за останню годину — поточний темп конкуренції"
              >
                <Icon name="bolt" />
                <b>{c.posts_last_60_min}</b>
                <span className={c.posts_last_60_min > 0 ? '' : 'c-muted'}>/год</span>
              </span>
            )}
            {c.authors_today != null && c.authors_today > 0 && (
              <span className="text-emerald-500 whitespace-nowrap" title="Нові автори з 03:00 за Києвом">
                +{c.authors_today} сьогодні
              </span>
            )}
          </div>

          {/* Заповнення місць смужкою: відсоток видно з першого погляду */}
          {pct != null && (
            <div className="mt-2.5">
              <div className="flex items-baseline justify-between text-[11px] mb-1">
                <span className="c-muted">
                  {c.unique_authors} з {c.slots.toLocaleString('uk-UA')} місць
                </span>
                <span className="font-semibold c-strong">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden c-bar">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${Math.max(pct, 2)}%`, background: meta.color }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {c.track_note && (
        <p className="text-[11px] leading-snug c-faint flex gap-1.5">
          <Icon name="info" size={13} className="mt-[2px]" />
          <span className="min-w-0">{c.track_note}</span>
        </p>
      )}

      <div className="flex items-center flex-wrap gap-x-3 gap-y-2 mt-auto pt-1">
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="btn text-sm !py-1.5">
            Взяти участь →
          </a>
        )}
        {c.stats_synced_at && (
          <span className="text-[11px] c-faint ml-auto">дані: {fmtDate(c.stats_synced_at)}</span>
        )}
      </div>
    </article>
  )
}

// Скелетон замість тексту «Завантаження…»: сторінка одразу має свою форму,
// і перемикання на реальні картки не стрибає.
function CardSkeleton() {
  return (
    <div className="card p-5 flex flex-col gap-3 border-l-4 border-l-transparent" aria-hidden="true">
      <div className="flex items-center gap-2">
        <div className="w-[22px] h-[22px] rounded-full c-skeleton" />
        <div className="h-4 w-20 rounded c-skeleton" />
        <div className="h-4 w-16 rounded-full c-skeleton" />
        <div className="h-4 w-14 rounded-full c-skeleton ml-auto" />
      </div>
      <div className="h-5 w-4/5 rounded c-skeleton" />
      <div className="h-3.5 w-full rounded c-skeleton" />
      <div className="space-y-2 mt-1">
        <div className="h-3.5 w-11/12 rounded c-skeleton" />
        <div className="h-3.5 w-10/12 rounded c-skeleton" />
        <div className="h-3.5 w-9/12 rounded c-skeleton" />
      </div>
      <div className="h-20 rounded-xl c-skeleton mt-1" />
      <div className="h-8 w-32 rounded-xl c-skeleton mt-1" />
    </div>
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

  // Завершені йдуть ВНИЗ окремою секцією — як «Актуальні/Завершені» на /live.
  // Бек віддає впорядковано за ends_at asc, тому без цього поділу першими на
  // сторінці опинялись саме мертві кампанії (у них дата найменша).
  const { active, done } = useMemo(() => {
    const list = (rows || [])
      .filter((r) => exchange === 'all' || r.exchange === exchange)
      .filter((r) => kind === 'all' || classesOf(r).includes(kind))

    // безстрокові — в кінець живих, решта за найближчим дедлайном
    const byDeadline = (a, b) => {
      if (!a.ends_at && !b.ends_at) return 0
      if (!a.ends_at) return 1
      if (!b.ends_at) return -1
      return Date.parse(a.ends_at) - Date.parse(b.ends_at)
    }

    return {
      // ГАРЯЧІ ЗВЕРХУ: кампанія, де дописи йдуть просто зараз, корисніша за ту,
      // що просто раніше закінчується. Решта — за дедлайном, як і було.
      active: list
        .filter((r) => !isDone(r))
        .sort((a, b) => {
          const ha = isHot(a), hb = isHot(b)
          if (ha !== hb) return ha ? -1 : 1
          if (ha && hb) return (b.posts_last_60_min - a.posts_last_60_min) || byDeadline(a, b)
          return byDeadline(a, b)
        }),
      // серед завершених зверху найсвіжіші
      done: list.filter(isDone).sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at)),
    }
  }, [rows, exchange, kind])
  const visible = active.length + done.length

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-4 flex items-center justify-between gap-x-4 gap-y-3 flex-wrap">
        <h1 className="text-2xl font-bold c-strong">Пости і стріми за нагороди</h1>
        <div className="inline-flex rounded-full border p-0.5 text-sm shrink-0 c-chip">
          {[
            ['all', null, 'Все'],
            ['real', 'cash', 'Кошти'],
            ['locked', 'ticket', 'Ваучери'],
          ].map(([k, icon, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1 rounded-full transition whitespace-nowrap inline-flex items-center gap-1.5 ${
                kind === k ? 'bg-brand-600 text-white' : 'hover:text-brand-500'
              }`}
            >
              {icon && <Icon name={icon} size={13} />}
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => setExchange('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition inline-flex items-center gap-1.5 ${
            exchange === 'all' ? 'bg-brand-600 text-white border border-brand-600' : 'c-chip'
          }`}
        >
          Всі{rows ? ` · ${rows.length}` : ''}
        </button>
        {exchanges.map((ex) => {
          const meta = exchangeMeta(ex)
          const n = (rows || []).filter((r) => r.exchange === ex).length
          const on = exchange === ex
          return (
            <button
              key={ex}
              type="button"
              onClick={() => setExchange(ex)}
              // Активний чіп — у бренд-кольорі біржі: сторінка одразу читається
              // як «біржова», а не як список однакових синіх кнопок.
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition inline-flex items-center gap-1.5 ${on ? 'border' : 'c-chip'}`}
              style={on ? { background: meta.color, borderColor: meta.color, color: readableOn(meta.color) } : undefined}
            >
              <ExchangeIcon exchange={ex} size={16} />
              {meta.label} · {n}
            </button>
          )
        })}
      </div>

      {error && <div className="card p-4 text-red-500 text-sm">Не вдалося завантажити: {error}</div>}

      {!rows && !error && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {rows && !visible && (
        <div className="card p-8 text-center c-muted">Нічого не знайдено за цим фільтром.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {active.map((c) => (
          <CampaignCard key={c.id} c={c} />
        ))}
      </div>

      {done.length > 0 && (
        <>
          <div className="flex items-center gap-3 mt-8 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider c-faint">
              Завершені · {done.length}
            </h2>
            <span className="h-px flex-1 c-rule" />
            <span className="text-[11px] c-faint">зникають автоматично через 30 днів</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 opacity-60 hover:opacity-100 transition-opacity">
            {done.map((c) => (
              <CampaignCard key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
