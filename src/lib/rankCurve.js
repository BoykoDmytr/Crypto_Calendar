// ============================================================================
// КРИВА «ОБСЯГ → РАНГ» для rank-tiered турнірів (OKX Web3 Boost).
//
// OKX віддає рівно 100 рядків лідерборду: pageNum/pageSize/offset/rankStart він
// ігнорує, сортування за зростанням вимкнене. Тобто межі рангів глибше сотого
// місця списком дістати НЕМОЖЛИВО — лише іменним запитом по конкретному гаманцю.
// Тому криву збираємо з трьох джерел:
//
//   1. ТОЧНІ межі топ-100  — вхід у кожен тір (обсяг останнього рангу тіру);
//   2. РЕАЛЬНІ глибокі точки — (ранг, обсяг) з іменних запитів: зонди поллера
//      (гаманці, що випали з топ-100) + перевірки гаманців користувачами;
//   3. ЯКІР ХВОСТА — мінімальний обсяг для потрапляння в ранкінг відповідає
//      останньому рангу останнього тіру (напр. 40 588 USDT ↔ #2000).
//
// Точки нормуємо на поточний обсяг рангу-100: абсолютні обсяги ростуть щогодини,
// а ФОРМА розподілу (v / v100 при даному ранзі) стабільна — тож вчорашня точка
// лишається придатною. Інтерполяція — кусково-лінійна в log-log (розподіл обсягів
// у таких турнірах степеневий, у log-log він майже прямий).
// ============================================================================

const ln = Math.log

// Порядок вузлів: ранг ↑ ⇒ обсяг ↓. Порушників (шум, стара точка) відкидаємо:
// якорі з топ-100 і хвоста мають пріоритет, реальні точки вставляємо лише якщо
// вони строго вкладаються між сусідами.
function assemble(anchors, points) {
  const kept = [...anchors].sort((a, b) => a.rank - b.rank)
  for (const p of [...points].sort((a, b) => a.rank - b.rank)) {
    let i = kept.findIndex((n) => n.rank > p.rank)
    if (i === -1) i = kept.length
    const lo = kept[i - 1]
    const hi = kept[i]
    if (lo && !(lo.vol > p.vol)) continue
    if (hi && !(p.vol > hi.vol)) continue
    if (lo && lo.rank === p.rank) continue
    kept.splice(i, 0, p)
  }
  return kept
}

export function buildRankCurve({ tiers, points, v100, minRankVolume, tiersPartial }) {
  const anchors = []
  for (const x of tiers || []) {
    if (x.entry != null && x.to <= 100) anchors.push({ rank: x.to, vol: Number(x.entry), src: 'top' })
  }
  // Хвіст: «мін. обсяг, щоб потрапити в топ» = обсяг ОСТАННЬОГО нагородного місця.
  // Лише коли таблиця тірів повна — у синтезованої (обрубок до 100) останній тір
  // насправді не останній, і якір став би на хибний ранг.
  const last = !tiersPartial && tiers?.length ? tiers[tiers.length - 1] : null
  const tailRank = last && last.to > 100 ? last.to : null
  if (tailRank && Number(minRankVolume) > 0) anchors.push({ rank: tailRank, vol: Number(minRankVolume), src: 'tail' })

  // Реальні глибокі заміри, перенормовані на «зараз» через обсяг рангу-100.
  const deep = []
  const seen = new Map() // ранг → найсвіжіша точка
  for (const p of points || []) {
    const rank = Number(p.rank)
    if (!(rank > 100)) continue
    const prev = seen.get(rank)
    if (prev && new Date(prev.observed_at) >= new Date(p.observed_at)) continue
    seen.set(rank, p)
  }
  for (const p of seen.values()) {
    const k = v100 && Number(p.v100) > 0 ? v100 / Number(p.v100) : 1
    const vol = Number(p.volume) * k
    if (Number.isFinite(vol) && vol > 0) deep.push({ rank: Number(p.rank), vol, src: 'point' })
  }

  const nodes = assemble(anchors, deep)
  const deepUsed = nodes.filter((n) => n.src === 'point').length

  // Обсяг → ранг. null = поза ранкінгом (менше за поріг) або кривої не вистачає.
  function rankFor(vol) {
    const v = Number(vol)
    if (!nodes.length || !(v > 0)) return null
    if (v >= nodes[0].vol) return nodes[0].rank
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]
      const b = nodes[i]
      if (v >= b.vol) {
        const f = (ln(a.vol) - ln(v)) / (ln(a.vol) - ln(b.vol) || 1)
        return Math.max(1, Math.round(Math.exp(ln(a.rank) + f * (ln(b.rank) - ln(a.rank)))))
      }
    }
    return null // глибше за найглибший вузол — це вже поза нагородами
  }

  return {
    nodes,
    deepUsed, // скільки реальних глибоких замірів лягло в криву (для чесного підпису)
    exactAbove: nodes.find((n) => n.rank === 100)?.vol ?? null, // вище — тір визначається точно
    maxRank: nodes.length ? nodes[nodes.length - 1].rank : null,
    rankFor,
  }
}

// Тір за рангом.
export function tierForRank(tiers, rank) {
  if (!Array.isArray(tiers) || rank == null) return null
  return tiers.find((x) => rank >= x.from && rank <= x.to) || null
}

// Тір за обсягом у зоні топ-100 — ТОЧНО, без кривої: вхід у тір відомий напряму.
export function exactTierByVolume(tiers, vol) {
  if (!Array.isArray(tiers)) return null
  for (const x of tiers) {
    if (x.entry == null) break
    if (vol >= x.entry) return x
  }
  return null
}
