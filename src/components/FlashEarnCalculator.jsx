import { useMemo, useState } from 'react'
import { FEE_TIERS_FALLBACK } from '../lib/okxApi'

// Калькулятор оптимальної стратегії для OKX Flash Earn trade-to-earn (DATA/RE тощо).
// Механіка (з /public/detail/<id>, живе в okx_campaigns.flash_config):
//   ефективний обсяг = Σ(денний обсяг × часовий коеф. × коеф. пари) × кумулятивний коеф.
//   нагорода = (твій еф. обсяг / загальний еф. обсяг) × SHARE-пул, з кепом на юзера.
// Реффбек — як у спотовому калькуляторі: авто (20%, OKX) + партнерський (0…30%).
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
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2).replace('.', ',')}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  if (v >= 1) return `$${v.toFixed(2).replace('.', ',')}`
  return `$${v.toPrecision(2)}`
}

// Ввід «людських» чисел: "3.3B" / "3300M" / "3 300 000 000" / "3,3B" → 3_300_000_000.
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
  if (commas === 1 && dots === 0) s = s.replace(',', '.') // кома як десятковий роздільник
  else s = s.replace(/,/g, '') // коми як тисячні
  if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '') // крапки як тисячні
  const n = Number(s)
  return Number.isFinite(n) ? Math.max(0, n * mult) : null
}
// Компактний рядок для поля вводу (редагований): 3.3B, 12M, 500K.
function toHumanInput(v) {
  if (v == null || !Number.isFinite(v)) return ''
  const trim = (x) => x.replace(/\.?0+$/, '')
  if (v >= 1e9) return `${trim((v / 1e9).toFixed(2))}B`
  if (v >= 1e6) return `${trim((v / 1e6).toFixed(1))}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}

// Фолбек-конфіг RE (activityId 10000002), якщо поллер ще не записав flash_config.
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

// День турніру = доба UTC+8 (межа 16:00 UTC). Фолбек, коли flash_config.currentDay
// ще не записаний поллером.
function computeCurrentDay(cfg, now) {
  const start = new Date(cfg.startTime).getTime()
  if (!Number.isFinite(start) || now < start) return 1
  const B = 16 * 3600_000 // 16:00 UTC у мс доби
  const dayIndexAt = (t) => Math.floor((t - B) / 86_400_000)
  return Math.min(cfg.activityDays || 11, dayIndexAt(now) - dayIndexAt(start) + 1)
}

// Кумулятивний коеф. за кількість активних днів
function cumMultFor(cfg, days) {
  const br = (cfg.cumulativeCoefficients || []).find((b) => days >= b.minDays && days <= b.maxDays)
  if (br) return br.mult
  const last = (cfg.cumulativeCoefficients || [])[cfg.cumulativeCoefficients.length - 1]
  return days > 0 && last && days > last.maxDays ? last.mult : 1
}

// Прогноз фінального загального еф. обсягу. Інтегруємо часовий коеф. по періоду
// (день 1 короткий; межі днів 16:00 UTC): linear — «сталий темп сирого до кінця»;
// damped — середнє геометричне tNow і linear (модель затухання). ДЕФОЛТ = damped.
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
  const tiers = feeTiers && feeTiers.length ? feeTiers : FEE_TIERS_FALLBACK
  const [vipIdx, setVipIdx] = useState(0)
  const [order, setOrder] = useState('maker')
  const [partnerRb, setPartnerRb] = useState(PARTNER_DEFAULT) // 0…0.3, регулюється −/+
  const [autoRb, setAutoRb] = useState(true) // авто-реффбек 20% (вмик/вимк)
  const [slider, setSlider] = useState(500)
  const [tOverride, setTOverride] = useState(null) // ручна оцінка фінального T
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
  const singlePair = tokenCoefs.length <= 1 // напр. DATA/USDT — вибору пари немає
  const cumMax = cumMultFor(cfg, remaining)
  // повний множник за оптимальної гри: обсяг сьогодні × найкраща пара × щоденна активність
  const effMult = todayMult * (bestToken?.mult ?? 1) * cumMax

  const tNow = liveTotal != null ? Number(liveTotal) : null
  const tProj = useMemo(() => projectFinalT(cfg, tNow, now), [cfg, tNow]) // eslint-disable-line react-hooks/exhaustive-deps
  const T = Math.max(0, Number(tOverride ?? tProj?.damped ?? tNow ?? 0))
  const tInputValue = tFocused ? tText : tOverride != null ? toHumanInput(tOverride) : toHumanInput(T)

  const tier = tiers[Math.min(vipIdx, tiers.length - 1)]
  const feePct =
    order === 'maker'
      ? Number(tier.maker_pct)
      : order === 'taker'
        ? Number(tier.taker_pct)
        : (Number(tier.maker_pct) + Number(tier.taker_pct)) / 2
  const zeroFee = feePct === 0 // zero-fee обсяг НЕ зараховується (правило кампанії)
  const autoFrac = autoRb ? AUTO_REFBACK : 0
  const rb = Math.min(0.99, partnerRb + autoFrac) // сумарний реффбек
  const fNet = (feePct / 100) * (1 - rb)

  // прибуток за сирий обсяг V (США): нагорода в $ мінус чиста комісія
  const profitAt = (V) => {
    const veff = V * effMult
    let rewardTok = T + veff > 0 ? (pool * veff) / (T + veff) : 0
    if (!Number.isFinite(rewardTok) || rewardTok < 0) rewardTok = 0
    rewardTok = Math.min(rewardTok, pool)
    if (cap) rewardTok = Math.min(rewardTok, cap)
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

  // крива прибутку
  const curve = useMemo(() => {
    if (price == null) return null
    const W = 640
    const H = 170
    const padT = 12
    const padB = 22
    const N = 160
    const f = zeroFee ? 1e-9 : fNet
    const pAt = (v) => {
      const veff = v * effMult
      let r = T + veff > 0 ? (pool * veff) / (T + veff) : 0
      r = Math.min(Math.max(r, 0), pool)
      if (cap) r = Math.min(r, cap)
      return r * price - v * f
    }
    const pts = []
    let maxP = -Infinity
    let minP = Infinity
    for (let i = 0; i <= N; i++) {
      const v = sliderToV((i * 1000) / N)
      const p = pAt(v)
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
    const best = pts.reduce((a, b) => (b[1] > a[1] ? b : a))
    let beX = null
    for (let j = 1; j < pts.length; j++) {
      if (pts[j - 1][1] >= 0 && pts[j][1] < 0) {
        beX = pts[j][0]
        break
      }
    }
    const curT = (Math.log(V) - Math.log(VMIN)) / (Math.log(VMAX) - Math.log(VMIN))
    return {
      d,
      area: `${d} L ${W} ${zero.toFixed(1)} L 0 ${zero.toFixed(1)} Z`,
      zero,
      best: { x: X(best[0]), y: Y(best[1]) },
      be: beX != null ? { x: X(beX), y: zero } : null,
      cur: { x: X(Math.max(0, Math.min(1, curT))), y: Y(pAt(V)) },
    }
  }, [pool, T, cap, fNet, zeroFee, V, price, effMult])

  const capBindVeff = cap && pool > cap ? (cap * T) / (pool - cap) : null
  const capBindV = capBindVeff != null ? capBindVeff / effMult : null
  const capped = !zeroFee && cap != null && res.rewardTok >= cap - 1e-9

  if (!campaign) return null

  const remainingChips = cfg.timeCoefficients.filter((t) => t.day >= day)
  const setTAuto = () => {
    setTOverride(null)
    setTText('')
    setTFocused(false)
  }

  return (
    <div className="okxcalc" id="okx-calc">
      <div className="okxcalc-title">🎯 Калькулятор стратегії · {cur} Flash Earn</div>

      {/* Оптимальна стратегія — головні правила гри */}
      <div className="fecalc-strategy">
        <div className="fecalc-strategy-title">Оптимальна гра (множник сьогодні ×{effMult.toFixed(2)})</div>
        <ol>
          {!singlePair && (
            <li>
              Торгуй пару <b>{bestToken?.token}/USDT</b> — коеф. ×{bestToken?.mult}
              {` (${tokenCoefs.filter((t) => t !== bestToken).map((t) => `${t.token} ×${t.mult}`).join(', ')})`}
            </li>
          )}
          <li>
            Сьогодні <b>день {day}/{days}</b> — часовий коеф. <b>×{todayMult}</b>:{' '}
            <b>основний обсяг якомога раніше</b>
          </li>
          <li>
            Трейд <b>щодня до кінця</b> ({remaining} дн) → кумулятивний коеф. <b>×{cumMax}</b>{' '}
            <span className="muted">(вистачить дрібного)</span>
          </li>
          <li>
            <b>Не</b> 0% комісії (VIP6 maker) — такий обсяг <b>не зараховується</b>
          </li>
        </ol>
        <div className="fecalc-days num">
          {remainingChips.map((t) => (
            <span key={t.day} className={`fecalc-day ${t.day === day ? 'on' : ''}`} title={`День ${t.day}: коеф. ×${t.mult}`}>
              д{t.day} <b>×{t.mult}</b>
            </span>
          ))}
        </div>
      </div>

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

      {/* Оцінка фінального обсягу — редагований ввід з B/M/K */}
      <div className="fecalc-estfield">
        <span className="okxcalc-label">Оцінка фінального обсягу (всіх учасників)</span>
        <div className="fecalc-estrow">
          <input
            type="text"
            inputMode="decimal"
            className="okxcalc-est num"
            value={tInputValue}
            placeholder="напр. 3.3B"
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
            aria-label="Оцінка фінального загального ефективного обсягу"
          />
          <span className="fecalc-estunit">USDT</span>
          {tOverride != null && (
            <button type="button" className="okxcalc-rbchip" onClick={setTAuto}>
              авто{tProj ? ` (${compact(tProj.damped)})` : ''}
            </button>
          )}
        </div>
        <div className="muted fecalc-esthint num">
          = {fmt.format(Math.round(T))} USDT · зараз {tNow != null ? compact(tNow) : '—'}
          {tProj != null ? ` · за сталого темпу до ${compact(tProj.linear)}` : ''}
        </div>
      </div>

      <div className="okxcalc-volhead">
        <span className="okxcalc-label">Планований обсяг (сирий, сьогодні)</span>
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
        Ефективний зарахований обсяг: <b>{fmt.format(Math.round(V * effMult))} USDT</b> (×{effMult.toFixed(2)})
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
            {curve.be && <circle cx={curve.be.x} cy={curve.be.y} r="5" fill="#f87171" />}
            <circle cx={curve.best.x} cy={curve.best.y} r="5" fill="#fbbf24" />
            <circle cx={curve.cur.x} cy={curve.cur.y} r="7" fill="#fff" stroke="#3B82F6" strokeWidth="3" />
          </svg>
          <div className="okxcalc-legend">
            <span><i style={{ background: '#34d399' }} />прибуток</span>
            <span><i style={{ background: '#fff', border: '2px solid #3B82F6' }} />ти зараз</span>
            <span><i style={{ background: '#fbbf24' }} />оптимум</span>
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
          <div className="okxcalc-roi muted">немає ціни {cur} — прибуток у $ порахуємо, щойно поллер підтягне тикер</div>
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
            <span className="k">Нагорода (з розмиванням твого обсягу)</span>
            <span className="v num">
              {fmt.format(Math.round(res.rewardTok))} {cur}
              {res.rewardUsd != null ? ` ≈ ${compactUsd(res.rewardUsd)}` : ''}
            </span>
          </div>
          <div className="okxcalc-kv">
            <span className="k">Комісія</span>
            <span className="v num">{fmt2.format(fee)} USDT</span>
          </div>
          {autoRb && (
            <div className="okxcalc-kv">
              <span className="k">Авто-реффбек ({Math.round(AUTO_REFBACK * 100)}%)</span>
              <span className="v num" style={{ color: '#6ee7b7' }}>−{fmt2.format(autoAmt)} USDT</span>
            </div>
          )}
          {partnerRb > 0 && (
            <div className="okxcalc-kv">
              <span className="k">Реффбек партнера ({Math.round(partnerRb * 100)}%)</span>
              <span className="v num" style={{ color: '#6ee7b7' }}>−{fmt2.format(partnerAmt)} USDT</span>
            </div>
          )}
          <div className="okxcalc-kv">
            <span className="k">Чиста комісія</span>
            <span className="v num">{fmt2.format(fee - rbAmt)} USDT</span>
          </div>
        </div>
        {minVol != null && V < minVol && (
          <div className="okxcalc-warn red">⚠️ Обсяг нижче мінімуму турніру — {fmt.format(minVol)} USDT.</div>
        )}
        {capped && capBindV != null && (
          <div className="okxcalc-warn red">
            ⛔ Впираєшся в кеп <b>{fmt.format(cap)} {cur}/юзера</b> — сирий обсяг понад {compact(capBindV)} нагороду
            вже не збільшує, лише комісію.
          </div>
        )}
        {zeroFee && (
          <div className="okxcalc-warn red">
            ⚠️ VIP6 maker = 0% комісії. Zero-fee обсяг <b>не зараховується</b> у Flash Earn — обери taker або 50/50.
          </div>
        )}
      </div>

      <div className="okxcalc-warn">
        ⚠️ Оцінка. Нагорода залежить від фінального еф. обсягу всіх учасників (прогноз можна підправити вище) і ціни{' '}
        {cur} на момент продажу; wash-trading заборонений правилами OKX. Ризики — на користувачі.
      </div>
    </div>
  )
}
