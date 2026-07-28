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

// Розклад множника на складові. День беремо з OKX (`currentDay` у flash_config —
// поллер оновлює його раз на ~30хв), а не рахуємо самі: у OKX своя межа доби, і
// їхнє число — джерело правди. Час — лише фолбек, якщо поля нема.
//
// ⚠️ КОЕФІЦІЄНТ АКТИВНИХ ДНІВ НЕ ВХОДИТЬ ЗА ЗАМОВЧУВАННЯМ. Він нараховується за
// те, скільки днів ти реально торгував, тобто це обіцянка про майбутнє, а не
// сьогоднішній стан. Раніше він мовчки домножувався «за оптимальної гри» — через
// це картка показувала ×1,80 там, де OKX показує ×1,5, і нагорода була завищена.
// Хочеш побачити бонус — передай activeDays явно.
export function flashMultParts(cfg, now = Date.now(), activeDays = 1) {
  if (!cfg) return { day: 1, dayMult: 1, tokenMult: 1, cumMult: 1, total: 1, bestToken: null }
  const day = cfg.currentDay || computeCurrentDay(cfg, now)
  const dayMult = (cfg.timeCoefficients || []).find((t) => t.day === day)?.mult ?? 1
  const bestToken = [...(cfg.tokenCoefficients || [])].sort((a, b) => b.mult - a.mult)[0] || null
  const tokenMult = bestToken?.mult ?? 1
  const cumMult = cumMultFor(cfg, Math.max(1, activeDays))
  return { day, dayMult, tokenMult, cumMult, bestToken, total: dayMult * tokenMult * cumMult }
}

export function flashEffMult(cfg, now = Date.now(), activeDays = 1) {
  return flashMultParts(cfg, now, activeDays).total
}

// Скільки днів ще можна торгувати (для вибору коефіцієнта активності).
export function flashDaysLeft(cfg, now = Date.now()) {
  if (!cfg) return 1
  const day = cfg.currentDay || computeCurrentDay(cfg, now)
  return Math.max(1, (cfg.activityDays || 11) - day + 1)
}

// Нагорода в токенах: your_eff / total_eff × пул, обмежена пулом і кепом на юзера.
export function flashReward(cfg, rawVolume, totalEffective, now = Date.now(), activeDays = 1) {
  const pool = Number(cfg?.sharePool ?? 0)
  const T = Number(totalEffective)
  if (!(pool > 0) || !(T > 0) || !(rawVolume > 0)) return null
  const veff = rawVolume * flashEffMult(cfg, now, activeDays)
  let tok = (pool * veff) / T
  if (!Number.isFinite(tok) || tok < 0) return null
  tok = Math.min(tok, pool)
  const cap = cfg.perUserCap != null ? Number(cfg.perUserCap) : null
  if (cap) tok = Math.min(tok, cap)
  return tok
}
