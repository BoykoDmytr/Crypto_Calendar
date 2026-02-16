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
    pnl = qty * (exitPrice - entryPrice);
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
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mt-4 bg-white/60 dark:bg-[#0d1425]/50">
      <h4 className="text-sm font-semibold mb-3">Profit Calculator</h4>
      <div className="grid grid-cols-1 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-300">Investment (USDT)</span>
          <input
            type="number"
            min="1"
            value={investment}
            onChange={(e) => onInvestmentChange?.(Number(e.target.value))}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a]"
          />
        </label>
      </div>

      <div className="mt-4 text-sm space-y-1">
        {entryPrice != null && exitPrice != null ? (
          <>
            <div>Entry price: {Number(entryPrice).toFixed(6)}</div>
            <div>Exit price: {Number(exitPrice).toFixed(6)}</div>
            <div>
              PnL:{' '}
              <span className={pnlColor}>
                {Number(pnl).toFixed(4)} USDT
              </span>
            </div>
            <div>
              PnL%:{' '}
              <span className={pnlPctColor}>
                {Number(pnlPct).toFixed(2)}%
              </span>
            </div>
          </>
        ) : (
          <div className="text-gray-600 dark:text-gray-400">
            Оберіть дві свічки на графіку, щоб порахувати прибуток.
          </div>
        )}
      </div>
    </div>
  );
}
