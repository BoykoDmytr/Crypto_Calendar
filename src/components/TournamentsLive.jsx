import { useEffect, useMemo, useState } from 'react'
import { fetchTournaments, fetchTournamentHistory, fetchTournamentFeeHistory, fetchParticipantSnapshots, fetchRankPoints, fetchOkxActiveAsTournaments, fetchOkxEndedAsTournaments, fetchOkxHistory, subscribeTournamentVolume } from '../lib/tournamentsApi'
import { supaRoma } from '../lib/supabaseRoma'
import { buildRankCurve, tierForRank, exactTierByVolume } from '../lib/rankCurve'
import { fetchFeeTiers } from '../lib/okxApi'
import OkxProfitCalculator from './OkxProfitCalculator'
import FlashEarnCalculator from './FlashEarnCalculator'
import './TournamentsLive.css'

// CEX (не stocks, не DEX) — має повний VIP-калькулятор старого типу (okx_campaigns).
const isCexFull = (t) => t.venue === 'okx' && t.market === 'cex' && t.kind !== 'spot-stocks' && t._raw

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
// Гроші В КАЛЬКУЛЯТОРІ — БЕЗ компакту: «$1 250», а не «$1K». Це суми, які людина
// звіряє зі своїм дашбордом до цента, округлення тут неприпустиме.
function money(v, dp) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const x = Number(v)
  const a = Math.abs(x)
  const d = dp != null ? dp : a >= 1000 ? 0 : 2
  const n = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d }).format(a)
  return `${x < 0 ? '−' : ''}$${n}`
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

// Проріджування історії для рендеру графіка: показуємо ВЕСЬ турнір (від старту), але
// не більше target точок (рівномірно, з першою й останньою) — щоб SVG лишався легким.
function downsample(arr, target = 200) {
  if (!arr || arr.length <= target) return arr
  const step = (arr.length - 1) / (target - 1)
  const out = []
  for (let i = 0; i < target; i++) out.push(arr[Math.round(i * step)])
  return out
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

// Комса за $1K ОБСЯГУ. Для DEX це ІНТЕРФЕЙСНА комса OKX — плаский % від обсягу
// (Group1<>Group1 = 0,1%), однаковий на обидві ноги, число детерміноване. Звірено
// з афіліат-дашбордом: обсяг $80 366,96 → комса $80,37 → повернення $24,12 = рівно
// 30% від неї. Ніяких діапазонів і буферів: те, що людина бачить у себе, — це воно.
// CEX/stocks поки лишаються на авто-замірі (fee_auto), ручний /fee — над усім.
function feeModel(t) {
  if (t.fee_per_1k != null) return { per1k: Number(t.fee_per_1k), label: `$${Number(t.fee_per_1k).toFixed(2)}/1K` }
  if (t.fee_ui_pct != null) {
    const pct = Number(t.fee_ui_pct)
    return { per1k: pct * 10, label: `${fmt2.format(pct)}%`, pct }
  }
  if (t.fee_auto != null) return { per1k: Number(t.fee_auto), label: `≈$${Number(t.fee_auto).toFixed(2)}/1K`, approx: true }
  return { per1k: null, label: 'не задано' }
}

// Нагорода тіру у доларах (стейбл → напряму, токен → через ціну).
const tierUsd = (reward, unit, price) =>
  reward == null ? null : STABLES.has(String(unit || '').toUpperCase()) ? Number(reward) : price != null ? Number(reward) * price : null

// ============================================================================
// «МІЙ ПРИБУТОК» — два входи, один результат.
//   За гаманцем — адреса → OKX віддає ТОЧНІ ранг, обсяг і нагороду.
//   За обсягом  — «а якщо накручу N?» → ранг з кривої, тір і нагорода з нього.
// Рядки в обох режимах однакові, тож і читаються однаково.
// ============================================================================
function ProfitPanel({ t, total, curve, rebatePct, onRank }) {
  const [open, setOpen] = useState(false)
  const rankTiered = t.mechanic === 'rank-tiered'
  const poolShare = t.mechanic === 'pool-share'
  const hasWallet = rankTiered && !!t.external_id
  const [mode, setMode] = useState(hasWallet ? 'wallet' : 'volume')
  const [wallet, setWallet] = useState(() => { try { return localStorage.getItem(WALLET_LS_KEY) || '' } catch { return '' } })
  const [me, setMe] = useState(null) // {state:'loading'|'ok'|'err', …}
  const [raw, setRaw] = useState('')

  const price = rewardPrice(t)
  const fee = feeModel(t)
  const tiers = Array.isArray(t.vol?.extra?.tiers) ? t.vol.extra.tiers : null
  const minRank = t.vol?.min_rank_volume != null ? Number(t.vol.min_rank_volume) : null
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

  // ── що саме рахуємо: обсяг + звідки взялися ранг/нагорода ──────────────────
  const calc = useMemo(() => {
    const typed = Math.max(0, Number(raw) || 0)
    const byWallet = mode === 'wallet'
    if (byWallet && !(me?.state === 'ok' && me.found)) return null
    const volume = byWallet ? Number(me.volume) : typed
    if (!(volume > 0)) return null

    let rank = null
    let exactRank = false
    let tier = null
    let rewardUsd = null
    let rewardLabel = null
    let unranked = false

    if (rankTiered) {
      if (byWallet) {
        rank = me.rank ?? null
        exactRank = true
        rewardUsd = tierUsd(me.reward, me.unit, price)
        rewardLabel = tierRewardLabel(me.reward, me.unit, price)
        tier = tierForRank(tiers, rank)
      } else {
        const exact = exactTierByVolume(tiers, volume) // у топ-100 межі відомі точно
        rank = curve?.rankFor(volume) ?? null
        if (exact) {
          tier = exact
        } else if (rank != null) {
          tier = tierForRank(tiers, rank)
        } else if (minRank != null && volume < minRank) {
          unranked = true
        }
        if (tier) {
          rewardUsd = tierUsd(tier.reward, tier.unit, price)
          rewardLabel = tierRewardLabel(tier.reward, tier.unit, price)
        } else if (unranked) {
          rewardUsd = 0
          rewardLabel = '$0'
        }
      }
    } else if (poolShare) {
      // Частка від пулу-обсягу × ціна нагородного токена. Для xStocks це саме
      // volume-share пул (400 XSPY), а не весь приз 700.
      const pool = t.config?.volumePool != null ? Number(t.config.volumePool) : t.reward_pool != null ? Number(t.reward_pool) : null
      if (pool != null && total != null) {
        const tokens = (volume / (total + volume)) * pool
        rewardUsd = price != null ? tokens * price : null
        rewardLabel = STABLES.has(String(t.reward_currency).toUpperCase())
          ? money(rewardUsd)
          : `${fmt2.format(tokens)} ${t.reward_currency}${rewardUsd != null ? ` (≈ ${money(rewardUsd)})` : ''}`
      }
    }

    const cost = fee.per1k != null ? (volume / 1000) * fee.per1k : null
    const rebate = cost != null && rebatePct ? (cost * rebatePct) / 100 : 0
    const net = rewardUsd != null && cost != null ? rewardUsd - cost + rebate : null
    return { volume, rank, exactRank, tier, rewardUsd, rewardLabel, unranked, cost, rebate, net, byWallet }
  }, [raw, mode, me, tiers, curve, minRank, price, total, fee.per1k, rebatePct, rankTiered, poolShare, t.config, t.reward_pool, t.reward_currency])

  // Ранг наверх — щоб у таблиці тірів підсвітився саме твій рядок.
  useEffect(() => { onRank?.(calc?.rank ?? null) }, [calc?.rank, onRank])

  const tierLabel = (x) => (x.from === x.to ? `#${x.from}` : `${x.from}–${x.to}`)

  return (
    <div className={`tl-pnl${t.market === 'dex' ? ' tl-pnl--dex' : ''}`}>
      <button className="tl-calc-btn" onClick={() => setOpen((o) => !o)}>{open ? '▾ Мій прибуток' : '▸ Мій прибуток'}</button>
      {open && (
        <div className="tl-pnl-body">
          {hasWallet && (
            <div className="tl-pnl-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'wallet'} className={mode === 'wallet' ? 'on' : ''} onClick={() => setMode('wallet')}>За гаманцем</button>
              <button type="button" role="tab" aria-selected={mode === 'volume'} className={mode === 'volume' ? 'on' : ''} onClick={() => setMode('volume')}>За обсягом</button>
            </div>
          )}

          {mode === 'wallet' ? (
            <div className="tl-wallet">
              <span className="tl-calc-field tl-wallet-field">
                <input type="text" spellCheck="false" placeholder="0x…" value={wallet} onChange={(e) => { setWallet(e.target.value); setMe(null) }} onKeyDown={(e) => e.key === 'Enter' && check()} />
              </span>
              <button type="button" className="tl-wallet-btn" disabled={!walletOk || me?.state === 'loading'} onClick={check}>{me?.state === 'loading' ? '…' : 'Перевірити'}</button>
            </div>
          ) : (
            <label className="tl-calc-in">
              <span>Обсяг, який накручу</span>
              <span className="tl-calc-field"><input type="number" inputMode="decimal" placeholder="напр. 80000" value={raw} onChange={(e) => setRaw(e.target.value)} /><b>$</b></span>
            </label>
          )}

          {mode === 'wallet' && me?.state === 'err' && <div className="tl-pnl-msg neg">{me.msg}</div>}
          {mode === 'wallet' && me?.state === 'ok' && !me.found && <div className="tl-pnl-msg">Цього гаманця нема в лідерборді турніру.</div>}

          {calc ? (
            <div className="tl-calc-out">
              {rankTiered && (
                <div className="row">
                  <span>Ранг</span>
                  <b className={calc.unranked ? 'neg' : 'pos'}>
                    {calc.unranked
                      ? `поза ранкінгом (треба ${fmt.format(Math.round(minRank))})`
                      : calc.rank == null
                        ? 'поза топ-100 — перевір гаманцем'
                        : `${calc.exactRank ? '' : '≈ '}#${fmt.format(calc.rank)}${calc.tier ? ` · тір ${tierLabel(calc.tier)}` : ''}`}
                  </b>
                </div>
              )}
              <div className="row"><span>Обсяг</span><b>{fmt.format(Math.round(calc.volume))} USDT</b></div>
              <div className="row">
                <span>Нагорода</span>
                <b className={calc.rewardUsd ? 'pos' : ''}>{calc.rewardLabel ? (calc.rewardUsd ? '+' : '') + calc.rewardLabel : '—'}</b>
              </div>
              <div className="row"><span>Комса ({fee.label})</span><b className="neg">{calc.cost != null ? money(-calc.cost) : 'n/a'}</b></div>
              {rebatePct > 0 && (
                <div className="row"><span>Рефбек ({rebatePct}%)</span><b className="pos">{calc.rebate ? `+${money(calc.rebate)}` : '—'}</b></div>
              )}
              <div className="row row--total">
                <span>Чистий прибуток</span>
                <b className={calc.net == null ? '' : calc.net >= 0 ? 'pos' : 'neg'}>
                  {calc.net == null ? (fee.per1k == null ? 'задай /fee' : '—') : (calc.net >= 0 ? '+' : '') + money(calc.net)}
                </b>
              </div>
            </div>
          ) : (
            <div className="tl-calc-hint">
              {mode === 'wallet' ? 'Встав адресу — покажу твій ранг, нагороду, комсу й що лишається чистими.' : 'Впиши обсяг — покажу, який ранг і нагорода вийдуть за теперішнім лідербордом.'}
            </div>
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
// топ-100) · середній обсяг у тірі. Межі глибше топ-100 OKX списком не віддає →
// «—» (заповнюються лише через криву в «Мій прибуток»). highlightRank підсвічує
// рядок, у який ти потрапляєш — приходить з блоку прибутку.
function TierTable({ t, highlightRank, curve }) {
  const [open, setOpen] = useState(false)
  const tiers = Array.isArray(t.vol?.extra?.tiers) ? t.vol.extra.tiers : null
  const price = rewardPrice(t)
  const myTier = tierForRank(tiers, highlightRank)
  if (!tiers) return null
  // Вхід у тір = обсяг ОСТАННЬОГО його місця. Для топ-100 він відомий точно, глибше
  // OKX списку не дає — там показуємо оцінку з кривої, помічену «≈».
  const entryCell = (x) => {
    if (x.entry != null) return fmt.format(Math.round(x.entry))
    const est = curve?.volFor(x.to)
    return est != null ? <span className="tl-est">≈ {fmt.format(Math.round(est))}</span> : '—'
  }
  return (
    <div className="tl-tiers">
      <button className="tl-calc-btn" onClick={() => setOpen((o) => !o)}>{open ? '▾ Тіри нагород' : '▸ Тіри нагород'}</button>
      {open && (
        <div className="tl-tiers-body">
          <div className="tl-tiers-scroll">
            <table className="tl-tiers-table">
              <thead><tr><th>Ранг</th><th>Нагорода</th><th>Вхід (обсяг)</th><th>Середній</th></tr></thead>
              <tbody>
                {tiers.map((x) => (
                  <tr key={`${x.from}-${x.to}`} className={myTier && myTier.from === x.from ? 'me' : ''}>
                    <td>{x.from === x.to ? `#${x.from}` : `${x.from}–${x.to}`}</td>
                    <td>{tierRewardLabel(x.reward, x.unit, price)}</td>
                    <td>{entryCell(x)}</td>
                    <td>{x.avg != null ? fmt.format(Math.round(x.avg)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Рефбек на DEX-турнірах = % ВІД КОМСИ. Два тумблери (сума = загальний рефбек 0–50%).
// Дефолт 0+30: обидва реальні заміри дали саме ~30% (24,12 / 80,37 = 30,0%;
// 33 / 105,40 = 31,3%) — це чесніша відправна точка, ніж нуль чи максимум.
const REB_A = [0, 5, 10, 15, 20]
const REB_B = [0, 5, 10, 15, 20, 25, 30]
function TournamentCard({ t, history, snap, now, rankPoints }) {
  const st = state(t, now)
  const v = t.vol || {}
  const total = v.total_volume != null ? Number(v.total_volume) : null
  // Приріст учасників з опівночі Києва (денний снепшот). Показуємо лише коли є база.
  const partDelta = snap?.participants != null && v.participants != null ? Number(v.participants) - Number(snap.participants) : null
  const isDex = t.market === 'dex'
  const rankTiered = t.mechanic === 'rank-tiered'
  const accent = isDex ? '#8b5cf6' : '#3B82F6'
  const price = rewardPrice(t)
  const fee = feeModel(t)
  const [myRank, setMyRank] = useState(null) // ранг з блоку прибутку → підсвітка тіру
  // REF-рефбек лише на DEX і лише коли комсу не перебито вручну через /fee.
  const isDexRef = isDex && t.fee_per_1k == null && fee.per1k != null
  // ⚠️ null з localStorage не можна гнати через Number() — Number(null)===0, а 0 є
  // валідним значенням списку, тож «нічого не збережено» мовчки ставало нулем і
  // дефолт 30% ніколи не спрацьовував би.
  const [refA, setRefA] = useState(() => { try { const s = localStorage.getItem('tl-refA-' + t.id); return s != null && REB_A.includes(Number(s)) ? Number(s) : 0 } catch { return 0 } })
  const [refB, setRefB] = useState(() => { try { const s = localStorage.getItem('tl-refB-' + t.id); return s != null && REB_B.includes(Number(s)) ? Number(s) : 30 } catch { return 30 } })
  const changeA = (p) => { setRefA(p); try { localStorage.setItem('tl-refA-' + t.id, String(p)) } catch { /* приватний режим */ } }
  const changeB = (p) => { setRefB(p); try { localStorage.setItem('tl-refB-' + t.id, String(p)) } catch { /* приватний режим */ } }
  const refPct = isDexRef ? refA + refB : 0 // загальний рефбек = сума двох тумблерів
  const poolUsd = t.reward_pool != null && !STABLES.has(String(t.reward_currency).toUpperCase()) && price != null ? Number(t.reward_pool) * price : null
  // Крива «обсяг → ранг»: точні межі топ-100 + реальні глибокі заміри + якір хвоста.
  const curve = useMemo(
    () =>
      rankTiered
        ? buildRankCurve({
            tiers: v.extra?.tiers || null,
            points: rankPoints || [],
            v100: v.extra?.v100 != null ? Number(v.extra.v100) : null,
            minRankVolume: v.min_rank_volume != null ? Number(v.min_rank_volume) : null,
            tiersPartial: !!v.extra?.tiersPartial,
          })
        : null,
    [rankTiered, v.extra?.tiers, v.extra?.v100, v.extra?.tiersPartial, v.min_rank_volume, rankPoints]
  )
  const left = timeLeft(t.end_at, now)
  const anchorTs = v.updated_at ? new Date(v.updated_at).getTime() : null
  const deltas = useMemo(() => {
    if (total == null || anchorTs == null) return []
    return DELTA_WINDOWS.map((w) => { const p = valueAt(history, anchorTs - w.ms); return p == null ? null : { ...w, d: Math.max(0, total - p) } }).filter((w) => w && w.d > 0)
  }, [history, total, anchorTs])
  const chartPts = downsample(history, 200) // весь турнір від старту, прорідж. для рендеру

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

      {rankTiered && <TierTable t={t} highlightRank={myRank} curve={curve} />}

      <div className="tl-meta">
        <div className="cell"><div className="k">Приз</div><div className="vv">{t.reward_pool != null ? `${compact(t.reward_pool)} ${t.reward_currency || ''}` : '—'}</div>{poolUsd != null && <div className="uu">≈ {usd(poolUsd)}</div>}</div>
        <div className="cell"><div className="k">Учасників</div><div className="vv">{v.participants != null ? fmt.format(v.participants) : '—'}{partDelta != null && partDelta !== 0 && <span className={`tl-pdelta ${partDelta > 0 ? 'up' : 'down'}`} title="Приріст учасників з 00:00 за Києвом">{partDelta > 0 ? '+' : '−'}{fmt.format(Math.abs(partDelta))}</span>}</div></div>
        {/* Комса — ОДНЕ число. Для DEX це інтерфейсна комса OKX (плаский % від
            обсягу) — вона детермінована, тож ні діапазону, ні «≈» тут не місце.
            Час авто-тесту лишається тільки там, де комса справді ЗАМІРЯНА (CEX). */}
        <div className="cell">
          <div className="k">
            Комса за 1K
            {fee.approx && t.fee_auto_at && (
              <span className="tl-fee-at" title="Час, коли був здійснений авто-тест на перевірку комісії"> · {sparkTime(t.fee_auto_at)}</span>
            )}
          </div>
          {fee.per1k == null ? (
            <div className="vv na">n/a</div>
          ) : (
            <>
              <div className="vv">{`${fee.approx ? '≈' : ''}$${fee.per1k.toFixed(2)}`}{fee.pct != null && <span className="tl-fee-pct"> · {fmt2.format(fee.pct)}%</span>}</div>
              {isDexRef && (
                <div className="uu tl-ref">рефбек
                  <select value={refA} onChange={(e) => changeA(Number(e.target.value))}>{REB_A.map((p) => <option key={p} value={p}>{p}%</option>)}</select>
                  <select value={refB} onChange={(e) => changeB(Number(e.target.value))}>{REB_B.map((p) => <option key={p} value={p}>{p}%</option>)}</select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ProfitPanel t={t} total={total} curve={curve} rebatePct={refPct} onRank={setMyRank} />

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
  const chartPts = downsample(history, 200) // весь турнір від старту, прорідж. для рендеру
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
  const [partSnap, setPartSnap] = useState({}) // tournament_id → {snap_date, participants} (денний снепшот)
  const [rankPts, setRankPts] = useState({}) // tournament_id → [{rank, volume, v100, observed_at}] (крива глибини)
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
    const [fresh, okxActive, okxEnded] = await Promise.all([fetchTournaments(), fetchOkxActiveAsTournaments().catch(() => []), fetchOkxEndedAsTournaments().catch(() => [])])
    const all = [...fresh, ...okxActive, ...okxEnded]
    setItems(all)
    const hs = {}
    await Promise.all(all.map(async (t) => {
      hs[t.id] = t.okxId != null ? await fetchOkxHistory(t.okxId).catch(() => []) : await fetchTournamentHistory(t.id).catch(() => [])
    }))
    setHistById(hs)
    fetchParticipantSnapshots().then(setPartSnap).catch(() => {})
    fetchRankPoints().then(setRankPts).catch(() => {})
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
      setHistById((h) => ({ ...h, [row.tournament_id]: [...(h[row.tournament_id] || []), { total_volume: row.total_volume, min_rank_volume: row.min_rank_volume, observed_at: row.updated_at }].slice(-3000) }))
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
          <div className="tl-grid">{active.map((t) => <TournamentCard key={t.id} t={t} history={histById[t.id] || []} snap={partSnap[t.id]} rankPoints={rankPts[t.id]} now={now} />)}</div>
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
