import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchOkxCampaigns,
  fetchVolumeHistory,
  fetchFeeTiers,
  subscribeOkxVolume,
} from '../lib/okxApi'
import { supaRoma } from '../lib/supabaseRoma'
import OkxProfitCalculator from '../components/OkxProfitCalculator'
import FlashEarnCalculator from '../components/FlashEarnCalculator'
import Claims from './Claims'
import './Live.css'

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
function compact(v) {
  if (v == null) return '—'
  const x = Number(v)
  if (x >= 1e9) return `${(x / 1e9).toFixed(1).replace('.', ',')}B`
  if (x >= 1e6) return `${(x / 1e6).toFixed(1).replace('.', ',')}M`
  if (x >= 1e3) return `${Math.round(x / 1e3)}K`
  return fmt.format(Math.round(x))
}

const LOGO_COLORS = { TAO: '#2563eb', CARDS: '#d8602e', NES: '#7c3aed', MON: '#0ea5e9', RE: '#10b981' }
const logoColor = (sym) => LOGO_COLORS[sym] || '#475569'

// Flash Earn trade-to-earn (RE тощо) — інша механіка: пропорційна роздача токенів,
// без комісій/VIP. Тому для них ховаємо калькулятор прибутку і USDT-специфічні поля.
const isFlashEarn = (c) => /\/flash-earn\//i.test(c?.page_url || '')

// Приз у токенах (MON, RE), а не в USDT → показуємо і кількість токенів, і $-вартість
// (ціна токена × кількість). Ціна — з okx_volume.token_price_usd (поллер бере з
// OKX-тикера). Кількість = prize_pool (MON) або coin_amount (RE).
const isTokenReward = (c) => !!(c?.prize_currency && String(c.prize_currency).toUpperCase() !== 'USDT')
// Показуємо ТУРНІРНИЙ пул (share_pool) — напр. NES 750K, а не 800K: різниця (50K)
// йде новим користувачам, не в турнір.
const rewardQty = (c) => Number(c?.share_pool ?? c?.prize_pool ?? c?.coin_amount ?? 0) || null
const rewardCur = (c) => c?.prize_currency || c?.coin_symbol || 'USDT'
const tokenPriceUsd = (c) =>
  c?.okx_volume?.token_price_usd != null ? Number(c.okx_volume.token_price_usd) : null

// Компактна сума в $ ($1.2M, $634K, $0.65)
function compactUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return null
  const x = Number(v)
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2).replace('.', ',')}B`
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2).replace('.', ',')}M`
  if (x >= 1e3) return `$${Math.round(x / 1e3)}K`
  if (x >= 1) return `$${x.toFixed(2).replace('.', ',')}`
  return `$${x.toPrecision(2)}`
}

// Вікна приросту обсягу (показуємо «темп накрутки», а не лише суму).
const DELTA_WINDOWS = [
  { key: '5m', ms: 5 * 60_000, label: '5 хв' },
  { key: '10m', ms: 10 * 60_000, label: '10 хв' },
  { key: '30m', ms: 30 * 60_000, label: '30 хв' },
  { key: '1h', ms: 60 * 60_000, label: '1 год' },
  { key: '1d', ms: 24 * 60 * 60_000, label: '1 день' },
]

// Обсяг у момент t (мс) — лінійна інтерполяція між сусідніми точками історії
// (history відсортована за зростанням observed_at). null, якщо t раніше за найдавнішу
// точку (немає даних аж настільки давно — вікно ще «не набралось»).
function volumeAt(history, t) {
  if (!history?.length) return null
  const pts = []
  for (const p of history) {
    const ts = new Date(p.observed_at).getTime()
    const v = Number(p.total_volume)
    if (Number.isFinite(ts) && Number.isFinite(v)) pts.push([ts, v])
  }
  if (!pts.length || t <= pts[0][0]) return null
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= t) {
      const [t0, v0] = pts[i - 1]
      const [t1, v1] = pts[i]
      return t1 === t0 ? v1 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0))
    }
  }
  return pts[pts.length - 1][1]
}

// Монотонний прогрес обсягу для flash-earn (RE). OKX віддає ЕФЕКТИВНИЙ обсяг (сирий ×
// коеф. нагород), який періодично ПЕРЕРАХОВУЄ ВНИЗ (знімає недопустимий обсяг) — на
// графіку це «падіння», хоча люди лише додають обсяг. Тому акумулюємо ЛИШЕ додатні
// прирости: дипи перерахунку ігноруємо (0), а реальне зростання після дипу видно
// одразу (на відміну від cummax, що «заморозив би» до пробиття піку). Повертає новий
// масив із тим самим observed_at, але монотонним total_volume.
function monotonicProgress(history) {
  let acc = null
  let prevRaw = null
  return (history || []).map((p) => {
    const v = Number(p.total_volume)
    if (!Number.isFinite(v)) return p
    if (acc == null) acc = v
    else acc += Math.max(0, v - prevRaw)
    prevRaw = v
    return { ...p, total_volume: acc }
  })
}

function campaignState(c, now) {
  const start = c.start_at ? new Date(c.start_at).getTime() : null
  const end = c.end_at ? new Date(c.end_at).getTime() : null
  if (c.status === 'ended' || (end && end <= now)) return 'ended'
  if (start && start > now) return 'soon'
  return 'live'
}

function timeLeft(endAt, now) {
  if (!endAt) return null
  let s = Math.floor((new Date(endAt).getTime() - now) / 1000)
  if (s <= 0) return null
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  const m = Math.floor((s - h * 3600) / 60)
  if (d > 0) return `${d}д ${h}г`
  if (h > 0) return `${h}г ${m}хв`
  return `${m}хв`
}

function agoLabel(ts, now) {
  if (!ts) return null
  const s = Math.floor((now - new Date(ts).getTime()) / 1000)
  if (s < 3) return 'оновлено щойно'
  if (s < 90) return `оновлено ${s} с тому`
  if (s < 5400) return `оновлено ${Math.round(s / 60)} хв тому`
  return `оновлено ${Math.round(s / 3600)} г тому`
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return null
  const W = 640
  const H = 120
  const pad = 8
  const vals = points.map((p) => Number(p.total_volume))
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const xy = vals.map((v, i) => [
    pad + (i / (vals.length - 1)) * (W - 2 * pad),
    pad + (1 - (v - min) / span) * (H - 2 * pad),
  ])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <div className="live-spark">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="90" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="live-sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3B82F6" stopOpacity=".3" />
            <stop offset="1" stopColor="#3B82F6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L ${lx} ${H - 2} L ${pad} ${H - 2} Z`} fill="url(#live-sg)" />
        <path d={d} fill="none" stroke="#3B82F6" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="4.5" fill="#fff" stroke="#3B82F6" strokeWidth="2.5" />
      </svg>
    </div>
  )
}

export default function Live() {
  const [tab, setTab] = useState('okx')
  const [campaigns, setCampaigns] = useState([])
  const [feeTiers, setFeeTiers] = useState([])
  const [history, setHistory] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const selectedIdRef = useRef(null)
  selectedIdRef.current = selectedId

  async function loadCampaigns() {
    const rows = await fetchOkxCampaigns()
    setCampaigns((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]))
      return rows.map((c) => {
        // не відкочуємо свіжіший realtime-знімок старішою REST-відповіддю
        const old = prevById.get(c.id)?.okx_volume
        const fresh = c.okx_volume
        if (old?.updated_at && (!fresh?.updated_at || new Date(old.updated_at) > new Date(fresh.updated_at))) {
          return { ...c, okx_volume: old }
        }
        return c
      })
    })
    setSelectedId((prev) => {
      if (prev && rows.some((c) => c.id === prev)) return prev
      const nowTs = Date.now()
      const live = rows.find((c) => campaignState(c, nowTs) === 'live')
      return (live || rows[0])?.id ?? null
    })
    setError(null) // транзієнтний збій першого завантаження не має блокувати сторінку назавжди
  }

  async function refreshHistory() {
    const id = selectedIdRef.current
    if (!id) return
    try {
      setHistory(await fetchVolumeHistory(id))
    } catch {
      /* not fatal — realtime/поллінг доженуть */
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        await loadCampaigns()
        if (!cancelled) setFeeTiers(await fetchFeeTiers())
      } catch (e) {
        console.error('[live] load failed', e)
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Realtime: нові знімки обсягу приходять без рефрешу
    const channel = subscribeOkxVolume((row) => {
      setCampaigns((prev) =>
        prev.map((c) => (c.id === row.campaign_id ? { ...c, okx_volume: row } : c)),
      )
      if (row.campaign_id === selectedIdRef.current) {
        // тримаємо глибину ≥24 год (для дельти «за 1 день»); realtime додає точки
        // частіше за БД-історію → дельти стають точнішими під час живої сесії
        setHistory((h) =>
          [...h, {
            total_volume: row.total_volume,
            raw_volume: row.raw_volume ?? null,
            observed_at: row.updated_at,
          }].slice(-360),
        )
      }
    })

    // фолбек, якщо realtime відвалиться + пере-фетч при поверненні на вкладку
    // (історію теж, інакше після сну/бекграунду sparkline і «▲ за 5 хв» застигають)
    const poll = setInterval(() => {
      loadCampaigns().catch(() => {})
      refreshHistory()
    }, 60_000)
    const onVis = () => {
      if (!document.hidden) {
        loadCampaigns().catch(() => {})
        refreshHistory()
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      supaRoma.removeChannel(channel)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // історія для вибраного турніру
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    fetchVolumeHistory(selectedId)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // секундний тік для "оновлено N с тому" / countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const selected = useMemo(
    () => campaigns.find((c) => c.id === selectedId) || null,
    [campaigns, selectedId],
  )
  const others = useMemo(
    () => campaigns.filter((c) => c.id !== selectedId),
    [campaigns, selectedId],
  )

  const anyLive = campaigns.some((c) => campaignState(c, now) === 'live')
  const liveCount = campaigns.filter((c) => campaignState(c, now) === 'live').length

  return (
    <div className="live">
      <div className="live-title">
        LIVE {anyLive && <span className="live-pulse" />}
      </div>
      <div className="live-sub">
        Живий трекінг: обсяги OKX-турнірів і on-chain клейми. Дані оновлюються
        автоматично, без рефрешу.
      </div>

      <div className="live-tabs">
        <button className={`live-tab ${tab === 'okx' ? 'on' : ''}`} onClick={() => setTab('okx')}>
          <img
            className="live-tab-logo live-tab-logo--img"
            src="https://static.coinall.ltd/cdn/oksupport/asset/currency/icon/okb20230419112935.png"
            alt="OKX"
          />
          OKX Турніри
          {anyLive && <span className="live-pulse live-pulse--sm" />}
        </button>
        <button className={`live-tab ${tab === 'claims' ? 'on' : ''}`} onClick={() => setTab('claims')}>
          <span className="live-tab-logo" style={{ background: '#7c3aed', color: '#fff' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 12 20 22 4 22 4 12" />
              <rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
          </span>
          Клейми
        </button>
        <button className="live-tab off" type="button" tabIndex={-1} aria-disabled="true">
          <img
            className="live-tab-logo live-tab-logo--img"
            src="https://static.coinall.ltd/cdn/oksupport/asset/currency/icon/bnb20221218121954.png"
            alt="Binance"
          />
          Binance Hodler · скоро
        </button>
      </div>

      {tab === 'claims' && <Claims />}

      {tab === 'okx' && (
        <>
          {loading && <div className="live-state">Завантаження турнірів…</div>}
          {error && <div className="live-state live-state--error">Помилка: {error}</div>}
          {!loading && !error && campaigns.length === 0 && (
            <div className="live-state">Поки що немає відстежуваних турнірів.</div>
          )}

          {!loading && !error && selected && (
            <>
              <div className="live-section-title">
                OKX Турніри · {liveCount ? `${liveCount} активн${liveCount === 1 ? 'ий' : 'і'}` : 'немає активних'}
              </div>

              <SelectedPanel campaign={selected} history={history} now={now} />

              {others.map((c) => (
                <MiniRow key={c.id} campaign={c} now={now} onSelect={() => setSelectedId(c.id)} />
              ))}

              {isFlashEarn(selected) ? (
                <FlashEarnCalculator
                  campaign={selected}
                  liveTotal={selected.okx_volume?.total_volume ?? null}
                  feeTiers={feeTiers}
                />
              ) : (
                <OkxProfitCalculator
                  campaign={selected}
                  liveVolume={selected.okx_volume?.total_volume ?? null}
                  feeTiers={feeTiers}
                />
              )}
            </>
          )}

          <div className="live-foot">
            Обсяги — зі сторінок кампаній OKX (оновлення ~30–60 с)
            <br />
            Сторінка доступна лише за прямим URL. Не є фінансовою порадою.
          </div>
        </>
      )}
    </div>
  )
}

// Логотип монети: справжня іконка з OKX (okx_campaigns.coin_icon), фолбек — кольорове
// коло з першою літерою символу (якщо іконки нема або не завантажилась).
function CoinLogo({ campaign }) {
  const [failed, setFailed] = useState(false)
  const icon = campaign?.coin_icon
  const sym = campaign?.coin_symbol || '?'
  if (icon && !failed) {
    return (
      <img
        className="live-coin-logo live-coin-logo--img"
        src={icon}
        alt={sym}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="live-coin-logo" style={{ background: logoColor(sym) }}>
      {sym[0]}
    </span>
  )
}

function SelectedPanel({ campaign, history, now }) {
  const state = campaignState(campaign, now)
  const flash = isFlashEarn(campaign)
  const tokenReward = isTokenReward(campaign)
  const vol = campaign.okx_volume
  const effVolume = vol?.total_volume != null ? Number(vol.total_volume) : null // ефективний (залік нагород OKX)
  const rawTraded = vol?.raw_volume != null ? Number(vol.raw_volume) : null // СИРИЙ наторгований (оцінка поллера)
  // flash-earn: головне число і графік — СИРИЙ обсяг (скільки реально накрутили;
  // поллер відновлює його з приростів ефективного, ділячи на коефіцієнти нагород —
  // монотонний за побудовою). Фолбек, поки поллер ще не порахував raw: монотонний
  // ефективний (стара поведінка).
  const rawHist = flash
    ? history
        .filter((p) => p.raw_volume != null)
        .map((p) => ({ observed_at: p.observed_at, total_volume: p.raw_volume }))
    : null
  // сирий «зараз»: свіжий знімок okx_volume, або остання точка сирої історії
  const rawNow =
    rawTraded != null
      ? rawTraded
      : rawHist && rawHist.length
        ? Number(rawHist[rawHist.length - 1].total_volume)
        : null
  const showingRaw = flash && rawNow != null // показуємо сирий обсяг (не фолбек-ефективний)
  const histView = flash ? (rawHist.length ? rawHist : monotonicProgress(history)) : history
  let volume
  if (!flash) {
    volume = effVolume
  } else if (showingRaw) {
    volume = rawNow
  } else {
    // фолбек (raw ще не пораховано): монотонний ефективний + живий приріст
    const progLast = histView.length ? Number(histView[histView.length - 1].total_volume) : null
    const effLast = history.length ? Number(history[history.length - 1].total_volume) : null
    volume =
      effVolume != null && progLast != null && effLast != null
        ? progLast + Math.max(0, effVolume - effLast)
        : effVolume
  }
  // Пул нагород: USDT-турніри → share_pool/prize_pool; токен-приз (MON/RE) → prize_pool/coin_amount
  const pool = Number(campaign.share_pool ?? campaign.prize_pool ?? campaign.coin_amount ?? 0)
  const poolCur = tokenReward ? rewardCur(campaign) : 'USDT'
  // Токен-приз: кількість, валюта, ціна токена ($) і $-вартість усієї нагороди
  const rQty = rewardQty(campaign)
  const rCur = rewardCur(campaign)
  const tPrice = tokenPriceUsd(campaign)
  const rewardUsd = tokenReward && rQty && tPrice ? rQty * tPrice : null
  const left = timeLeft(campaign.end_at, now)
  // Нагорода за 100K обсягу (розмивання пулу) — у валюті пулу. Спираємось на СПРАВЖНІЙ
  // ефективний обсяг (effVolume): це реальний знаменник формули нагороди.
  const per100k = effVolume != null && pool ? (pool * 100_000) / (effVolume + 100_000) : null

  // Приріст обсягу за кілька вікон — «темп накрутки». АНКОР — час ОСТАННЬОГО
  // оновлення обсягу (vol.updated_at), а НЕ живий `now`: інакше інтерполяція на
  // (now − вікно) сповзає щосекунди й числа «мерехтять», хоча дані ті самі. Так
  // дельти міняються ЛИШЕ коли приходить новий знімок (~раз на каденс поллера).
  const latestTs = vol?.updated_at ? new Date(vol.updated_at).getTime() : null
  const deltas = useMemo(() => {
    if (volume == null || latestTs == null) return []
    return DELTA_WINDOWS.map((w) => {
      const past = volumeAt(histView, latestTs - w.ms)
      return past == null ? null : { ...w, d: Math.max(0, volume - past) }
      // ховаємо нульові вікна (для flash-earn histView монотонна → дельти чисті)
    }).filter((w) => w && w.d > 0)
  }, [histView, volume, latestTs])

  return (
    <div className="card live-panel">
      <div className="live-panel-top">
        <div className="live-panel-name">
          <CoinLogo campaign={campaign} />
          {campaign.name}
          {state === 'live' && <span className="live-badge live-badge--live">● LIVE</span>}
          {state === 'soon' && <span className="live-badge live-badge--soon">СКОРО</span>}
          {state === 'ended' && <span className="live-badge live-badge--done">ЗАВЕРШЕНО</span>}
        </div>
        {left && <span className="muted" style={{ fontSize: '.78rem' }}>до кінця {left}</span>}
      </div>

      <div className="live-panel-label">
        {flash ? (showingRaw ? 'Наторговано (сирий обсяг · оцінка)' : 'Ефективний обсяг (залік нагород)') : 'Загальний обсяг турніру'}
        {flash && (
          <span
            className="live-info"
            title={
              showingRaw
                ? 'Скільки реально наторгували учасники. OKX віддає лише ЕФЕКТИВНИЙ (зважений) обсяг — ми відновлюємо сирий з його приростів, ділячи на коефіцієнти нагород (день ×1.8→×1.0, пара ×1.1, дні активності ×1.0-1.3). Оцінка, похибка ~±10-15%. Ефективний обсяг — рядком нижче.'
                : 'Це ЗВАЖЕНИЙ обсяг для розподілу нагород, а не сирий обсяг торгів. OKX множить обсяг на коефіцієнти: день 1 ×1.8 → день 11 ×1.0, пара RE ×1.1.'
            }
          >
            ⓘ
          </span>
        )}
      </div>
      {volume != null ? (
        <>
          <div className="live-panel-volume num">
            {fmt.format(Math.round(volume))} <small>{vol?.currency || 'USDT'}</small>
          </div>
          {showingRaw && effVolume != null && (
            <div className="live-effline num">
              залік нагород (ефективний): {fmt.format(Math.round(effVolume))} USDT
            </div>
          )}
          {deltas.length > 0 && (
            <div className="live-deltas">
              <span className="live-deltas-cap">приріст:</span>
              {deltas.map((w) => (
                <span key={w.key} className="live-delta" title={`Приріст обсягу за останні ${w.label}`}>
                  <span className="live-delta-k">{w.label}</span>
                  <span className="live-delta-v">+{compact(w.d)}</span>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="live-panel-wait">
          очікуємо перший знімок обсягу<span className="muted"> · поллер збирає дані</span>
        </div>
      )}

      <Sparkline points={histView.length > 90 ? histView.slice(-90) : histView} />

      <div className="live-panel-meta">
        <div className="cell">
          <div className="k">Приз</div>
          <div className="v num">{rQty ? `${fmt.format(rQty)} ${rCur}` : '—'}</div>
          {rewardUsd != null && (
            <div className="live-usd num">
              ≈ {compactUsd(rewardUsd)}
              {tPrice != null && <span className="live-usd-px"> · {rCur} {compactUsd(tPrice)}</span>}
            </div>
          )}
        </div>
        <div className="cell">
          <div className="k">Учасників</div>
          <div className="v num">{vol?.participants != null ? fmt.format(vol.participants) : '—'}</div>
        </div>
        <div className="cell">
          <div className="k">За 100K обсягу зараз</div>
          <div className="v num" style={{ color: '#fbbf24' }}>
            {per100k != null ? `≈ ${fmt.format(Math.round(per100k))} ${poolCur}` : '—'}
          </div>
          {per100k != null && tokenReward && tPrice != null && (
            <div className="live-usd num">≈ {compactUsd(per100k * tPrice)}</div>
          )}
        </div>
      </div>

      <div className="live-panel-foot">
        <span className="live-upd">
          {agoLabel(vol?.updated_at, now) || 'дані ще не надходили'}
          {campaign.page_url && (
            <>
              {' · '}
              <a href={campaign.page_url} target="_blank" rel="noreferrer">кампанія ↗</a>
            </>
          )}
        </span>
        <button
          className="btn"
          type="button"
          onClick={() => document.getElementById('okx-calc')?.scrollIntoView({ behavior: 'smooth' })}
        >
          {flash ? 'Стратегія і прибуток →' : 'Порахувати мій прибуток →'}
        </button>
      </div>
    </div>
  )
}

function MiniRow({ campaign, now, onSelect }) {
  const state = campaignState(campaign, now)
  const vol = campaign.okx_volume
  // flash-earn: показуємо СИРИЙ наторгований (оцінка), фолбек — ефективний
  const volume =
    isFlashEarn(campaign) && vol?.raw_volume != null
      ? Number(vol.raw_volume)
      : vol?.total_volume != null
        ? Number(vol.total_volume)
        : null
  const left = timeLeft(campaign.end_at, now)
  const rQty = rewardQty(campaign)
  const rCur = rewardCur(campaign)
  const tPrice = tokenPriceUsd(campaign)
  const rewardUsd = isTokenReward(campaign) && rQty && tPrice ? rQty * tPrice : null
  return (
    <button className="card live-mini" type="button" onClick={onSelect}>
      <CoinLogo campaign={campaign} />
      <span className="grow">
        <span className="nm">
          {campaign.name}
          {state === 'live' && <span className="live-badge live-badge--live">● LIVE</span>}
          {state === 'soon' && <span className="live-badge live-badge--soon">СКОРО</span>}
          {state === 'ended' && <span className="live-badge live-badge--done">ЗАВЕРШЕНО</span>}
        </span>
        <span className="sb num">
          приз {rQty ? `${fmt.format(rQty)} ${rCur}` : '—'}
          {rewardUsd != null ? ` (≈ ${compactUsd(rewardUsd)})` : ''}
          {left ? ` · до кінця ${left}` : ''}
        </span>
      </span>
      <span className="vol num">
        {volume != null ? compact(volume) : '—'}
        <small>{volume != null ? `${vol?.currency || 'USDT'} обсяг` : 'без даних'}</small>
      </span>
    </button>
  )
}
