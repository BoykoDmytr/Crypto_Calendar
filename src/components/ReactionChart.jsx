import React from 'react';

/**
 * ReactionChart (Candles + Range selection)
 *
 * Renders 61 candles for ±30m window (offsets -30..+30).
 * Uses offset 0 candle (index 30) as the base price for % scaling on Y.
 *
 * ✅ Changes vs old version:
 * - Candlestick chart instead of line curve
 * - Click-to-select range (2 clicks). Selected range is highlighted.
 * - Exposes selection through onRangeSelect + selectedRange props.
 *
 * Props:
 *   closeSeries (number[]): series of close prices (length 61)
 *   highSeries  (number[]|null): series of highs (optional, length 61)
 *   lowSeries   (number[]|null): series of lows (optional, length 61)
 *   onRangeSelect ({startIdx:number, endIdx:number|null}) => void
 *   selectedRange ({startIdx:number, endIdx:number|null}|null)
 */
export default function ReactionChart({
  closeSeries = [],
  highSeries = [],
  lowSeries = [],
  onRangeSelect,
  selectedRange = null,
}) {
  const length = closeSeries.length;
  if (!length || length !== 61) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Немає даних для графіку.</p>;
  }

  const baseIndex = 30; // offset 0 at centre
  const basePrice = closeSeries[baseIndex];

  // Derive open prices from previous close (first bar uses its own close).
  const openSeries = closeSeries.map((cl, idx) => (idx === 0 ? cl : closeSeries[idx - 1]));

  // Use provided high/low series when available, otherwise derive from open/close.
  const highs =
    Array.isArray(highSeries) && highSeries.length === 61
      ? highSeries
      : closeSeries.map((cl, idx) => Math.max(cl ?? 0, openSeries[idx] ?? 0));

  const lows =
    Array.isArray(lowSeries) && lowSeries.length === 61
      ? lowSeries
      : closeSeries.map((cl, idx) => Math.min(cl ?? 0, openSeries[idx] ?? 0));

  // Convert high/low percentages relative to the base price for scaling.
  const percentHighs = highs.map((p) => ((p - basePrice) / basePrice) * 100);
  const percentLows = lows.map((p) => ((p - basePrice) / basePrice) * 100);

  const minPercent = Math.min(...percentLows);
  const maxPercent = Math.max(...percentHighs);
  const range = maxPercent - minPercent || 1;

  // Chart dimensions.
  const width = 600;
  const height = 200;
  const paddingX = 40;
  const paddingY = 30;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  // X positions of each candle centre.
  const xPositions = Array.from({ length }, (_, idx) => paddingX + (innerWidth * idx) / (length - 1));

  // Map a percent value to a Y coordinate.
  const toY = (pct) => paddingY + (1 - (pct - minPercent) / range) * innerHeight;

  // Determine selection boundaries (highlight only when both ends exist).
  const hasCompleteRange = selectedRange && selectedRange.endIdx != null;
  const startIdx = hasCompleteRange ? Math.min(selectedRange.startIdx, selectedRange.endIdx) : null;
  const endIdx = hasCompleteRange ? Math.max(selectedRange.startIdx, selectedRange.endIdx) : null;

  // Click handler to select range: first click sets start, second click sets end.
  const handleClick = (idx) => {
    if (!onRangeSelect) return;

    // If no selection or selection incomplete -> set start
    if (!selectedRange || selectedRange.endIdx == null) {
      onRangeSelect({ startIdx: idx, endIdx: null });
      return;
    }

    // If we already had a complete range, start a new selection
    onRangeSelect({ startIdx: idx, endIdx: null });
  };

  // If start is set but end is not, a second click should set end.
  const handleSecondClick = (idx) => {
    if (!onRangeSelect) return;
    if (selectedRange && selectedRange.startIdx != null && selectedRange.endIdx == null) {
      onRangeSelect({ startIdx: selectedRange.startIdx, endIdx: idx });
    } else {
      handleClick(idx);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs mb-1 text-gray-600 dark:text-gray-300">
        <div className="flex gap-2 items-center">
          <span className="uppercase tracking-wide text-[10px] text-gray-500 dark:text-gray-400">
            Price Candles (±30m)
          </span>
          {basePrice != null && (
            <span className="rounded-full bg-white/60 dark:bg-white/10 px-2 py-0.5 border border-gray-200 dark:border-white/10 text-[10px]">
              base: {Number(basePrice).toFixed(6)}
            </span>
          )}
        </div>
      </div>

      <svg width={width} height={height} className="block">
        {/* horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = paddingY + ratio * innerHeight;
          return (
            <line
              key={`h-${ratio}`}
              x1={paddingX}
              x2={width - paddingX}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="stroke-gray-200 dark:stroke-white/15"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          );
        })}

        {/* vertical centre line at T0 */}
        {(() => {
          const x = paddingX + (innerWidth * baseIndex) / (length - 1);
          return (
            <line
              x1={x}
              x2={x}
              y1={paddingY}
              y2={height - paddingY}
              stroke="currentColor"
              className="stroke-gray-300 dark:stroke-white/20"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          );
        })()}

        {/* highlight selected range */}
        {hasCompleteRange && (
          <rect
            x={
              Math.min(xPositions[startIdx], xPositions[endIdx]) -
              (innerWidth / (length - 1)) / 2
            }
            y={paddingY}
            width={Math.abs(xPositions[endIdx] - xPositions[startIdx]) + innerWidth / (length - 1)}
            height={innerHeight}
            fill="#f5f5f5"
            opacity={0.2}
          />
        )}

        {/* candlesticks */}
        {closeSeries.map((close, idx) => {
          const open = openSeries[idx];
          const high = highs[idx];
          const low = lows[idx];

          const isUp = close >= open;
          const color = isUp ? '#22c55e' : '#ef4444';

          const x = xPositions[idx];

          const openPct = ((open - basePrice) / basePrice) * 100;
          const closePct = ((close - basePrice) / basePrice) * 100;
          const highPct = ((high - basePrice) / basePrice) * 100;
          const lowPct = ((low - basePrice) / basePrice) * 100;

          const openY = toY(openPct);
          const closeY = toY(closePct);
          const highY = toY(highPct);
          const lowY = toY(lowPct);

          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.abs(closeY - openY) || 1;
          const candleWidth = (innerWidth / (length - 1)) * 0.6;

          return (
            <g
              key={idx}
              onClick={() => handleSecondClick(idx)}
              style={{ cursor: onRangeSelect ? 'pointer' : 'default' }}
            >
              {/* wick */}
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1" />
              {/* body */}
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                stroke={color}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
