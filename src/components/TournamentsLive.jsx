import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchTournaments, fetchTournamentHistory, fetchTournamentFeeHistory, fetchOkxEndedAsTournaments, fetchOkxHistory, subscribeTournamentVolume } from '../lib/tournamentsApi'
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
  const sign = x < 0 ? '−' : '' // відʼємне: «−$385», а не «$-3.8e+2»
  const a = Math.abs(x)
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`
  if (a >= 1) return `${sign}$${a.toFixed(2)}`
  if (a === 0) return '$0'
  return `${sign}$${a.toPrecision(2)}`
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
function endDateLabel(endAt) {
  if (!endAt) return null
  const d = new Date(endAt)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
// feeOverride (з реф-ребейтом на DEX-картці) має пріоритет над t.fee_auto.
function Calc({ t, total, feeOverride, refPct }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const v = Math.max(0, Number(raw) || 0)
  const feeRaw = t.fee_per_1k != null ? t.fee_per_1k : feeOverride != null ? feeOverride : t.fee_auto != null ? t.fee_auto : null // ручний override › реф › авто
  const fee = feeRaw != null ? Number(feeRaw) : null
  const feeAuto = t.fee_per_1k == null && (feeOverride != null || t.fee_auto != null)
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
  // rank-tiered: оцінка тіру за поточним лідербордом — найглибший «вхід», який
  // покриває введений обсяг (межі глибше топ-100 невідомі → консервативно вниз).
  const tiers = rankTiered && Array.isArray(t.vol?.extra?.tiers) ? t.vol.extra.tiers : null
  const projTier = useMemo(() => {
    if (!tiers || v <= 0) return null
    let best = null
    for (const x of tiers) if (x.entry != null && v >= x.entry) { best = x; break } // tiers йдуть від топ-1 вниз
    return best
  }, [tiers, v])
  const projReward = projTier?.reward != null ? projTier.reward : null
  const projRewardUsd = projReward != null ? (STABLES.has(String(projTier.unit || '').toUpperCase()) ? projReward : price != null ? projReward * price : null) : null
  const rankProfit = projRewardUsd != null && cost != null ? projRewardUsd - cost : null

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
              {rankTiered && projTier && (
                <div className="row"><span>Орієнтовний тір</span><b className="pos">{projTier.from === projTier.to ? `#${projTier.from}` : `${projTier.from}–${projTier.to}`} → {tierRewardLabel(projReward, projTier.unit, price)}</b></div>
              )}
              <div className="row"><span>Комса ({fee != null ? `${feeAuto ? '≈$' : '$'}${fee.toFixed(2)}/1K${feeAuto ? (refPct ? ` реф ${refPct}%` : ' авто') : ''}` : 'не задано'})</span><b className="neg">{cost != null ? `−${usd(cost)}` : 'n/a'}</b></div>
              {poolShare && (
                <div className="row row--total"><span>Прибуток</span><b className={profit == null ? '' : profit >= 0 ? 'pos' : 'neg'}>{profit != null ? (profit >= 0 ? '+' : '') + usd(profit) : fee == null ? 'задай /fee' : '—'}</b></div>
              )}
              {rankTiered && projTier && rankProfit != null && (
                <div className="row row--total"><span>Прибуток (якщо втримаєш тір)</span><b className={rankProfit >= 0 ? 'pos' : 'neg'}>{(rankProfit >= 0 ? '+' : '') + usd(rankProfit)}</b></div>
              )}
              {rankTiered && (
                <div className="tl-calc-note">{projTier ? 'Оцінка за ПОТОЧНИМ лідербордом — до кінця турніру межі тірів зростуть.' : tiers ? 'Обсяг нижче відомих меж тірів (топ-100) — дивись «Тіри нагород» вище.' : 'Тіри зʼявляться після наступного оновлення поллера.'}</div>
              )}
            </div>
          ) : (
            <div className="tl-calc-hint">Впиши обсяг, щоб побачити нагороду й комсу на основі теперішніх даних.</div>
          )}
        </div>
      )}
    </div>
  )
}

// Поллер (Fly) — публічний lookup «мій гаманець» для web3-турнірів (/w3rank).
const POLLER_URL = import.meta.env.VITE_POLLER_URL || 'https://okx-volume-poller.fly.dev'
const WALLET_LS_KEY = 'tl-w3-wallet'

// Рядок нагороди тіру: у токені + ≈$ (стейбл → $ напряму). ТОЧНЕ число, не
// компакт: «$1 830» не можна показувати як «$2K» — це межі реальних виплат.
function tierRewardLabel(reward, unit, price) {
  if (reward == null) return '—'
  const u = String(unit || '').toUpperCase()
  if (STABLES.has(u)) return `$${fmt.format(reward)}`
  const usdPart = price != null ? ` (≈ $${fmt.format(reward * price)})` : ''
  return `${fmt2.format(reward)} ${unit || ''}${usdPart}`
}

// Тір-таблиця web3: ранг · нагорода/юзера · вхід (обсяг останнього рангу тіру з
// топ-100) · середній обсяг у тірі. Межі глибше топ-100 OKX не віддає → «—».
// Тут же — поле «мій гаманець»: ранг/обсяг/очікувана нагорода через поллер.
function TierTable({ t, now }) {
  const [open, setOpen] = useState(false)
  const [wallet, setWallet] = useState(() => { try { return localStorage.getItem(WALLET_LS_KEY) || '' } catch { return '' } })
  const [me, setMe] = useState(null) // {state:'loading'|'ok'|'err', ...}
  const v = t.vol || {}
  const tiers = Array.isArray(v.extra?.tiers) ? v.extra.tiers : null
  const price = rewardPrice(t)
  const walletOk = /^0x[0-9a-fA-F]{40}$/.test(wallet.trim())

  async function check() {
    const w = wallet.trim().toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(w) || !t.external_id) return
    try { localStorage.setItem(WALLET_LS_KEY, w) } catch { /* приватний режим */ }
    setMe({ state: 'loading' })
    try {
      const r = await fetch(`${POLLER_URL}/w3rank?aid=${encodeURIComponent(t.external_id)}&w=${w}`)
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) setMe({ state: 'err', msg: r.status === 429 ? 'забагато запитів — спробуй за хвилину' : 'не вдалося перевірити' })
      else setMe({ state: 'ok', ...j })
    } catch {
      setMe({ state: 'err', msg: 'не вдалося перевірити' })
    }
  }

  const myTier = me?.state === 'ok' && me.found && me.rank != null && tiers
    ? tiers.find((x) => me.rank >= x.from && me.rank <= x.to) || null
    : null

  if (!tiers && !t.external_id) return null
  return (
    <div className="tl-tiers">
      <button className="tl-calc-btn" onClick={() => setOpen((o) => !o)}>{open ? '▾ Тіри нагород' : '▸ Тіри нагород і мій ранг'}</button>
      {open && (
        <div className="tl-tiers-body">
          {t.external_id && (
            <div className="tl-wallet">
              <span className="tl-calc-field tl-wallet-field">
                <input type="text" spellCheck="false" placeholder="мій гаманець 0x…" value={wallet} onChange={(e) => { setWallet(e.target.value); setMe(null) }} onKeyDown={(e) => e.key === 'Enter' && check()} />
              </span>
              <button type="button" className="tl-wallet-btn" disabled={!walletOk || me?.state === 'loading'} onClick={check}>{me?.state === 'loading' ? '…' : 'Перевірити'}</button>
            </div>
          )}
          {me?.state === 'err' && <div className="tl-wallet-out neg">{me.msg}</div>}
          {me?.state === 'ok' && !me.found && <div className="tl-wallet-out">Гаманця нема в лідерборді цього турніру.</div>}
          {me?.state === 'ok' && me.found && (
            <div className="tl-wallet-out pos">
              Ранг <b>#{me.rank ?? '—'}</b>
              {me.volume != null && <> · обсяг <b>{fmt.format(Math.round(me.volume))} USDT</b></>}
              {me.reward != null && <> · нагорода ≈ <b>{tierRewardLabel(me.reward, me.unit, price)}</b></>}
              {myTier && <> · тір {myTier.from === myTier.to ? `#${myTier.from}` : `${myTier.from}–${myTier.to}`}</>}
            </div>
          )}
          {tiers ? (
            <>
              <div className="tl-tiers-scroll">
                <table className="tl-tiers-table">
                  <thead><tr><th>Ранг</th><th>Нагорода</th><th>Вхід (обсяг)</th><th>Середній</th></tr></thead>
                  <tbody>
                    {tiers.map((x) => (
                      <tr key={`${x.from}-${x.to}`} className={myTier && myTier.from === x.from ? 'me' : ''}>
                        <td>{x.from === x.to ? `#${x.from}` : `${x.from}–${x.to}`}</td>
                        <td>{tierRewardLabel(x.reward, x.unit, price)}</td>
                        <td>{x.entry != null ? fmt.format(Math.round(x.entry)) : '—'}</td>
                        <td>{x.avg != null ? fmt.format(Math.round(x.avg)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tl-tiers-note">вхід/середній — з топ-100 лідерборду{v.extra?.tiersAt ? ` · ${ago(v.extra.tiersAt, now)}` : ''} · глибші межі OKX не віддає</div>
            </>
          ) : (
            <div className="tl-tiers-note">Тіри зʼявляться після наступного оновлення поллера.</div>
          )}
        </div>
      )}
    </div>
  )
}

// Ребейт (refback) на DEX-турнірах: юзеру повертається ref% від OKX свап-фі (=$2/1k
// = 2 ноги × 0.1%). Пул/слипедж НЕ ребейтяться. Ефективна комса = комса − ref×$2.
const DEX_REBATE_BASE = 2.0
function TournamentCard({ t, history, now }) {
  const st = state(t, now)
  const v = t.vol || {}
  const total = v.total_volume != null ? Number(v.total_volume) : null
  const isDex = t.market === 'dex'
  const rankTiered = t.mechanic === 'rank-tiered'
  const accent = isDex ? '#8b5cf6' : '#3B82F6'
  const price = rewardPrice(t)
  // REF-ребейт лише для DEX-авто-комси (не для ручного /fee і не для CEX/stocks).
  const isDexRef = isDex && t.fee_per_1k == null && t.fee_auto != null
  const [refPct, setRefPct] = useState(() => { try { return Number(localStorage.getItem('tl-ref-' + t.id)) || 0 } catch { return 0 } })
  const changeRef = (p) => { setRefPct(p); try { localStorage.setItem('tl-ref-' + t.id, String(p)) } catch { /* приватний режим */ } }
  const refCut = isDexRef ? (refPct / 100) * DEX_REBATE_BASE : 0
  const feeLoBase = t.fee_auto_lo != null ? Number(t.fee_auto_lo) : t.fee_auto != null ? Number(t.fee_auto) : null
  const feeHiBase = t.fee_auto_hi != null ? Number(t.fee_auto_hi) : t.fee_auto != null ? Number(t.fee_auto) : null
  const effLo = feeLoBase != null ? Math.max(0, feeLoBase - refCut) : null
  const effHi = feeHiBase != null ? Math.max(0, feeHiBase - refCut) : null
  const effFee = t.fee_auto != null ? Math.max(0, Number(t.fee_auto) - refCut) : null
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
          {st === 'soon' && <span className="tl-pill tl-pill--soon">СКОРО</span>}
        </div>
      </div>

      <div className="tl-vol-label">Загальний накручений обсяг{v.extra?.volPartial ? ' (топ-100)' : ''}</div>
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

      {rankTiered && <TierTable t={t} now={now} />}

      <div className="tl-meta">
        <div className="cell"><div className="k">Приз</div><div className="vv">{t.reward_pool != null ? `${compact(t.reward_pool)} ${t.reward_currency || ''}` : '—'}</div>{poolUsd != null && <div className="uu">≈ {usd(poolUsd)}</div>}</div>
        <div className="cell"><div className="k">Учасників</div><div className="vv">{v.participants != null ? fmt.format(v.participants) : '—'}</div></div>
        {/* Без title на комірці (юзер: підказки не потрібні). Час авто-тесту — біля
            заголовка, зі СВОЄЮ підказкою. Діапазон — одразу білим, без сірого «авто·». */}
        <div className="cell">
          <div className="k">
            Комса за 1K
            {t.fee_per_1k == null && t.fee_auto_at && (
              <span className="tl-fee-at" title="Час, коли був здійснений авто-тест на перевірку комісії"> · {sparkTime(t.fee_auto_at)}</span>
            )}
          </div>
          {t.fee_per_1k != null ? (
            <div className="vv">${t.fee_per_1k}</div>
          ) : t.fee_auto == null ? (
            <div className="vv na">n/a</div>
          ) : isDexRef ? (
            <>
              <div className="vv">{`$${effLo.toFixed(2)}–$${effHi.toFixed(2)}`}</div>
              <label className="uu tl-ref">REF:
                <select value={refPct} onChange={(e) => changeRef(Number(e.target.value))}>
                  <option value={0}>—</option>
                  {[20, 25, 30, 35, 40, 45, 50].map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
              </label>
            </>
          ) : (
            <div className="vv">{`$${Number(t.fee_auto_lo ?? t.fee_auto).toFixed(2)}–$${Number(t.fee_auto_hi ?? t.fee_auto).toFixed(2)}`}</div>
          )}
        </div>
      </div>

      <Calc t={t} total={total} feeOverride={isDexRef ? effFee : null} refPct={isDexRef ? refPct : 0} />

      <div className="tl-foot">
        <span className="tl-upd">
          {ago(v.updated_at, now)}
          {t.end_at && <> · кінець {endDateLabel(t.end_at)}{left ? ` · ${left}` : ''}</>}
        </span>
        {t.page_url && <a href={t.page_url} target="_blank" rel="noreferrer">турнір ↗</a>}
      </div>
    </div>
  )
}

function EndedCard({ t, history, feeHist, onCalc }) {
  const [open, setOpen] = useState(false)
  const v = t.vol || {}
  const price = rewardPrice(t)
  const poolUsd = t.reward_pool != null && !STABLES.has(String(t.reward_currency).toUpperCase()) && price != null ? Number(t.reward_pool) * price : null
  const total = v.total_volume != null ? Number(v.total_volume) : null
  const chartPts = history && history.length > 120 ? history.slice(-120) : history
  const tiers = Array.isArray(v.extra?.tiers) ? v.extra.tiers : null
  // Середня авто-комса за ОСТАННІ 24 ГОДИНИ до кінця турніру (з tournament_fee_history).
  const avgFee24 = useMemo(() => {
    if (!feeHist?.length || !t.end_at) return null
    const end = new Date(t.end_at).getTime()
    const pts = feeHist.map((f) => [new Date(f.observed_at).getTime(), Number(f.fee_auto)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a <= end && a >= end - 86400_000)
    if (!pts.length) return null
    return { avg: pts.reduce((s, p) => s + p[1], 0) / pts.length, n: pts.length }
  }, [feeHist, t.end_at])
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
            Фінальний обсяг: <b>{total != null ? `${fmt.format(Math.round(total))} USDT${v.extra?.volPartial ? ' (топ-100)' : ''}` : '—'}</b>
            {v.participants != null ? ` · ${fmt.format(v.participants)} учасників` : ''}
          </div>
          <div className="tl-ended-final">
            Сер. комса за 24г до кінця: <b>{avgFee24 ? `≈$${avgFee24.avg.toFixed(2)}/1K` : '—'}</b>
            {avgFee24 ? <span className="tl-ended-sub"> ({avgFee24.n} замірів)</span> : <span className="tl-ended-sub"> (нема історії комси)</span>}
          </div>
          <Chart points={chartPts} accent="#64748b" />
          {tiers && (
            <div className="tl-tiers-scroll" style={{ marginTop: 8 }}>
              <table className="tl-tiers-table">
                <thead><tr><th>Ранг</th><th>Нагорода</th><th>Вхід (обсяг)</th><th>Середній</th></tr></thead>
                <tbody>
                  {tiers.map((x) => (
                    <tr key={`${x.from}-${x.to}`}>
                      <td>{x.from === x.to ? `#${x.from}` : `${x.from}–${x.to}`}</td>
                      <td>{tierRewardLabel(x.reward, x.unit, price)}</td>
                      <td>{x.entry != null ? fmt.format(Math.round(x.entry)) : '—'}</td>
                      <td>{x.avg != null ? fmt.format(Math.round(x.avg)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
  const [feeHistById, setFeeHistById] = useState({})
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
    // Історія комси — лише для завершених турнірів нової моделі (для «сер. комса 24г»).
    const endedNew = all.filter((t) => t.okxId == null && (t.status === 'ended' || (t.end_at && new Date(t.end_at).getTime() <= Date.now())))
    if (endedNew.length) {
      const fh = {}
      await Promise.all(endedNew.map(async (t) => { fh[t.id] = await fetchTournamentFeeHistory(t.id).catch(() => []) }))
      setFeeHistById((prev) => ({ ...prev, ...fh }))
    }
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
  // Глобальний поділ Актуальні / Завершені (не по біржах): всередині — сорт по біржі.
  const byVenue = (a, b) => (VENUE_ORDER[a.venue] ?? 9) - (VENUE_ORDER[b.venue] ?? 9)
  const active = useMemo(() => shown.filter((t) => state(t, now) !== 'ended').sort(byVenue), [shown, now])
  const ended = useMemo(() => shown.filter((t) => state(t, now) === 'ended').sort(byVenue), [shown, now])
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

      {active.length > 0 && (
        <div className="tl-group">
          <div className="tl-group-title">Актуальні <span className="tl-group-count">{active.length}</span></div>
          <div className="tl-grid">{active.map((t) => <TournamentCard key={t.id} t={t} history={histById[t.id] || []} now={now} />)}</div>
        </div>
      )}
      {ended.length > 0 && (
        <div className="tl-group">
          <div className="tl-ended-wrap">
            <div className="tl-ended-head">Завершені <span>{ended.length}</span></div>
            <div className="tl-ended-list">{ended.map((t) => <EndedCard key={t.id} t={t} history={histById[t.id] || []} feeHist={feeHistById[t.id] || null} onCalc={isCexFull(t) ? () => openCalc(t._raw) : null} />)}</div>
          </div>
        </div>
      )}

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
