import { useMemo, useState } from 'react'
import { feeTiersForGroup } from '../lib/okxApi'

// Калькулятор нагороди для OKX Flash Earn trade-to-earn (SLX / RE / DATA).
// Формула — 1:1 з OKX «Calculate my reward»:
//   your_eff = сирий обсяг × коеф. монети × коеф. дня × коеф. активних днів
//   нагорода = your_eff / загальний_eff × SHARE-пул   (БЕЗ розмивання власним обсягом —
//              OKX рахує саме так; за малого твого обсягу проти загального це точно)
//   обмежена пулом і кепом на юзера.
// Прибуток = нагорода×ціна − сира_комісія. Ключова метрика ризику — беззбитковість
// по ЗАГАЛЬНОМУ обсягу: T_be = коеф × пул × ціна / чиста_ставка (не залежить від
// твого обсягу). Поки загальний обсяг < T_be — прибутково.
const AUTO_REFBACK = 0.2
const PARTNER_MAX = 0.3
const PARTNER_STEP = 0.05
const PARTNER_DEFAULT = 0.3

const VMIN = 1_000
const VMAX = 10_000_000
const sliderToV = (s) => Math.exp(Math.log(VMIN) + (s / 1000) * (Math.log(VMAX) - Math.log(VMIN)))

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const fmt2 = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function compact(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}
function compactUsd(x) {
  if (x == null || !Number.isFinite(Number(x))) return null
  const v = Number(x)
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2).replace('.', ',')}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2).replace('.', ',')}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  if (v >= 1) return `$${v.toFixed(2).replace('.', ',')}`
  return `$${v.toPrecision(2)}`
}

// Ввід «людських» чисел: "5B" / "5000M" / "5 000 000 000" / "5,5B" → число.
function parseHumanNum(str) {
  let s = String(str ?? '').trim().toLowerCase().replace(/[\s_]/g, '')
  if (!s) return null
  let mult = 1
  const m = s.match(/([kкmмbб])$/)
  if (m) {
    const c = m[1]
    mult = 'bб'.includes(c) ? 1e9 : 'mм'.includes(c) ? 1e6 : 1e3
    s = s.slice(0, -1)
  }
  const commas = (s.match(/,/g) || []).length
  const dots = (s.match(/\./g) || []).length
  if (commas === 1 && dots === 0) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? Math.max(0, n * mult) : null
}
function toHumanInput(v) {
  if (v == null || !Number.isFinite(v)) return ''
  const trim = (x) => x.replace(/\.?0+$/, '')
  if (v >= 1e9) return `${trim((v / 1e9).toFixed(2))}B`
  if (v >= 1e6) return `${trim((v / 1e6).toFixed(1))}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}

// Фолбек-конфіг RE, якщо поллер ще не записав flash_config.
const DEFAULT_RE_CONFIG = {
  currentDay: null,
  activityDays: 11,
  startTime: '2026-07-06T10:00:00.000Z',
  endTime: '2026-07-16T10:00:00.000Z',
  timeCoefficients: [
    { day: 1, mult: 1.8 }, { day: 2, mult: 1.5 }, { day: 3, mult: 1.5 },
    { day: 4, mult: 1.3 }, { day: 5, mult: 1.3 }, { day: 6, mult: 1.3 },
    { day: 7, mult: 1.1 }, { day: 8, mult: 1.1 }, { day: 9, mult: 1.1 },
    { day: 10, mult: 1.1 }, { day: 11, mult: 1 },
  ],
  tokenCoefficients: [{ token: 'RE', mult: 1.1 }, { token: 'ETH', mult: 1 }],
  cumulativeCoefficients: [
    { minDays: 1, maxDays: 2, mult: 1 },
    { minDays: 3, maxDays: 5, mult: 1.1 },
    { minDays: 6, maxDays: 9, mult: 1.2 },
    { minDays: 10, maxDays: 11, mult: 1.3 },
  ],
  sharePool: 915000,
  perUserCap: 6500,
  minVolume: 500,
  rewardCurrency: 'RE',
}

// День турніру = доба UTC+8 (межа 16:00 UTC). Фолбек, коли поллер не дав currentDay.
function computeCurrentDay(cfg, now) {
  const start = new Date(cfg.startTime).getTime()
  if (!Number.isFinite(start) || now < start) return 1
  const B = 16 * 3600_000
  const dayIndexAt = (t) => Math.floor((t - B) / 86_400_000)
  return Math.min(cfg.activityDays || 11, dayIndexAt(now) - dayIndexAt(start) + 1)
}

function cumMultFor(cfg, days) {
  const br = (cfg.cumulativeCoefficients || []).find((b) => days >= b.minDays && days <= b.maxDays)
  if (br) return br.mult
  const last = (cfg.cumulativeCoefficients || [])[cfg.cumulativeCoefficients.length - 1]
  return days > 0 && last && days > last.maxDays ? last.mult : 1
}

// Прогноз фінального загального еф. обсягу (для довідки/швидкої підстановки).
function projectFinalT(cfg, tNow, now) {
  const start = new Date(cfg.startTime).getTime()
  const end = new Date(cfg.endTime).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || tNow == null) return null
  const B = 16 * 3600_000
  const boundary = (t) => (Math.floor((t - B) / 86_400_000) + 1) * 86_400_000 + B
  const multOf = (d) => cfg.timeCoefficients.find((x) => x.day === d)?.mult ?? 1
  const w = (t0, t1) => {
    let acc = 0
    let t = t0
    let day = computeCurrentDay(cfg, t0)
    while (t < t1 && day <= (cfg.activityDays || 11)) {
      const nb = Math.min(boundary(t), t1, end)
      acc += multOf(day) * (nb - t)
      t = nb
      day++
    }
    return acc
  }
  const elapsed = w(start, Math.min(now, end))
  const total = w(start, end)
  if (elapsed <= 0) return null
  const linear = tNow * (total / elapsed)
  return { linear, damped: Math.sqrt(tNow * linear) }
}

export default function FlashEarnCalculator({ campaign, liveTotal, feeTiers }) {
  // Fee-таблиця за групою монети OKX (усі flash-earn токени = Група 2). Дефолт = 2.
  const tiers = feeTiersForGroup(campaign?.fee_group)
  const [vipIdx, setVipIdx] = useState(0)
  const [order, setOrder] = useState('maker')
  const [partnerRb, setPartnerRb] = useState(PARTNER_DEFAULT)
  const [autoRb, setAutoRb] = useState(true)
  const [slider, setSlider] = useState(500)
  const [tOverride, setTOverride] = useState(null) // ручний загальний обсяг
  const [tFocused, setTFocused] = useState(false)
  const [tText, setTText] = useState('')

  const cfg = campaign?.flash_config || DEFAULT_RE_CONFIG
  const now = Date.now()
  const cur = cfg.rewardCurrency || campaign?.prize_currency || 'RE'
  const price =
    campaign?.okx_volume?.token_price_usd != null ? Number(campaign.okx_volume.token_price_usd) : null
  const pool = Number(cfg.sharePool ?? campaign?.share_pool ?? 0)
  const cap = cfg.perUserCap != null ? Number(cfg.perUserCap) : null
  const minVol = cfg.minVolume != null ? Number(cfg.minVolume) : null

  const day = cfg.currentDay || computeCurrentDay(cfg, now)
  const days = cfg.activityDays || 11
  const remaining = Math.max(1, days - day + 1)
  const todayMult = cfg.timeCoefficients.find((t) => t.day === day)?.mult ?? 1
  const tokenCoefs = cfg.tokenCoefficients || []
  const bestToken = [...tokenCoefs].sort((a, b) => b.mult - a.mult)[0]
  const cumMax = cumMultFor(cfg, remaining)
  // множник за оптимальної гри: трейд сьогодні × найкраща пара × активність щодня
  const effMult = todayMult * (bestToken?.mult ?? 1) * cumMax

  const tNow = liveTotal != null ? Number(liveTotal) : null
  const tProj = useMemo(() => projectFinalT(cfg, tNow, now), [cfg, tNow]) // eslint-disable-line react-hooks/exhaustive-deps
  // ДЕФОЛТ = поточний загальний обсяг (як OKX «Calculate my reward»). Прогноз — по кнопці.
  const T = Math.max(0, Number(tOverride ?? tNow ?? tProj?.damped ?? 0))
  const tInputValue = tFocused ? tText : tOverride != null ? toHumanInput(tOverride) : toHumanInput(T)

  const tier = tiers[Math.min(vipIdx, tiers.length - 1)]
  const feePct =
    order === 'maker'
      ? Number(tier.maker_pct)
      : order === 'taker'
        ? Number(tier.taker_pct)
        : (Number(tier.maker_pct) + Number(tier.taker_pct)) / 2
  const zeroFee = feePct === 0
  const autoFrac = autoRb ? AUTO_REFBACK : 0
  const rb = Math.min(0.99, partnerRb + autoFrac)
  const fNet = (feePct / 100) * (1 - rb)

  // Нагорода 1:1 з OKX: your_eff / total × пул (без розмивання), обмежена пулом і кепом.
  const rewardFor = (V, Ttot) => {
    const veff = V * effMult
    let tok = Ttot > 0 ? (pool * veff) / Ttot : 0
    if (!Number.isFinite(tok) || tok < 0) tok = 0
    tok = Math.min(tok, pool)
    if (cap) tok = Math.min(tok, cap)
    return tok
  }
  const profitAt = (V, Ttot = T) => {
    const rewardTok = rewardFor(V, Ttot)
    const rewardUsd = price != null ? rewardTok * price : null
    const cost = V * fNet
    return { rewardTok, rewardUsd, cost, profit: rewardUsd != null ? rewardUsd - cost : null }
  }

  const V = sliderToV(slider)
  const res = profitAt(V)
  const fee = (V * feePct) / 100
  const autoAmt = fee * autoFrac
  const partnerAmt = fee * partnerRb
  const rbAmt = autoAmt + partnerAmt

  // Беззбитковість по ЗАГАЛЬНОМУ обсягу: reward$/V = fNet → T_be = effMult×пул×ціна/fNet.
  // Не залежить від твого обсягу. T < T_be → прибутково.
  const breakEvenT = price != null && fNet > 0 && !zeroFee ? (effMult * pool * price) / fNet : null
  const profitableNow = breakEvenT != null && T > 0 ? T < breakEvenT : null

  // Крива: прибуток (за планового обсягу) залежно від ЗАГАЛЬНОГО обсягу (лог-вісь).
  // Перетин нуля = беззбитковість. Маркери: зараз, беззбитковість, обраний T.
  const curve = useMemo(() => {
    if (price == null || breakEvenT == null || V <= 0) return null
    const anchor = Math.max(tNow || 0, breakEvenT, T, 1e6)
    const Tlo = Math.max(1e5, anchor * 0.04)
    const Thi = anchor * 3
    const logLo = Math.log(Tlo)
    const logHi = Math.log(Thi)
    const W = 640
    const H = 170
    const padT = 12
    const padB = 22
    const N = 160
    const pAt = (tt) => profitAt(V, tt).profit
    const pts = []
    let maxP = -Infinity
    let minP = Infinity
    for (let i = 0; i <= N; i++) {
      const tt = Math.exp(logLo + (i / N) * (logHi - logLo))
      const p = pAt(tt)
      pts.push([i / N, p])
      if (p > maxP) maxP = p
      if (p < minP) minP = p
    }
    if (maxP <= 0) maxP = 1
    const lo = Math.min(minP, -maxP * 0.15)
    const X = (x) => x * W
    const Y = (p) => padT + (1 - (p - lo) / (maxP - lo)) * (H - padT - padB)
    const zero = Y(0)
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ')
    const xOf = (tt) => (Math.log(Math.max(Tlo, Math.min(Thi, tt))) - logLo) / (logHi - logLo)
    return {
      d,
      area: `${d} L ${W} ${zero.toFixed(1)} L 0 ${zero.toFixed(1)} Z`,
      zero,
      be: { x: X(xOf(breakEvenT)), y: zero },
      cur: tNow != null ? { x: X(xOf(tNow)), y: Y(pAt(tNow)) } : null,
      sel: { x: X(xOf(T)), y: Y(pAt(T)) },
    }
  }, [pool, cap, T, tNow, fNet, zeroFee, V, price, effMult, breakEvenT]) // eslint-disable-line react-hooks/exhaustive-deps

  const capBindVeff = cap && pool > 0 ? (cap * T) / pool : null
  const capBindV = capBindVeff != null && effMult > 0 ? capBindVeff / effMult : null
  const capped = !zeroFee && cap != null && res.rewardTok >= cap - 1e-9

  if (!campaign) return null

  const useProj = () => {
    if (tProj?.damped) setTOverride(tProj.damped)
    setTText('')
    setTFocused(false)
  }
  const useNow = () => {
    setTOverride(null)
    setTText('')
    setTFocused(false)
  }
  const onProj = tOverride != null && tProj?.damped && Math.abs(tOverride - tProj.damped) < 1

  return (
    <div className="okxcalc" id="okx-calc">
      <div className="okxcalc-title">🎯 Калькулятор нагороди · {cur} Flash Earn</div>

      <div className="okxcalc-inputs">
        <div>
          <label className="okxcalc-label" htmlFor="fecalc-vip">VIP-рівень</label>
          <select
            id="fecalc-vip"
            className="okxcalc-select num"
            value={vipIdx}
            onChange={(e) => setVipIdx(Number(e.target.value))}
          >
            {tiers.map((t, i) => (
              <option key={t.level} value={i}>
                {t.level} · maker {Number(t.maker_pct).toFixed(4)}% / taker {Number(t.taker_pct).toFixed(4)}%
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="okxcalc-label">Тип ордера</span>
          <div className="okxcalc-seg" role="group" aria-label="Тип ордера">
            {[['maker', 'Maker (ліміт)'], ['taker', 'Taker (маркет)'], ['mix', '50 / 50']].map(([k, lab]) => (
              <button key={k} type="button" className={order === k ? 'on' : ''} onClick={() => setOrder(k)}>
                {lab}
              </button>
            ))}
          </div>
        </div>
        <div className="okxcalc-rbfield">
          <span className="okxcalc-label">Реффбек</span>
          <div className="okxcalc-rbrow2">
            <button
              type="button"
              className={`okxcalc-rbchip ${autoRb ? 'on' : ''}`}
              onClick={() => setAutoRb((a) => !a)}
            >
              {autoRb ? '✓ ' : ''}{Math.round(AUTO_REFBACK * 100)}% авто
            </button>
            <span className="okxcalc-rbpartner">
              <span className="okxcalc-rbpartner-lab">партнер</span>
              <span className="okxcalc-rbstep">
                <button
                  type="button"
                  className="okxcalc-rbstep-btn"
                  onClick={() => setPartnerRb((r) => Math.max(0, Math.round((r - PARTNER_STEP) * 100) / 100))}
                  disabled={partnerRb <= 0.0001}
                  aria-label="Зменшити реффбек партнера"
                >
                  −
                </button>
                <span className="okxcalc-rbstep-val num">{Math.round(partnerRb * 100)}%</span>
                <button
                  type="button"
                  className="okxcalc-rbstep-btn"
                  onClick={() => setPartnerRb((r) => Math.min(PARTNER_MAX, Math.round((r + PARTNER_STEP) * 100) / 100))}
                  disabled={partnerRb >= PARTNER_MAX - 0.0001}
                  aria-label="Збільшити реффбек партнера"
                >
                  +
                </button>
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Загальний обсяг усіх учасників (знаменник нагороди). Дефолт = зараз (як OKX). */}
      <div className="fecalc-estfield">
        <span className="okxcalc-label">Загальний обсяг усіх учасників</span>
        <div className="fecalc-estrow">
          <input
            type="text"
            inputMode="decimal"
            className="okxcalc-est num"
            value={tInputValue}
            placeholder="напр. 5B"
            onFocus={() => {
              setTFocused(true)
              setTText(toHumanInput(tOverride != null ? tOverride : T))
            }}
            onBlur={() => setTFocused(false)}
            onChange={(e) => {
              const s = e.target.value
              setTText(s)
              const n = parseHumanNum(s)
              if (n != null) setTOverride(n)
            }}
            aria-label="Загальний ефективний обсяг усіх учасників"
          />
          <span className="fecalc-estunit">USDT</span>
          <button type="button" className={`okxcalc-rbchip ${tOverride == null ? 'on' : ''}`} onClick={useNow}>
            зараз
          </button>
          {tProj?.damped && (
            <button type="button" className={`okxcalc-rbchip ${onProj ? 'on' : ''}`} onClick={useProj}>
              прогноз {compact(tProj.damped)}
            </button>
          )}
        </div>
      </div>

      <div className="okxcalc-volhead">
        <span className="okxcalc-label">Планований обсяг (сирий)</span>
        <span className="okxcalc-volval num">{fmt.format(Math.round(V))} USDT</span>
      </div>
      <input
        type="range"
        className="okxcalc-range"
        min="0"
        max="1000"
        value={slider}
        onChange={(e) => setSlider(Number(e.target.value))}
        aria-label="Планований обсяг"
      />
      <div className="okxcalc-feeline num">
        Зарахований (з множником): <b>{fmt.format(Math.round(V * effMult))} USDT</b> (×{effMult.toFixed(2)})
      </div>

      {curve && (
        <div className="okxcalc-curvebox">
          <svg viewBox="0 0 640 170" width="100%" height="150" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="fecalc-ag" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#34d399" stopOpacity=".28" />
                <stop offset="1" stopColor="#34d399" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((g) => (
              <line key={g} x1="0" y1={12 + g * 136} x2="640" y2={12 + g * 136} stroke="rgba(255,255,255,.05)" />
            ))}
            <line x1="0" y1={curve.zero} x2="640" y2={curve.zero} stroke="rgba(255,255,255,.18)" strokeDasharray="4 4" />
            <path d={curve.area} fill="url(#fecalc-ag)" />
            <path d={curve.d} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinejoin="round" />
            <circle cx={curve.be.x} cy={curve.be.y} r="5" fill="#f87171" />
            {curve.cur && <circle cx={curve.cur.x} cy={curve.cur.y} r="6" fill="#fbbf24" />}
            <circle cx={curve.sel.x} cy={curve.sel.y} r="7" fill="#fff" stroke="#3B82F6" strokeWidth="3" />
          </svg>
          <div className="okxcalc-legend">
            <span><i style={{ background: '#34d399' }} />прибуток</span>
            <span><i style={{ background: '#fbbf24' }} />загальний зараз</span>
            <span><i style={{ background: '#fff', border: '2px solid #3B82F6' }} />обраний</span>
            <span><i style={{ background: '#f87171' }} />беззбитковість</span>
          </div>
        </div>
      )}

      <div className="okxcalc-result">
        <div className="okxcalc-reslabel">🎯 Чистий прибуток</div>
        {zeroFee ? (
          <>
            <div className="okxcalc-resbig num">—</div>
            <div className="okxcalc-roi muted">0% комісії — обсяг не зараховується</div>
          </>
        ) : res.profit == null ? (
          <div className="okxcalc-roi muted">чекаємо ціну {cur} з тикера — тоді порахуємо $</div>
        ) : (
          <>
            <div className={`okxcalc-resbig num ${res.profit >= 0 ? 'pos' : 'neg'}`}>
              {res.profit >= 0 ? '+' : '−'}
              {fmt.format(Math.abs(Math.round(res.profit)))} USD
            </div>
            <div className="okxcalc-roi num" style={{ color: res.profit >= 0 ? '#34d399' : '#f87171' }}>
              ROI на комісію:{' '}
              {res.cost > 0 ? `${res.profit >= 0 ? '+' : '−'}${fmt.format(Math.abs(Math.round((res.profit / res.cost) * 100)))}%` : '—'}
            </div>
          </>
        )}
        <div className="okxcalc-kvs">
          <div className="okxcalc-kv">
            <span className="k">Нагорода</span>
            <span className="v num">
              {fmt.format(Math.round(res.rewardTok))} {cur}
              {res.rewardUsd != null ? ` ≈ ${compactUsd(res.rewardUsd)}` : ''}
            </span>
          </div>
          <div className="okxcalc-kv">
            <span className="k">Чиста комісія</span>
            <span className="v num">{fmt2.format(fee - rbAmt)} USDT</span>
          </div>
          {breakEvenT != null && (
            <div className="okxcalc-kv">
              <span className="k">Беззбитковість (загальний обсяг до)</span>
              <span className="v num" style={{ color: profitableNow ? '#34d399' : '#f87171' }}>
                ≈ {compactUsd(breakEvenT)}
              </span>
            </div>
          )}
        </div>
        {minVol != null && V < minVol && (
          <div className="okxcalc-warn red">⚠️ Обсяг нижче мінімуму турніру — {fmt.format(minVol)} USDT.</div>
        )}
        {capped && capBindV != null && (
          <div className="okxcalc-warn red">
            ⛔ Кеп <b>{fmt.format(cap)} {cur}/юзера</b> — сирий обсяг понад {compact(capBindV)} нагороду не збільшує.
          </div>
        )}
        {zeroFee && (
          <div className="okxcalc-warn red">
            ⚠️ VIP6 maker = 0% комісії — zero-fee обсяг <b>не зараховується</b>. Обери taker або 50/50.
          </div>
        )}
      </div>
    </div>
  )
}
