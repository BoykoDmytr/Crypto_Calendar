// Розбір тексту нагороди — ДЕТЕРМІНОВАНО, без ШІ.
//
// Чому не ШІ: модель заповнює reward_tiers добре лише коли нагорода вже
// оформлена як «1 місце — …; 2 місце — …». Коли біржа пише суцільним абзацом
// («10 USDT Voucher за перший пост; щодня: 20×200 USDT…, 3×5 USDT + буст…»),
// модель регулярно кладе весь абзац в одне поле `reward`. Тому розбиття на
// рядки робимо тут, правилами: результат однаковий щоразу і його видно в коді.

// Стейбли: для них «≈ $» не пишемо — сума вже в доларах.
export const STABLES = new Set([
  'USDT', 'USDC', 'USD', 'USD1', 'BUSD', 'FDUSD', 'TUSD', 'DAI',
  'GUSD', 'USDG', 'USDX', 'USDE', 'USDD', 'PYUSD', 'EUR', 'UAH',
])

// Слова, які виглядають як тікер, але ним не є.
const NOT_A_TICKER = new Set([
  'VIP', 'KYC', 'NFT', 'API', 'UID', 'CFD', 'GMT', 'UTC', 'AND', 'OR', 'THE',
  'TOP', 'PNL', 'ROI', 'APR', 'APY', 'FAQ', 'ID', 'TG', 'AMA', 'AI', 'US',
  'IMPACT', 'XP', 'GP', 'P2P', 'OTC', 'PC', 'TV', 'AM', 'PM', 'IOS',
])

const SPLIT_PRIMARY = /\s*[;；]\s*|\s+[·•]\s+/
// кінець речення перед новим змістовним блоком
const SPLIT_SENTENCE = /(?<=[.)])\s+(?=[A-ZА-ЯЁЇІЄҐ\d«"„])/
// довгий шматок із переліком «…, 3×5 USDT + буст, 1×мерч…»
const SPLIT_ENUM = /,\s+(?=\d|[A-ZА-ЯЇІЄҐ])/

const TRIM = /^[\s.,:;–—-]+|[\s.,;:]+$/g

// Дужки ховаємо перед розбиттям: у «(рівні: $10/$20; на перших 500)» крапка з
// комою — частина пояснення, а не межа нагороди. Реальний баг: рядок різався
// навпіл і хвіст «на перших 500 нових стрімерів)» ставав окремою «нагородою».
// ⟦n⟧ — заглушка: цих символів у текстах бірж не буває.
const MASK_RE = /⟦(\d+)⟧/g
function maskParens(s) {
  const bag = []
  let cur = s
  for (let pass = 0; pass < 3; pass++) {
    const next = cur.replace(/\([^()]*\)/g, (m) => {
      bag.push(m)
      return `⟦${bag.length - 1}⟧`
    })
    if (next === cur) break
    cur = next
  }
  return { masked: cur, bag }
}
function unmask(s, bag) {
  let cur = s
  for (let pass = 0; pass < 3 && cur.includes('⟦'); pass++) {
    cur = cur.replace(MASK_RE, (_, i) => bag[Number(i)] ?? '')
  }
  return cur
}

/**
 * Текст нагороди → окремі рядки. Порядок джерела зберігаємо: у тірах він уже
 * змістовний (1 місце → останнє), і пересортувати означало б зіпсувати сенс.
 * @param {string} text
 * @returns {string[]}
 */
export function splitReward(text) {
  if (!text) return []
  const flat = String(text).replace(/\s+/g, ' ').trim()
  if (!flat) return []

  const { masked, bag } = maskParens(flat)
  let parts = masked.split(SPLIT_PRIMARY)
  parts = parts.flatMap((p) => p.split(SPLIT_SENTENCE))
  // кома ріже тільки те, що і так не вміщається в рядок картки
  parts = parts.flatMap((p) => (unmask(p, bag).length > 100 ? p.split(SPLIT_ENUM) : [p]))

  const out = []
  for (const raw of parts) {
    const s = unmask(raw, bag).replace(TRIM, '').trim()
    if (s.length > 1 && !out.includes(s)) out.push(s)
  }
  return out.length ? out : [flat]
}

/**
 * Кількості токенів у тексті: «1 000 ALIGN», «250 000 ALIGN», «0.5 NVDA».
 * НЕ беремо суми, перед якими стоїть $ — там цифра вже долари («$30 GT» це
 * тридцять доларів у GT, а не 30 токенів GT), і стейбли — їх перераховувати нічого.
 * @returns {{amount:number, symbol:string, label:string}[]}
 */
export function parseAmounts(text) {
  if (!text) return []
  const src = String(text)
  const re = /([\d][\d\s\u00a0\u202f.,]*?)\s*([A-Z]{2,10})\b/g
  const seen = new Set()
  const out = []
  let m
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 3), m.index)
    // «$30 GT» — це 30 доларів у GT, а не 30 токенів. Валюту пропускаємо.
    if (/[$€₴]\s*$/.test(before)) continue
    // «20×200», «4–20», «1/2» — множник або діапазон, а не кількість.
    if (/[×xX/–—-]$/.test(before)) continue
    const symbol = m[2]
    if (STABLES.has(symbol) || NOT_A_TICKER.has(symbol)) continue
    const digits = m[1].replace(/[\s\u00a0\u202f]/g, '')
    // 1,234.5 → 1234.5 ; 1,234 → 1234 ; 0.5 → 0.5
    const normalized = /,\d{3}(\D|$)/.test(digits + ' ') ? digits.replace(/,/g, '') : digits.replace(/,/g, '.')
    const amount = Number(normalized)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const key = `${amount}|${symbol}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ amount, symbol, label: `${formatAmount(amount)} ${symbol}` })
  }
  return out.slice(0, 4) // більше чотирьох рядків ціни на картці — вже шум
}

export function formatAmount(v) {
  // uk-UA ставить нерозривний пробіл між тисячами — саме те, що треба в рядку картки.
  return v.toLocaleString('uk-UA', { maximumFractionDigits: 4 })
}

export function formatUsd(v) {
  if (!Number.isFinite(v)) return null
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(4)}`
}
