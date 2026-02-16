import React, { useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_MAP = { Kyiv: 'Europe/Kyiv' };

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export default function ReactionChart({
  closeSeries = [],
  highSeries = [],
  lowSeries = [],
  onRangeSelect,
  selectedRange = null,
  startAt,
  timezone: tz,
  height: heightProp = 200,
}) {
  // ✅ Hooks first
  const svgRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIdx, setDragStartIdx] = useState(null);

  const length = closeSeries.length;
  if (!length || length !== 61) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Немає даних для графіку.
      </p>
    );
  }

  // mobile detection (no hooks)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

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

  // sizing
  const height = heightProp;
  const paddingX = 60;
  const paddingY = 30;

  // ширина: на десктопі — 600px (без скролу), на мобілці — ширше (для тапа)
  const baseWidth = 600;
  const widthPerCandle = 12; // 10–16
  const width = isMobile
    ? Math.max(baseWidth, length * widthPerCandle + paddingX * 2)
    : baseWidth;

  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  const xPositions = Array.from({ length }, (_, idx) =>
    paddingX + (innerWidth * idx) / (length - 1),
  );

  const toY = (pct) => paddingY + (1 - (pct - minPercent) / range) * innerHeight;

  // ticks
  const yTickCount = 5;
  const yStep = range / (yTickCount - 1);
  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const pct = maxPercent - i * yStep;
    const price = basePrice * (1 + pct / 100);
    const y = toY(pct);
    return { label: price.toFixed(6), y };
  });

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

  // ---- TradingView-like ruler selection (drag) ----
  const getIdxFromClientX = (clientX) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return null;

    // clientX -> viewBox x
    const x = ((clientX - rect.left) / rect.width) * width;

    const step = innerWidth / (length - 1);
    const raw = Math.round((x - paddingX) / step);
    return clamp(raw, 0, length - 1);
  };

  const startDrag = (idx) => {
    if (idx == null) return;
    setIsDragging(true);
    setDragStartIdx(idx);

    // стартуємо selection одразу
    onRangeSelect?.({ startIdx: idx, endIdx: idx });
  };

  const updateDrag = (idx) => {
    if (!isDragging || dragStartIdx == null || idx == null) return;
    onRangeSelect?.({ startIdx: dragStartIdx, endIdx: idx });
  };

  const endDrag = () => {
    setIsDragging(false);
    setDragStartIdx(null);
  };

  // normalize selected range for drawing
  const hasSelection = selectedRange && selectedRange.startIdx != null && selectedRange.endIdx != null;
  const s = hasSelection ? Math.min(selectedRange.startIdx, selectedRange.endIdx) : null;
  const e = hasSelection ? Math.max(selectedRange.startIdx, selectedRange.endIdx) : null;

  // measurement (PNL) values
  let pnlBox = null;
  if (hasSelection && s !== e) {
    const entry = closeSeries[s];
    const exit = closeSeries[e];
    const delta = exit - entry;
    const pct = (delta / entry) * 100;
    const candles = e - s; // 1 candle = 1 minute

    const midX = (xPositions[s] + xPositions[e]) / 2;
    pnlBox = {
      entry,
      exit,
      delta,
      pct,
      candles,
      midX,
    };
  }

  const boxW = 190;
  const boxH = 56;

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block mx-auto"
        style={{ touchAction: 'none' }} // важливо для мобілки, щоб drag працював як треба
        onPointerDown={(e) => {
          e.preventDefault();
          const idx = getIdxFromClientX(e.clientX);
          startDrag(idx);
        }}
        onPointerMove={(e) => {
          if (!isDragging) return;
          e.preventDefault();
          const idx = getIdxFromClientX(e.clientX);
          updateDrag(idx);
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          endDrag();
        }}
        onPointerCancel={() => endDrag()}
        onPointerLeave={() => {
          // якщо юзер “вийшов” пальцем — завершуємо drag
          if (isDragging) endDrag();
        }}
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

        {/* selection highlight like TradingView ruler */}
        {hasSelection && s != null && e != null && (
          <>
            <rect
              x={Math.min(xPositions[s], xPositions[e]) - (innerWidth / (length - 1)) / 2}
              y={paddingY}
              width={Math.abs(xPositions[e] - xPositions[s]) + innerWidth / (length - 1)}
              height={innerHeight}
              fill="#60a5fa"
              opacity="0.14"
            />
            <line
              x1={xPositions[s]}
              x2={xPositions[s]}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#60a5fa"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <line
              x1={xPositions[e]}
              x2={xPositions[e]}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#60a5fa"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
          </>
        )}

        {/* PNL box on chart */}
        {pnlBox && (
          <>
            {(() => {
              const x = clamp(pnlBox.midX - boxW / 2, paddingX, width - paddingX - boxW);
              const y = paddingY + 6;
              const pctText = `${pnlBox.pct >= 0 ? '+' : ''}${pnlBox.pct.toFixed(2)}%`;
              const deltaText = `${pnlBox.delta >= 0 ? '+' : ''}${pnlBox.delta.toFixed(6)}`;
              const candlesText = `${pnlBox.candles}m`;

              return (
                <g>
                  <rect
                    x={x}
                    y={y}
                    width={boxW}
                    height={boxH}
                    rx="10"
                    fill="rgba(15, 23, 42, 0.92)"
                    stroke="rgba(148, 163, 184, 0.25)"
                  />
                  <text x={x + 10} y={y + 18} fill="#e2e8f0" fontSize="11">
                    PNL: <tspan fill={pnlBox.pct >= 0 ? '#22c55e' : '#ef4444'}>{pctText}</tspan>
                    <tspan fill="#94a3b8">  •  {candlesText}</tspan>
                  </text>
                  <text x={x + 10} y={y + 34} fill="#94a3b8" fontSize="10">
                    Entry: {pnlBox.entry.toFixed(6)}  →  Exit: {pnlBox.exit.toFixed(6)}
                  </text>
                  <text x={x + 10} y={y + 49} fill="#94a3b8" fontSize="10">
                    Δprice: {deltaText}
                  </text>
                </g>
              );
            })()}
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
            <g key={idx}>
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
