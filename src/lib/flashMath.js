// ============================================================================
// МАТЕМАТИКА OKX FLASH EARN «TRADE TO EARN» (AEON / RE / DATA / SLX).
// Спільна для великого FlashEarnCalculator і швидкого блоку «Мій прибуток».
//
// Тут інша механіка, ніж у звичайного пул-шеру, і саме тому загальна формула
// «твій обсяг / (загальний + твій) × пул» для цієї групи дає неправильні числа:
//   1. рахується не сирий обсяг, а ЕФЕКТИВНИЙ = сирий × коеф.дня × коеф.пари ×
//      коеф.активних днів (день 1 може важити 1.8, останній — 1.0);
//   2. загальний обсяг у OKX теж ефективний, тож ділити треба «еф. на еф.»;
//   3. розмивання власним обсягом НЕМАЄ — OKX рахує your_eff / total × пул
//      (звірено з їхнім «Calculate my reward»);
//   4. є стеля на юзера (perUserCap) і мінімальний обсяг для участі.
// ============================================================================

// День турніру = доба UTC+8 (межа 16:00 UTC). Фолбек, коли поллер не дав currentDay.
export function computeCurrentDay(cfg, now) {
  const start = new Date(cfg.startTime).getTime()
  if (!Number.isFinite(start) || now < start) return 1
  const B = 16 * 3600_000
  const dayIndexAt = (t) => Math.floor((t - B) / 86_400_000)
  return Math.min(cfg.activityDays || 11, dayIndexAt(now) - dayIndexAt(start) + 1)
}

// Коефіцієнт за кількість активних днів (чим більше днів торгуєш — тим вище).
export function cumMultFor(cfg, days) {
  const br = (cfg.cumulativeCoefficients || []).find((b) => days >= b.minDays && days <= b.maxDays)
  if (br) return br.mult
  const list = cfg.cumulativeCoefficients || []
  const last = list[list.length - 1]
  return days > 0 && last && days > last.maxDays ? last.mult : 1
}

// Множник за ОПТИМАЛЬНОЇ гри: почати сьогодні × найкраща пара × активність щодня
// до кінця. Саме його показує OKX у своєму калькуляторі за замовчуванням.
export function flashEffMult(cfg, now = Date.now()) {
  if (!cfg) return 1
  const day = cfg.currentDay || computeCurrentDay(cfg, now)
  const days = cfg.activityDays || 11
  const todayMult = (cfg.timeCoefficients || []).find((t) => t.day === day)?.mult ?? 1
  const bestToken = [...(cfg.tokenCoefficients || [])].sort((a, b) => b.mult - a.mult)[0]
  return todayMult * (bestToken?.mult ?? 1) * cumMultFor(cfg, Math.max(1, days - day + 1))
}

// Нагорода в токенах: your_eff / total_eff × пул, обмежена пулом і кепом на юзера.
export function flashReward(cfg, rawVolume, totalEffective, now = Date.now()) {
  const pool = Number(cfg?.sharePool ?? 0)
  const T = Number(totalEffective)
  if (!(pool > 0) || !(T > 0) || !(rawVolume > 0)) return null
  const veff = rawVolume * flashEffMult(cfg, now)
  let tok = (pool * veff) / T
  if (!Number.isFinite(tok) || tok < 0) return null
  tok = Math.min(tok, pool)
  const cap = cfg.perUserCap != null ? Number(cfg.perUserCap) : null
  if (cap) tok = Math.min(tok, cap)
  return tok
}
