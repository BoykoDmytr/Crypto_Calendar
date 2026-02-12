import React, { useState } from 'react';

/**
 * ProfitCalculator
 *
 * A simple calculator that uses stored close prices to estimate the
 * profit or loss on a futures trade.  Users can enter their margin
 * (USDT), leverage, choose long/short, and select entry and exit
 * offsets relative to the event's T0 minute (−30 … +30).  The
 * component computes the entry and exit prices from the provided
 * series, calculates the quantity (notional / entry price) and
 * outputs both PnL in USDT and as a percentage of the margin.
 *
 * Props:
 *   closeSeries (number[]): array of 61 close prices (index 0 = −30m)
 */
export default function ProfitCalculator({ closeSeries = [] }) {
  const [investment, setInvestment] = useState(100);
  const [leverage, setLeverage] = useState(1);
  const [side, setSide] = useState('long');
  const [entryOffset, setEntryOffset] = useState(0);
  const [exitOffset, setExitOffset] = useState(5);

  const toIndex = (offset) => offset + 30;
  const entryIndex = toIndex(entryOffset);
  const exitIndex = toIndex(exitOffset);
  const entryPrice = closeSeries?.[entryIndex] ?? null;
  const exitPrice = closeSeries?.[exitIndex] ?? null;
  const notional = investment * leverage;
  const qty = entryPrice ? notional / entryPrice : 0;
  let pnl = 0;
  if (entryPrice != null && exitPrice != null) {
    pnl = side === 'long' ? qty * (exitPrice - entryPrice) : qty * (entryPrice - exitPrice);
  }
  const pnlPct = investment ? (pnl / investment) * 100 : 0;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mt-4 bg-white/60 dark:bg-[#0d1425]/50">
      <h4 className="text-sm font-semibold mb-3">Profit Calculator</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-300">Leverage (1–50x)</span>
          <input
            type="number"
            min="1"
            max="50"
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-300">Side</span>
          <select
            value={side}
            onChange={(e) => setSide(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a]"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-300">Entry offset (−30…+30)</span>
          <input
            type="number"
            min="-30"
            max="30"
            value={entryOffset}
            onChange={(e) => setEntryOffset(Number(e.target.value))}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-600 dark:text-gray-300">Exit offset (−30…+30)</span>
          <input
            type="number"
            min="-30"
            max="30"
            value={exitOffset}
            onChange={(e) => setExitOffset(Number(e.target.value))}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-[#0b0f1a]"
          />
        </label>
      </div>
      <div className="mt-4 text-sm space-y-1">
        <div>Entry price: {entryPrice != null ? Number(entryPrice).toFixed(6) : '—'}</div>
        <div>Exit price: {exitPrice != null ? Number(exitPrice).toFixed(6) : '—'}</div>
        <div>PnL: {Number(pnl).toFixed(4)} USDT</div>
        <div>PnL%: {Number(pnlPct).toFixed(2)}%</div>
      </div>
    </div>
  );
}