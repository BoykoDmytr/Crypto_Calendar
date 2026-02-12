import React from 'react';

/**
 * ReactionChart
 *
 * This component renders the ±30m reaction curve for a crypto event.  It
 * accepts arrays of close, high and low prices (each of length 61
 * covering offsets from -30 to +30 minutes).  A base price is taken
 * from the offset 0 candle, and all other points are shown as a
 * percentage change relative to this base.  The chart displays a
 * coloured line indicating the price trajectory, horizontal grid
 * lines, and highlights the maximum and minimum prices within the
 * window.  It also annotates the base price in the legend.
 *
 * Props:
 *   closeSeries (number[]): series of close prices
 *   highSeries  (number[]|null): series of high prices (for max marker)
 *   lowSeries   (number[]|null): series of low prices (for min marker)
 */
export default function ReactionChart({ closeSeries = [], highSeries = [], lowSeries = [] }) {
  const length = closeSeries.length;
  if (!length || length !== 61) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Немає даних для графіку.</p>;
  }
  const baseIndex = 30; // offset 0 at centre
  const basePrice = closeSeries[baseIndex];
  // compute percentage series relative to base
  const percentSeries = closeSeries.map((price) => {
    if (basePrice == null || price == null) return 0;
    return ((price - basePrice) / basePrice) * 100;
  });
  const maxIdx = highSeries && highSeries.length === 61
    ? highSeries.reduce((acc, val, idx) => (val != null && (highSeries[acc] == null || val > highSeries[acc]) ? idx : acc), 0)
    : percentSeries.reduce((acc, val, idx) => (val > percentSeries[acc] ? idx : acc), 0);
  const minIdx = lowSeries && lowSeries.length === 61
    ? lowSeries.reduce((acc, val, idx) => (val != null && (lowSeries[acc] == null || val < lowSeries[acc]) ? idx : acc), 0)
    : percentSeries.reduce((acc, val, idx) => (val < percentSeries[acc] ? idx : acc), 0);
  const width = 600;
  const height = 200;
  const paddingX = 40;
  const paddingY = 30;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const minPercent = Math.min(...percentSeries);
  const maxPercent = Math.max(...percentSeries);
  const range = maxPercent - minPercent || 1;
  // Map each point into SVG coordinates
  const coords = percentSeries.map((pct, idx) => {
    const x = paddingX + (innerWidth * idx) / (length - 1);
    const normalized = (pct - minPercent) / range;
    const y = paddingY + (1 - normalized) * innerHeight;
    return { x, y };
  });
  const pathData = coords.map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x},${pt.y}`).join(' ');
  // colour line based on final vs first
  const overallChange = percentSeries[length - 1];
  const lineColour = overallChange > 0 ? '#22c55e' : overallChange < 0 ? '#ef4444' : '#fbbf24';

  // Render SVG with max/min markers
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs mb-1 text-gray-600 dark:text-gray-300">
        <div className="flex gap-2 items-center">
          <span className="uppercase tracking-wide text-[10px] text-gray-500 dark:text-gray-400">
            Reaction Curve (±30m)
          </span>
          {basePrice != null && (
            <span className="rounded-full bg-white/60 dark:bg-white/10 px-2 py-0.5 border border-gray-200 dark:border-white/10 text-[10px]">
              base: {Number(basePrice).toFixed(6)}
            </span>
          )}
        </div>
        {overallChange != null && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: lineColour }}
          >
            {overallChange > 0 && '▲'}
            {overallChange === 0 && '▬'}
            {overallChange < 0 && '▼'}
            {overallChange.toFixed(2)}%
          </span>
        )}
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
        {/* price line */}
        <path
          d={pathData}
          fill="none"
          stroke={lineColour}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* markers for each point */}
        {coords.map((pt, idx) => (
          <circle
            key={idx}
            cx={pt.x}
            cy={pt.y}
            r={idx === baseIndex ? 4 : 2}
            fill={idx === baseIndex ? '#0ea5e9' : '#ffffff'}
            stroke={idx === baseIndex ? '#0ea5e9' : lineColour}
            strokeWidth={idx === baseIndex ? 2 : 1}
          />
        ))}
        {/* highlight max and min */}
        {coords.length && (
          <>
            <circle
              cx={coords[maxIdx].x}
              cy={coords[maxIdx].y}
              r={4.5}
              fill="#22c55e"
              strokeWidth="1"
              stroke="#14532d"
            />
            <text
              x={coords[maxIdx].x}
              y={coords[maxIdx].y - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#22c55e"
            >
              MAX
            </text>
            <circle
              cx={coords[minIdx].x}
              cy={coords[minIdx].y}
              r={4.5}
              fill="#ef4444"
              strokeWidth="1"
              stroke="#991b1b"
            />
            <text
              x={coords[minIdx].x}
              y={coords[minIdx].y - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#ef4444"
            >
              MIN
            </text>
          </>
        )}
      </svg>
      {/* timeline labels */}
      <div className="mt-1 grid text-[10px] text-center text-gray-500 dark:text-gray-400" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, idx) => (
          <span key={idx}>{idx - baseIndex}</span>
        ))}
      </div>
    </div>
  );
}