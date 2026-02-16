import React, { useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_MAP = { Kyiv: 'Europe/Kyiv' };

export default function ReactionChart({
  closeSeries = [],
  highSeries = [],
  lowSeries = [],
  onRangeSelect,
  selectedRange = null,
  startAt,
  timezone: tz,
}) {
  // ✅ HOOKS MUST BE FIRST (before any early returns)
  const [hoverIdx, setHoverIdx] = useState(null);

  // ✅ mobile detection (без хуків)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const length = closeSeries.length;
  if (!length || length !== 61) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Немає даних для графіку.
      </p>
    );
  }

  const baseIndex = 30;
  const basePrice = closeSeries[baseIndex];

  const openSeries = closeSeries.map((cl, idx) => (idx === 0 ? cl : closeSeries[idx - 1]));
  const highs =
    Array.isArray(highSeries) && highSeries.length === 61
      ? highSeries
      : closeSeries.map((cl, idx) => Math.max(cl ?? 0, openSeries[idx] ?? 0));
  const lows =
    Array.isArray(lowSeries) && lowSeries.length === 61
      ? lowSeries
      : closeSeries.map((cl, idx) => Math.min(cl ?? 0, openSeries[idx] ?? 0));

  const percentHighs = highs.map((p) => ((p - basePrice) / basePrice) * 100);
  const percentLows = lows.map((p) => ((p - basePrice) / basePrice) * 100);
  const maxPercent = Math.max(...percentHighs);
  const minPercent = Math.min(...percentLows);
  const range = maxPercent - minPercent || 1;

  // ✅ Параметри графіка
  const height = 200;
  const paddingX = 60;
  const paddingY = 30;

  // ✅ Ширина: мобілка — розширюємо, десктоп — 600px
  const baseWidth = 600; // десктоп
  const widthPerCandle = 12; // мобілка: 10–16 підбирай під себе

  const width = isMobile
    ? Math.max(baseWidth, length * widthPerCandle + paddingX * 2)
    : baseWidth;

  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  const xPositions = Array.from({ length }, (_, idx) =>
    paddingX + (innerWidth * idx) / (length - 1),
  );

  const toY = (pct) => paddingY + (1 - (pct - minPercent) / range) * innerHeight;

  // Y ticks (prices)
  const yTickCount = 5;
  const yStep = range / (yTickCount - 1);
  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const pct = maxPercent - i * yStep;
    const price = basePrice * (1 + pct / 100);
    const y = toY(pct);
    return { label: price.toFixed(6), y };
  });

  // X ticks (time every 5 min)
  const zone = TZ_MAP[tz] || tz || 'UTC';
  const startTime = startAt ? dayjs.utc(startAt).tz(zone) : null;
  const xTicks = [];
  if (startTime) {
    for (let offset = -30; offset <= 30; offset++) {
      if (offset % 5 === 0) {
        const x = xPositions[offset + 30];
        const t = startTime.add(offset, 'minute');
        xTicks.push({ x, label: t.format('HH:mm') });
      }
    }
  }

  // selection highlight logic
  let highlightStart = null;
  let highlightEnd = null;

  const hasStartOnly =
    selectedRange && selectedRange.startIdx != null && selectedRange.endIdx == null;
  const hasComplete = selectedRange && selectedRange.endIdx != null;

  if (hasComplete) {
    highlightStart = Math.min(selectedRange.startIdx, selectedRange.endIdx);
    highlightEnd = Math.max(selectedRange.startIdx, selectedRange.endIdx);
  } else if (hasStartOnly && hoverIdx != null) {
    highlightStart = Math.min(selectedRange.startIdx, hoverIdx);
    highlightEnd = Math.max(selectedRange.startIdx, hoverIdx);
  }

  const handleMouseEnter = (idx) => {
    if (hasStartOnly) setHoverIdx(idx);
  };

  const handleMouseLeave = () => setHoverIdx(null);

  const handleClick = (idx) => {
    if (!onRangeSelect) return;

    // start new selection
    if (!selectedRange || selectedRange.endIdx != null) {
      onRangeSelect({ startIdx: idx, endIdx: null });
      setHoverIdx(null);
      return;
    }

    // finish selection
    onRangeSelect({ startIdx: selectedRange.startIdx, endIdx: idx });
    setHoverIdx(null);
  };

  return (
    <div className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block mx-auto"
        onMouseLeave={handleMouseLeave}
      >
        {/* Y grid + labels */}
        {yTicks.map((tick, i) => (
          <g key={`y-${i}`}>
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={tick.y}
              y2={tick.y}
              stroke="currentColor"
              className="stroke-gray-200 dark:stroke-white/15"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text
              x={paddingX - 8}
              y={tick.y}
              fill="currentColor"
              className="text-[9px] text-gray-500 dark:text-gray-400"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* X grid + labels */}
        {xTicks.map((tick, i) => (
          <g key={`x-${i}`}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={paddingY}
              y2={height - paddingY}
              stroke="currentColor"
              className="stroke-gray-200 dark:stroke-white/10"
              strokeWidth="1"
              strokeDasharray="2 4"
            />
            <text
              x={tick.x}
              y={height - paddingY + 12}
              fill="currentColor"
              className="text-[9px] text-gray-500 dark:text-gray-400"
              textAnchor="middle"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* highlight range (preview while selecting or final) */}
        {highlightStart != null && highlightEnd != null && (
          <>
            <rect
              x={
                Math.min(xPositions[highlightStart], xPositions[highlightEnd]) -
                (innerWidth / (length - 1)) / 2
              }
              y={paddingY}
              width={
                Math.abs(xPositions[highlightEnd] - xPositions[highlightStart]) +
                innerWidth / (length - 1)
              }
              height={innerHeight}
              fill="#90cdf4"
              opacity="0.2"
            />
            <line
              x1={xPositions[highlightStart]}
              x2={xPositions[highlightStart]}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#90cdf4"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <line
              x1={xPositions[highlightEnd]}
              x2={xPositions[highlightEnd]}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#90cdf4"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
          </>
        )}

        {/* candles */}
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
              onClick={() => handleClick(idx)}
              onMouseEnter={() => handleMouseEnter(idx)}
              style={{ cursor: onRangeSelect ? 'pointer' : 'default' }}
            >
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1" />
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
