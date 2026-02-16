import React, { useState } from 'react';

/**
 * ProfitCalculator (simplified)
 *
 * ✅ Changes vs old version (per patch):
 * - Removes leverage, side, entry offset, exit offset inputs
 * - Keeps only Investment input
 * - Entry/Exit offsets are provided by parent (from chart range selection)
 * - Computes PnL as if it’s a 1x LONG from entry -> exit
 *
 * Props:
 *   closeSeries (number[]): array of 61 close prices (index 0 = −30m)
 *   startOffset (number|null): offset in minutes relative to T0 (−30..+30)
 *   endOffset   (number|null): offset in minutes relative to T0 (−30..+30)
 */
export default function ProfitCalculator({ closeSeries = [], startOffset = null, endOffset = null }) {
  // Simplified profit calculator: only investment input remains.
  const [investment, setInvestment] = useState(100);

  const toIndex = (offset) => (offset != null ? offset + 30 : null);

  const entryIndex = startOffset != null ? toIndex(startOffset) : null;
  const exitIndex = endOffset != null ? toIndex(endOffset) : null;

  const entryPrice = entryIndex != null ? closeSeries?.[entryIndex] : null;
  const exitPrice = exitIndex != null ? closeSeries?.[exitIndex] : null;

  let pnl = null;
  let pnlPct = null;

  if (entryPrice != null && exitPrice != null) {
    // Quantity bought with 1x leverage
    const qty = investment / entryPrice;
    pnl = qty * (exitPrice - entryPrice);
    pnlPct = investment ? (pnl / investment) * 100 : null;
  }

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
            onChange={(e) => setInvestment(Number(e.target.value))}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a]"
          />
        </label>
      </div>

      <div className="mt-4 text-sm space-y-1">
        {entryPrice != null && exitPrice != null ? (
          <>
            <div>Entry price: {Number(entryPrice).toFixed(6)}</div>
            <div>Exit price: {Number(exitPrice).toFixed(6)}</div>
            <div>PnL: {Number(pnl).toFixed(4)} USDT</div>
            <div>PnL%: {Number(pnlPct).toFixed(2)}%</div>
          </>
        ) : (
          <div className="text-gray-600 dark:text-gray-400">
            Select a range on the chart to compute profit.
          </div>
        )}
      </div>
    </div>
  );
}
