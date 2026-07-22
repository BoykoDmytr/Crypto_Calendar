import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchTournaments, fetchTournamentHistory, subscribeTournamentVolume } from '../lib/tournamentsApi'
import { supaRoma } from '../lib/supabaseRoma'
import './TournamentsLive.css'

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
function compact(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const x = Number(v)
  if (x >= 1e9) return `${(x / 1e9).toFixed(2).replace('.', ',')}B`
  if (x >= 1e6) return `${(x / 1e6).toFixed(1).replace('.', ',')}M`
  if (x >= 1e3) return `${Math.round(x / 1e3)}K`
  return fmt.format(Math.round(x))
}
function usd(v) {
  if (v == null || !Number.isFinite(Number(v))) return null
  const x = Number(v)
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2)}M`
  if (x >= 1e3) return `$${Math.round(x / 1e3)}K`
  if (x >= 1) return `$${x.toFixed(2)}`
  return `$${x.toPrecision(2)}`
}

const STABLES = new Set(['USDT', 'USDC', 'USD', 'DAI'])
const VENUE_LABEL = { okx: 'OKX', binance: 'Binance', bitget: 'Bitget', gate: 'Gate' }
const MARKET_LABEL = { cex: 'CEX', dex: 'DEX · Web3' }

function state(t, now) {
  const start = t.start_at ? new Date(t.start_at).getTime() : null
  const end = t.end_at ? new Date(t.end_at).getTime() : null
  if (t.status === 'ended' || (end && end <= now)) return 'ended'
  if (start && start > now) return 'soon'
  return 'live'
}
function timeLeft(endAt, now) {
  if (!endAt) return null
  let s = Math.floor((new Date(endAt).getTime() - now) / 1000)
  if (s <= 0) return null
  const d = Math.floor(s / 86400)
  const h = Math.floor((s - d * 86400) / 3600)
  const m = Math.floor((s - d * 86400 - h * 3600) / 60)
  return d > 0 ? `${d}д ${h}г` : h > 0 ? `${h}г ${m}хв` : `${m}хв`
}
function ago(ts, now) {
  if (!ts) return 'даних ще нема'
  const s = Math.floor((now - new Date(ts).getTime()) / 1000)
  if (s < 5) return 'оновлено щойно'
  if (s < 90) return `оновлено ${s}с тому`
  if (s < 5400) return `оновлено ${Math.round(s / 60)}хв тому`
  return `оновлено ${Math.round(s / 3600)}г тому`
}
function sparkTime(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? `${hh}:${mm}` : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${hh}:${mm}`
}

// обсяг у момент t (лінійна інтерполяція) — для дельт «темпу накрутки»
function valueAt(hist, t, key = 'total_volume') {
  const pts = (hist || []).map((p) => [new Date(p.observed_at).getTime(), Number(p[key])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  if (!pts.length || t <= pts[0][0]) return null
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= t) {
    const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]
    return t1 === t0 ? v1 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0))
  }
  return pts[pts.length - 1][1]
}
const DELTA_WINDOWS = [
  { key: '10m', ms: 10 * 60_000, label: '10 хв' },
  { key: '1h', ms: 60 * 60_000, label: '1 год' },
  { key: '6h', ms: 6 * 60 * 60_000, label: '6 год' },
  { key: '1d', ms: 24 * 60 * 60_000, label: '1 день' },
]

function CoinLogo({ icon, sym }) {
  const [failed, setFailed] = useState(false)
  if (icon && !failed) return <img className="tl-logo tl-logo--img" src={icon} alt={sym} onError={() => setFailed(true)} />
  return <span className="tl-logo">{(sym || '?')[0]}</span>
}

// Графік обсягу в часі (той самий стиль, що на OKX-панелі): площа + лінія + hover-тултіп.
function Chart({ points, accent = '#3B82F6' }) {
  const [hi, setHi] = useState(null)
  if (!points || points.length < 2) return <div className="tl-chart tl-chart--empty">графік зʼявиться, коли набереться історія обсягу</div>
  const W = 640, H = 120, pad = 8
  const vals = points.map((p) => Number(p.total_volume))
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1
  const xy = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (W - 2 * pad), pad + (1 - (v - min) / span) * (H - 2 * pad)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    setHi(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (points.length - 1)))
  }
  const hp = hi != null ? points[hi] : null
  const hxy = hi != null ? xy[hi] : null
  return (
    <div className="tl-chart" onMouseMove={onMove} onMouseLeave={() => setHi(null)} onTouchMove={(e) => onMove(e.touches[0])}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="86" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`tlg-${accent.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity=".28" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L ${lx} ${H - 2} L ${pad} ${H - 2} Z`} fill={`url(#tlg-${accent.slice(1)})`} />
        <path d={d} fill="none" stroke={accent} strokeWidth="2.2" strokeLinejoin="round" />
        {hxy && <line x1={hxy[0]} y1="0" x2={hxy[0]} y2={H} stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeDasharray="3 3" />}
        <circle cx={lx} cy={ly} r="4.5" fill="#fff" stroke={accent} strokeWidth="2.5" />
        {hxy && <circle cx={hxy[0]} cy={hxy[1]} r="4" fill="#fff" stroke={accent} strokeWidth="2.5" />}
      </svg>
      {hp && (
        <>
          <div className="tl-tip tl-tip--top" style={{ left: `${(hxy[0] / W) * 100}%` }}>{fmt.format(Math.round(Number(hp.total_volume)))}</div>
          <div className="tl-tip tl-tip--bot" style={{ left: `${(hxy[0] / W) * 100}%` }}>{sparkTime(hp.observed_at)}</div>
        </>
      )}
    </div>
  )
}

function TournamentCard({ t, history, now }) {
  const st = state(t, now)
  const v = t.vol || {}
  const total = v.total_volume != null ? Number(v.total_volume) : null
  const isDex = t.market === 'dex'
  const rankTiered = t.mechanic === 'rank-tiered'
  const accent = isDex ? '#8b5cf6' : '#3B82F6'
  const price = v.token_price_usd != null ? Number(v.token_price_usd) : null
  const poolUsd = t.reward_pool != null && (STABLES.has(String(t.reward_currency).toUpperCase()) ? Number(t.reward_pool) : price ? Number(t.reward_pool) * price : null)
  const left = timeLeft(t.end_at, now)

  const anchorTs = v.updated_at ? new Date(v.updated_at).getTime() : null
  const deltas = useMemo(() => {
    if (total == null || anchorTs == null) return []
    return DELTA_WINDOWS.map((w) => {
      const past = valueAt(history, anchorTs - w.ms)
      return past == null ? null : { ...w, d: Math.max(0, total - past) }
    }).filter((w) => w && w.d > 0)
  }, [history, total, anchorTs])

  const chartPts = history && history.length > 120 ? history.slice(-120) : history

  return (
    <div className="tl-card">
      <div className="tl-card-head">
        <CoinLogo icon={t.coin_icon} sym={t.coin_symbol} />
        <div className="tl-card-title">
          <div className="tl-name">{t.coin_symbol}</div>
          <div className="tl-sub">{t.title || t.kind}</div>
        </div>
        <div className="tl-badges">
          <span className={`tl-pill tl-pill--${isDex ? 'dex' : 'cex'}`}>{MARKET_LABEL[t.market] || t.market}</span>
          {st === 'live' && <span className="tl-pill tl-pill--live">● LIVE</span>}
          {st === 'soon' && <span className="tl-pill tl-pill--soon">СКОРО</span>}
          {st === 'ended' && <span className="tl-pill tl-pill--done">ЗАВЕРШЕНО</span>}
        </div>
      </div>

      <div className="tl-vol-label">Загальний накручений обсяг</div>
      {total != null ? (
        <>
          <div className="tl-vol">{fmt.format(Math.round(total))} <small>USDT</small></div>
          {deltas.length > 0 && (
            <div className="tl-deltas">
              <span className="tl-deltas-cap">темп:</span>
              {deltas.map((w) => (
                <span key={w.key} className="tl-delta" title={`Приріст обсягу за ${w.label}`}>
                  <b>{w.label}</b> +{compact(w.d)}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="tl-vol-wait">очікуємо перший знімок обсягу · поллер збирає дані</div>
      )}

      <Chart points={chartPts} accent={accent} />

      {rankTiered && (
        <div className="tl-threshold">
          <div className="k">Мін. обсяг, щоб потрапити в топ</div>
          <div className="v">{v.min_rank_volume != null ? `${fmt.format(Math.round(Number(v.min_rank_volume)))} USDT` : '—'}</div>
        </div>
      )}

      <div className="tl-meta">
        <div className="cell">
          <div className="k">Приз</div>
          <div className="vv">{t.reward_pool != null ? `${compact(t.reward_pool)} ${t.reward_currency || ''}` : '—'}</div>
          {poolUsd != null && !STABLES.has(String(t.reward_currency).toUpperCase()) && <div className="uu">≈ {usd(poolUsd)}</div>}
        </div>
        <div className="cell">
          <div className="k">{rankTiered ? 'Учасників' : 'Учасників'}</div>
          <div className="vv">{v.participants != null ? fmt.format(v.participants) : '—'}</div>
        </div>
        <div className="cell">
          <div className="k">Комісія за 1K</div>
          <div className={`vv ${t.fee_per_1k == null ? 'na' : ''}`}>{t.fee_per_1k != null ? `$${t.fee_per_1k}` : 'n/a'}</div>
        </div>
      </div>

      <div className="tl-foot">
        <span className="tl-upd">{ago(v.updated_at, now)}{left ? ` · до кінця ${left}` : ''}</span>
        {t.page_url && <a href={t.page_url} target="_blank" rel="noreferrer">турнір ↗</a>}
      </div>
    </div>
  )
}

export default function TournamentsLive() {
  const [items, setItems] = useState([])
  const [histById, setHistById] = useState({})
  const [filter, setFilter] = useState('all') // all | cex | dex
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const itemsRef = useRef([])
  itemsRef.current = items

  async function load() {
    const rows = await fetchTournaments()
    setItems(rows)
    // історія для кожного турніру (для графіка + дельт)
    const hs = {}
    await Promise.all(rows.map(async (t) => { hs[t.id] = await fetchTournamentHistory(t.id).catch(() => []) }))
    setHistById(hs)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { await load() } catch (e) { console.error('[tournaments] load', e) } finally { if (!cancelled) setLoading(false) }
    })()
    const ch = subscribeTournamentVolume((row) => {
      setItems((prev) => prev.map((t) => (t.id === row.tournament_id ? { ...t, vol: row } : t)))
      setHistById((h) => ({ ...h, [row.tournament_id]: [...(h[row.tournament_id] || []), { total_volume: row.total_volume, min_rank_volume: row.min_rank_volume, observed_at: row.updated_at }].slice(-400) }))
    })
    const poll = setInterval(() => load().catch(() => {}), 60_000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { cancelled = true; supaRoma.removeChannel(ch); clearInterval(poll); clearInterval(tick) }
  }, [])

  const shown = useMemo(() => items.filter((t) => filter === 'all' || t.market === filter), [items, filter])
  const groups = useMemo(() => {
    const m = new Map()
    for (const t of shown) { const k = t.venue || 'other'; if (!m.has(k)) m.set(k, []); m.get(k).push(t) }
    return [...m.entries()]
  }, [shown])
  const counts = useMemo(() => ({ all: items.length, cex: items.filter((t) => t.market === 'cex').length, dex: items.filter((t) => t.market === 'dex').length }), [items])

  return (
    <div className="tl">
      <div className="tl-filters">
        {[['all', 'Усі'], ['cex', 'CEX'], ['dex', 'DEX · Web3']].map(([k, label]) => (
          <button key={k} className={`tl-fchip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {label} <span className="tl-fcount">{counts[k]}</span>
          </button>
        ))}
      </div>

      {loading && <div className="tl-state">Завантаження турнірів…</div>}
      {!loading && shown.length === 0 && <div className="tl-state">Немає турнірів у цій категорії.</div>}

      {groups.map(([venue, list]) => (
        <div key={venue} className="tl-group">
          <div className="tl-group-title">{VENUE_LABEL[venue] || venue}</div>
          <div className="tl-grid">
            {list.map((t) => <TournamentCard key={t.id} t={t} history={histById[t.id] || []} now={now} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
