import { useMemo, useState } from 'react'
import { FEE_TIERS_FALLBACK } from '../lib/okxApi'

// Калькулятор прибутку для OKX Spot Trade-to-Earn.
// Модель: нагорода = pool × V / (T + V) (розмивання власним обсягом),
// обрізана кепом на юзера; витрати = V × ставка × (1 − реффбек).
// Реффбек = авто (20%, OKX, вмикається кнопкою) + партнерський (0…30%, регулюється).
const AUTO_REFBACK = 0.2
const PARTNER_MAX = 0.3
const PARTNER_STEP = 0.05
const PARTNER_DEFAULT = 0.3

const VMIN = 1_000
const VMAX = 10_000_000
const sliderToV = (s) =>
  Math.exp(Math.log(VMIN) + (s / 1000) * (Math.log(VMAX) - Math.log(VMIN)))

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const fmt2 = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
function compact(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}

function profitAt(V, pool, T, cap, fNet) {
  let reward = T + V > 0 ? (pool * V) / (T + V) : 0
  // нагорода фізично не може перевищити пул і не буває від'ємною
  if (!Number.isFinite(reward) || reward < 0) reward = 0
  reward = Math.min(reward, pool)
  if (cap) reward = Math.min(reward, cap)
  return { reward, cost: V * fNet, profit: reward - V * fNet }
}

export default function OkxProfitCalculator({ campaign, liveVolume, feeTiers }) {
  const tiers = feeTiers && feeTiers.length ? feeTiers : FEE_TIERS_FALLBACK
  const [vipIdx, setVipIdx] = useState(0)
  const [order, setOrder] = useState('maker')
  const [partnerRb, setPartnerRb] = useState(PARTNER_DEFAULT) // 0…0.3, регулюється −/+
  const [autoRb, setAutoRb] = useState(true) // авто-реффбек 20% (вмик/вимк)
  const [slider, setSlider] = useState(500)
  const [estT, setEstT] = useState(10_000_000)

  const pool = Number(campaign?.share_pool ?? campaign?.prize_pool ?? 0)
  const cap = campaign?.cap_per_user ? Number(campaign.cap_per_user) : null
  const minVol = campaign?.min_volume ? Number(campaign.min_volume) : null
  const hasLive = liveVolume != null && Number(liveVolume) > 0
  // min="0" на інпуті не блокує введення мінуса з клавіатури — клампимо самі,
  // інакше від'ємний T підриває знаменник (T+V) і нагорода "вибухає"
  const T = hasLive ? Math.max(0, Number(liveVolume)) : Math.max(0, Number(estT) || 0)

  const tier = tiers[Math.min(vipIdx, tiers.length - 1)]
  const feePct =
    order === 'maker'
      ? Number(tier.maker_pct)
      : order === 'taker'
        ? Number(tier.taker_pct)
        : (Number(tier.maker_pct) + Number(tier.taker_pct)) / 2
  const zeroFee = feePct === 0
  const autoFrac = autoRb ? AUTO_REFBACK : 0
  const rb = Math.min(0.99, partnerRb + autoFrac) // сумарний реффбек
  const fNet = (feePct / 100) * (1 - rb)

  const V = sliderToV(slider)
  const res = profitAt(V, pool, T, cap, fNet)
  const fee = (V * feePct) / 100
  const autoAmt = fee * autoFrac // повернеться авто-реффбеком (20%)
  const partnerAmt = fee * partnerRb // повернеться реффбеком партнера
  const rbAmt = autoAmt + partnerAmt

  // крива прибутку для SVG
  const curve = useMemo(() => {
    const W = 640
    const H = 170
    const padT = 12
    const padB = 22
    const N = 160
    const f = zeroFee ? 1e-9 : fNet
    const pts = []
    let maxP = -Infinity
    let minP = Infinity
    for (let i = 0; i <= N; i++) {
      const v = sliderToV((i * 1000) / N)
      const p = profitAt(v, pool, T, cap, f).profit
      pts.push([i / N, p])
      if (p > maxP) maxP = p
      if (p < minP) minP = p
    }
    if (maxP <= 0) maxP = 1
    const lo = Math.min(minP, -maxP * 0.15)
    const X = (x) => x * W
    const Y = (p) => padT + (1 - (p - lo) / (maxP - lo)) * (H - padT - padB)
    const zero = Y(0)
    const d = pts
      .map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`)
      .join(' ')
    const best = pts.reduce((a, b) => (b[1] > a[1] ? b : a))
    let beX = null
    for (let j = 1; j < pts.length; j++) {
      if (pts[j - 1][1] >= 0 && pts[j][1] < 0) {
        beX = pts[j][0]
        break
      }
    }
    const curT =
      (Math.log(V) - Math.log(VMIN)) / (Math.log(VMAX) - Math.log(VMIN))
    const curP = profitAt(V, pool, T, cap, f).profit
    return {
      d,
      area: `${d} L ${W} ${zero.toFixed(1)} L 0 ${zero.toFixed(1)} Z`,
      zero,
      best: { x: X(best[0]), y: Y(best[1]) },
      be: beX != null ? { x: X(beX), y: zero } : null,
      cur: { x: X(Math.max(0, Math.min(1, curT))), y: Y(curP) },
    }
  }, [pool, T, cap, fNet, zeroFee, V])

  const capBindV = cap && pool > cap ? (cap * T) / (pool - cap) : null
  const capped = !zeroFee && cap != null && (pool * V) / (T + V) >= cap

  if (!campaign) return null

  return (
    <div className="okxcalc" id="okx-calc">
      <div className="okxcalc-title">🎯 Калькулятор прибутку · {campaign.coin_symbol}</div>

      {!hasLive && (
        <div className="okxcalc-estline">
          Live-обсягу ще немає — рахуємо від оцінки загального обсягу:
          <input
            type="number"
            className="okxcalc-est"
            min="0"
            value={estT}
            onChange={(e) => setEstT(e.target.value)}
            aria-label="Оцінка загального обсягу турніру"
          />
          USDT
        </div>
      )}

      <div className="okxcalc-inputs">
        <div>
          <label className="okxcalc-label" htmlFor="okxcalc-vip">
            VIP-рівень
          </label>
          <select
            id="okxcalc-vip"
            className="okxcalc-select num"
            value={vipIdx}
            onChange={(e) => setVipIdx(Number(e.target.value))}
          >
            {tiers.map((t, i) => (
              <option key={t.level} value={i}>
                {t.level} · maker {Number(t.maker_pct).toFixed(4)}% / taker{' '}
                {Number(t.taker_pct).toFixed(4)}%
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="okxcalc-label">Тип ордера</span>
          <div className="okxcalc-seg" role="group" aria-label="Тип ордера">
            {[
              ['maker', 'Maker (ліміт)'],
              ['taker', 'Taker (маркет)'],
              ['mix', '50 / 50'],
            ].map(([k, lab]) => (
              <button
                key={k}
                type="button"
                className={order === k ? 'on' : ''}
                onClick={() => setOrder(k)}
              >
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

      <div className="okxcalc-volhead">
        <span className="okxcalc-label">Планований обсяг</span>
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
      <div className="okxcalc-curvebox">
        <svg viewBox="0 0 640 170" width="100%" height="150" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="okxcalc-ag" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#34d399" stopOpacity=".28" />
              <stop offset="1" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1="0"
              y1={12 + g * 136}
              x2="640"
              y2={12 + g * 136}
              stroke="rgba(255,255,255,.05)"
            />
          ))}
          <line
            x1="0"
            y1={curve.zero}
            x2="640"
            y2={curve.zero}
            stroke="rgba(255,255,255,.18)"
            strokeDasharray="4 4"
          />
          <path d={curve.area} fill="url(#okxcalc-ag)" />
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

      <div className="okxcalc-result">
        <div className="okxcalc-reslabel">🎯 Чистий прибуток</div>
        {zeroFee ? (
          <>
            <div className="okxcalc-resbig num">—</div>
            <div className="okxcalc-roi muted">обсяг не зараховується</div>
          </>
        ) : (
          <>
            <div className={`okxcalc-resbig num ${res.profit >= 0 ? 'pos' : 'neg'}`}>
              {res.profit >= 0 ? '+' : '−'}
              {fmt.format(Math.abs(Math.round(res.profit)))} USDT
            </div>
            <div
              className="okxcalc-roi num"
              style={{ color: res.profit >= 0 ? '#34d399' : '#f87171' }}
            >
              ROI на комісію:{' '}
              {res.cost > 0
                ? `${res.profit >= 0 ? '+' : '−'}${fmt.format(Math.abs(Math.round((res.profit / res.cost) * 100)))}%`
                : '—'}
            </div>
          </>
        )}
        <div className="okxcalc-kvs">
          <div className="okxcalc-kv">
            <span className="k">Нагорода (з розмиванням твого обсягу)</span>
            <span className="v num">{fmt.format(Math.round(res.reward))} USDT</span>
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
          <div className="okxcalc-warn red">
            ⚠️ Обсяг нижче мінімального порогу турніру — {fmt.format(minVol)} USDT.
          </div>
        )}
        {capped && capBindV != null && (
          <div className="okxcalc-warn red">
            ⛔ Впираєшся в кеп <b>{fmt.format(cap)} USDT/юзера</b> — обсяг понад{' '}
            {compact(capBindV)} нагороду вже не збільшує, лише комісію.
          </div>
        )}
        {zeroFee && (
          <div className="okxcalc-warn red">
            ⚠️ VIP6 maker = 0% комісії. За правилами OKX обсяг із нульовою комісією{' '}
            <b>не зараховується</b> в турнір — обери taker або 50/50.
          </div>
        )}
      </div>
    </div>
  )
}
