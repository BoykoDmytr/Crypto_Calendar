import React from 'react';

/**
 * ProfitCalculator (спрощений)
 *
 * Відображає прибуток для вибраного діапазону. Залежно від
 * результату PnL та PnL% текст фарбується зеленим/червоним.
 *
 * Props:
 *   closeSeries (number[])      – 61 цін закриття
 *   startOffset (number|null)   – зміщення від T0 для входу, −30…+30
 *   endOffset (number|null)     – зміщення від T0 для виходу, −30…+30
 */
export default function ProfitCalculator({
  closeSeries = [],
  startOffset = null,
  endOffset = null,
  investment = 100,
  onInvestmentChange,
}) {
  const suggestedInvestments = [100, 500, 1000, 1500, 2000];

  const toIndex = (offset) => (offset != null ? offset + 30 : null);
  const entryIndex = startOffset != null ? toIndex(startOffset) : null;
  const exitIndex = endOffset != null ? toIndex(endOffset) : null;

  const entryPrice = entryIndex != null ? closeSeries?.[entryIndex] : null;
  const exitPrice = exitIndex != null ? closeSeries?.[exitIndex] : null;

  let pnl = null;
  let pnlPct = null;

  const normalizedInvestment = Number(investment);

  if (entryPrice != null && exitPrice != null && Number.isFinite(normalizedInvestment)) {
    const qty = normalizedInvestment / entryPrice;
    // short: прибуток росте, коли ціна падає
    pnl = qty * (entryPrice - exitPrice);
    pnlPct = normalizedInvestment ? (pnl / normalizedInvestment) * 100 : null;
  }

  // Вибираємо колір залежно від результату
  const pnlColor =
    pnl == null
      ? 'text-gray-500'
      : pnl > 0
      ? 'text-emerald-500'
      : pnl < 0
      ? 'text-red-500'
      : 'text-amber-500';
  const pnlPctColor =
    pnlPct == null
      ? 'text-gray-500'
      : pnlPct > 0
      ? 'text-emerald-500'
      : pnlPct < 0
      ? 'text-red-500'
      : 'text-amber-500';

  return (
    <div className="mt-4 rounded-2xl border border-indigo-200/50 bg-gradient-to-br from-[#161d3d] via-[#101735] to-[#0b1127] p-4 text-white shadow-[0_10px_30px_rgba(10,16,38,0.35)] dark:border-white/10">
      <h4 className="mb-3 text-sm font-semibold tracking-wide text-white/90">Profit</h4>

      <div className="grid grid-cols-1 gap-2 text-sm">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wide text-white/65">Investment (USDT)</span>
          <div className="rounded-xl border border-white/15 bg-black/15 p-2 backdrop-blur-sm">
            <input
              type="number"
              min="1"
              value={investment}
              onChange={(e) => onInvestmentChange?.(Number(e.target.value))}
              className="mb-2 w-full rounded-lg border border-white/10 bg-[#121a38] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-indigo-300/70 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              {suggestedInvestments.map((amount) => {
                const isActive = Number(investment) === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => onInvestmentChange?.(amount)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      isActive
                        ? 'border-indigo-300/80 bg-indigo-400/25 text-indigo-100'
                        : 'border-white/15 bg-white/5 text-white/75 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    {amount}
                  </button>
                );
              })}
            </div>
          </div>
        </label>
      </div>

      <div className="mt-4 text-sm space-y-1">
        {entryPrice != null && exitPrice != null ? (
          <>
            <div className="text-white/65">Result</div>
            <div className="text-base font-semibold">
              PnL:{' '}
              <span className={pnlColor}>
                {Number(pnl).toFixed(4)} USDT
              </span>
            </div>
            <div className="text-xs">
              PnL%:{' '}
              <span className={pnlPctColor}>
                {Number(pnlPct).toFixed(2)}%
              </span>
            </div>
          </>
        ) : (
          <div className="text-white/60">
            Оберіть дві свічки на графіку, щоб порахувати прибуток.
          </div>
        )}
      </div>
    </div>
  );
}
