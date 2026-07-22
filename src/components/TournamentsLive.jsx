import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchTournaments, fetchTournamentHistory, fetchOkxEndedAsTournaments, fetchOkxHistory, subscribeTournamentVolume } from '../lib/tournamentsApi'
import { supaRoma } from '../lib/supabaseRoma'
import { fetchFeeTiers } from '../lib/okxApi'
import OkxProfitCalculator from './OkxProfitCalculator'
import FlashEarnCalculator from './FlashEarnCalculator'
import './TournamentsLive.css'

// CEX (не stocks, не DEX) — має повний VIP-калькулятор старого типу (okx_campaigns).
const isCexFull = (t) => t.venue === 'okx' && t.market === 'cex' && t.kind !== 'spot-stocks' && t._raw
const isFlashKind = (t) => /\/flash-earn\//i.test(t._raw?.page_url || '')

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const fmt2 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 })
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
const VENUE_ORDER = { okx: 0, binance: 1, bitget: 2, gate: 3 }
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
  const d = Math.floor(s / 86400), h = Math.floor((s - d * 86400) / 3600), m = Math.floor((s - d * 86400 - h * 3600) / 60)
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
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0')
  return d.toDateString() === new Date().toDateString() ? `${hh}:${mm}` : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${hh}:${mm}`
}
function valueAt(hist, t) {
  const pts = (hist || []).map((p) => [new Date(p.observed_at).getTime(), Number(p.total_volume)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  if (!pts.length || t <= pts[0][0]) return null
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= t) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return t1 === t0 ? v1 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0)) }
  return pts[pts.length - 1][1]
}
const DELTA_WINDOWS = [
  { key: '10m', ms: 10 * 60_000, label: '10 хв' },
  { key: '1h', ms: 60 * 60_000, label: '1 год' },
  { key: '6h', ms: 6 * 60 * 60_000, label: '6 год' },
  { key: '1d', ms: 24 * 60 * 60_000, label: '1 день' },
]
const rewardPrice = (t) => (STABLES.has(String(t.reward_currency).toUpperCase()) ? 1 : t.vol?.token_price_usd != null ? Number(t.vol.token_price_usd) : null)

function CoinLogo({ icon, sym, sm }) {
  const [failed, setFailed] = useState(false)
  const cls = `tl-logo${sm ? ' tl-logo--sm' : ''}`
  if (icon && !failed) return <img className={`${cls} tl-logo--img`} src={icon} alt={sym} onError={() => setFailed(true)} />
  return <span className={cls}>{(sym || '?')[0]}</span>
}

function Chart({ points, accent }) {
  const [hi, setHi] = useState(null)
  if (!points || points.length < 2) return <div className="tl-chart tl-chart--empty">графік зʼявиться, коли набереться історія обсягу</div>
  const W = 640, H = 120, pad = 8
  const vals = points.map((p) => Number(p.total_volume))
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1
  const xy = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (W - 2 * pad), pad + (1 - (v - min) / span) * (H - 2 * pad)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  const onMove = (e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width) setHi(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (points.length - 1))) }
  const hp = hi != null ? points[hi] : null, hxy = hi != null ? xy[hi] : null
  return (
    <div className="tl-chart" onMouseMove={onMove} onMouseLeave={() => setHi(null)} onTouchMove={(e) => onMove(e.touches[0])}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="86" preserveAspectRatio="none">
        <defs><linearGradient id={`tlg-${accent.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={accent} stopOpacity=".28" /><stop offset="1" stopColor={accent} stopOpacity="0" /></linearGradient></defs>
        <path d={`${d} L ${lx} ${H - 2} L ${pad} ${H - 2} Z`} fill={`url(#tlg-${accent.slice(1)})`} />
        <path d={d} fill="none" stroke={accent} strokeWidth="2.2" strokeLinejoin="round" />
        {hxy && <line x1={hxy[0]} y1="0" x2={hxy[0]} y2={H} stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeDasharray="3 3" />}
        <circle cx={lx} cy={ly} r="4.5" fill="#fff" stroke={accent} strokeWidth="2.5" />
        {hxy && <circle cx={hxy[0]} cy={hxy[1]} r="4" fill="#fff" stroke={accent} strokeWidth="2.5" />}
      </svg>
      {hp && <><div className="tl-tip tl-tip--top" style={{ left: `${(hxy[0] / W) * 100}%` }}>{fmt.format(Math.round(Number(hp.total_volume)))}</div><div className="tl-tip tl-tip--bot" style={{ left: `${(hxy[0] / W) * 100}%` }}>{sparkTime(hp.observed_at)}</div></>}
    </div>
  )
}

// Калькулятор: вписуєш обсяг → нагорода / комса / прибуток на основі теперішніх даних.
function Calc({ t, total }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const v = Math.max(0, Number(raw) || 0)
  const fee = t.fee_per_1k != null ? t.fee_per_1k : t.fee_auto != null ? t.fee_auto : null // ручний override › авто-оцінка
  const feeAuto = t.fee_per_1k == null && t.fee_auto != null
  const price = rewardPrice(t)
  const poolShare = t.mechanic === 'pool-share'
  const rankTiered = t.mechanic === 'rank-tiered'
  const cost = fee != null && v > 0 ? (v / 1000) * fee : null
  // pool-share: твоя частка × ПУЛ-ОБСЯГУ × ціна нагородного токена. Для xStocks
  // pool-share рахує саме volume-share пул (Activity2 = 400 XSPY), не весь приз 700.
  const sharePool = t.config?.volumePool != null ? Number(t.config.volumePool) : t.reward_pool != null ? Number(t.reward_pool) : null
  const stableReward = STABLES.has(String(t.reward_currency).toUpperCase())
  const rewardTokens = poolShare && v > 0 && total != null && sharePool != null ? (v / (total + v)) * sharePool : null
  const reward = rewardTokens != null && price != null ? rewardTokens * price : null // у $
  const profit = reward != null && cost != null ? reward - cost : null
  const minRank = t.vol?.min_rank_volume != null ? Number(t.vol.min_rank_volume) : null
  const inTop = rankTiered && minRank != null && v > 0 ? v >= minRank : null

  return (
    <div className="tl-calc">
      <button className="tl-calc-btn" onClick={() => setOpen((o) => !o)}>{open ? '▾ Калькулятор прибутку' : '▸ Порахувати мій прибуток'}</button>
      {open && (
        <div className="tl-calc-body">
          <label className="tl-calc-in">
            <span>Твій обсяг торгів</span>
            <span className="tl-calc-field"><input type="number" inputMode="decimal" placeholder="напр. 5000" value={raw} onChange={(e) => setRaw(e.target.value)} /><b>$</b></span>
          </label>
          {v > 0 ? (
            <div className="tl-calc-out">
              {poolShare && (
                <div className="row"><span>Орієнтовна нагорода</span><b className="pos">{rewardTokens == null ? '—' : stableReward ? usd(reward) : `${fmt2.format(rewardTokens)} ${t.reward_currency}${reward != null ? ` (≈ ${usd(reward)})` : ''}`}</b></div>
              )}
              {rankTiered && (
                <div className="row"><span>Поріг топ-N</span><b className={inTop ? 'pos' : 'neg'}>{inTop == null ? '—' : inTop ? '✓ у топі' : `× треба ще ${usd(minRank - v)}`}</b></div>
              )}
              <div className="row"><span>Комса ({fee != null ? `${feeAuto ? '≈$' : '$'}${fee}/1K${feeAuto ? ' авто' : ''}` : 'не задано'})</span><b className="neg">{cost != null ? `−${usd(cost)}` : 'n/a'}</b></div>
              {poolShare && (
                <div className="row row--total"><span>Прибуток</span><b className={profit == null ? '' : profit >= 0 ? 'pos' : 'neg'}>{profit != null ? (profit >= 0 ? '+' : '') + usd(profit) : fee == null ? 'задай /fee' : '—'}</b></div>
              )}
              {rankTiered && <div className="tl-calc-note">Точна нагорода залежить від фінального рангу — детальний розрахунок тірів додамо далі.</div>}
            </div>
          ) : (
            <div className="tl-calc-hint">Впиши обсяг, щоб побачити нагороду й комсу на основі теперішніх даних.</div>
          )}
        </div>
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
  const price = rewardPrice(t)
  const poolUsd = t.reward_pool != null && !STABLES.has(String(t.reward_currency).toUpperCase()) && price != null ? Number(t.reward_pool) * price : null
  const left = timeLeft(t.end_at, now)
  const anchorTs = v.updated_at ? new Date(v.updated_at).getTime() : null
  const deltas = useMemo(() => {
    if (total == null || anchorTs == null) return []
    return DELTA_WINDOWS.map((w) => { const p = valueAt(history, anchorTs - w.ms); return p == null ? null : { ...w, d: Math.max(0, total - p) } }).filter((w) => w && w.d > 0)
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
        </div>
      </div>

      <div className="tl-vol-label">Загальний накручений обсяг</div>
      {total != null ? (
        <>
          <div className="tl-vol">{fmt.format(Math.round(total))} <small>USDT</small></div>
          {deltas.length > 0 && (
            <div className="tl-deltas"><span className="tl-deltas-cap">темп:</span>{deltas.map((w) => <span key={w.key} className="tl-delta"><b>{w.label}</b> +{compact(w.d)}</span>)}</div>
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
        <div className="cell"><div className="k">Приз</div><div className="vv">{t.reward_pool != null ? `${compact(t.reward_pool)} ${t.reward_currency || ''}` : '—'}</div>{poolUsd != null && <div className="uu">≈ {usd(poolUsd)}</div>}</div>
        <div className="cell"><div className="k">Учасників</div><div className="vv">{v.participants != null ? fmt.format(v.participants) : '—'}</div></div>
        <div className="cell" title={t.fee_per_1k == null && t.fee_auto_note ? t.fee_auto_note : ''}>
          <div className="k">Комса за 1K</div>
          <div className={`vv ${t.fee_per_1k == null && t.fee_auto == null ? 'na' : ''}`}>
            {t.fee_per_1k != null ? `$${t.fee_per_1k}` : t.fee_auto != null ? `≈$${t.fee_auto}` : 'n/a'}
          </div>
          {t.fee_per_1k == null && t.fee_auto != null && <div className="uu">авто · ${t.fee_auto_lo}–${t.fee_auto_hi}</div>}
        </div>
      </div>

      <Calc t={t} total={total} />

      <div className="tl-foot">
        <span className="tl-upd">{ago(v.updated_at, now)}{left ? ` · до кінця ${left}` : ''}</span>
        {t.page_url && <a href={t.page_url} target="_blank" rel="noreferrer">турнір ↗</a>}
      </div>
    </div>
  )
}

function EndedCard({ t, history, onCalc }) {
  const [open, setOpen] = useState(false)
  const v = t.vol || {}
  const price = rewardPrice(t)
  const poolUsd = t.reward_pool != null && !STABLES.has(String(t.reward_currency).toUpperCase()) && price != null ? Number(t.reward_pool) * price : null
  const total = v.total_volume != null ? Number(v.total_volume) : null
  const chartPts = history && history.length > 120 ? history.slice(-120) : history
  return (
    <div className={`tl-ended ${open ? 'tl-ended--open' : ''}`}>
      <button className="tl-ended-row" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <CoinLogo icon={t.coin_icon} sym={t.coin_symbol} sm />
        <div className="tl-ended-mid">
          <div className="tl-ended-name">{t.coin_symbol} <span className="tl-ended-sub">{t.title}</span></div>
          <div className="tl-ended-meta">
            приз {t.reward_pool != null ? `${compact(t.reward_pool)} ${t.reward_currency}` : '—'}{poolUsd != null ? ` (${usd(poolUsd)})` : ''}
            {v.participants != null ? ` · ${fmt.format(v.participants)} уч.` : ''}
          </div>
        </div>
        <div className="tl-ended-vol">{total != null ? compact(total) : '—'}<small>обсяг</small></div>
        <span className="tl-ended-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tl-ended-detail">
          <div className="tl-ended-final">
            Фінальний обсяг: <b>{total != null ? `${fmt.format(Math.round(total))} USDT` : '—'}</b>
            {v.participants != null ? ` · ${fmt.format(v.participants)} учасників` : ''}
          </div>
          <Chart points={chartPts} accent="#64748b" />
          <div className="tl-ended-actions">
            {t.page_url && <a className="tl-ended-link" href={t.page_url} target="_blank" rel="noreferrer">сторінка турніру ↗</a>}
            {onCalc && <button type="button" className="tl-ended-link tl-ended-calc" onClick={onCalc}>калькулятор з VIP ↓</button>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TournamentsLive() {
  const [items, setItems] = useState([])
  const [histById, setHistById] = useState({})
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [feeTiers, setFeeTiers] = useState([])
  const [calcFor, setCalcFor] = useState(null) // сирий okx_campaigns → повний VIP-калькулятор

  const openCalc = (raw) => {
    setCalcFor(raw)
    setTimeout(() => document.getElementById('tl-fullcalc')?.scrollIntoView({ behavior: 'smooth' }), 60)
  }

  async function load() {
    const [fresh, okxEnded] = await Promise.all([fetchTournaments(), fetchOkxEndedAsTournaments().catch(() => [])])
    const all = [...fresh, ...okxEnded]
    setItems(all)
    const hs = {}
    await Promise.all(all.map(async (t) => {
      hs[t.id] = t.okxId != null ? await fetchOkxHistory(t.okxId).catch(() => []) : await fetchTournamentHistory(t.id).catch(() => [])
    }))
    setHistById(hs)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => { try { await load(); const ft = await fetchFeeTiers().catch(() => []); if (!cancelled) setFeeTiers(ft) } catch (e) { console.error('[tournaments]', e) } finally { if (!cancelled) setLoading(false) } })()
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
    return [...m.entries()].sort((a, b) => (VENUE_ORDER[a[0]] ?? 9) - (VENUE_ORDER[b[0]] ?? 9))
  }, [shown])
  const counts = useMemo(() => ({ all: items.length, cex: items.filter((t) => t.market === 'cex').length, dex: items.filter((t) => t.market === 'dex').length }), [items])

  return (
    <div className="tl">
      <div className="tl-filters">
        {[['all', 'Усі'], ['cex', 'CEX'], ['dex', 'DEX · Web3']].map(([k, label]) => (
          <button key={k} className={`tl-fchip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label} <span className="tl-fcount">{counts[k]}</span></button>
        ))}
      </div>

      {loading && <div className="tl-state">Завантаження турнірів…</div>}
      {!loading && shown.length === 0 && <div className="tl-state">Немає турнірів у цій категорії.</div>}

      {groups.map(([venue, list]) => {
        const active = list.filter((t) => state(t, now) !== 'ended')
        const ended = list.filter((t) => state(t, now) === 'ended')
        return (
          <div key={venue} className="tl-group">
            <div className="tl-group-title">{VENUE_LABEL[venue] || venue} <span className="tl-group-count">{list.length}</span></div>
            {active.length > 0 && <div className="tl-grid">{active.map((t) => <TournamentCard key={t.id} t={t} history={histById[t.id] || []} now={now} />)}</div>}
            {ended.length > 0 && (
              <div className="tl-ended-wrap">
                <div className="tl-ended-head">Завершені <span>{ended.length}</span></div>
                <div className="tl-ended-list">{ended.map((t) => <EndedCard key={t.id} t={t} history={histById[t.id] || []} onCalc={isCexFull(t) ? () => openCalc(t._raw) : null} />)}</div>
              </div>
            )}
          </div>
        )
      })}

      {calcFor && (
        <div id="tl-fullcalc" className="tl-fullcalc">
          <div className="tl-fullcalc-head">
            <span>Калькулятор прибутку · {calcFor.coin_symbol}</span>
            <button type="button" className="tl-fullcalc-x" onClick={() => setCalcFor(null)} aria-label="Закрити">✕</button>
          </div>
          {/\/flash-earn\//i.test(calcFor.page_url || '') ? (
            <FlashEarnCalculator campaign={calcFor} liveTotal={calcFor.okx_volume?.total_volume ?? null} feeTiers={feeTiers} />
          ) : (
            <OkxProfitCalculator campaign={calcFor} liveVolume={calcFor.okx_volume?.total_volume ?? null} feeTiers={feeTiers} />
          )}
        </div>
      )}
    </div>
  )
}
