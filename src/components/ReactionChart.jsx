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
  investment, // ✅ optional, for $PNL
  isFullscreen = false,
}) {
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
  const pctRange = maxPercent - minPercent || 1;

  const height = isFullscreen ? Math.max(heightProp, 420) : heightProp;
  const paddingX = isFullscreen ? 72 : 60;
  const paddingY = isFullscreen ? 36 : 30;

  const baseWidth = isFullscreen ? 1280 : 600;
  const widthPerCandle = isFullscreen ? 18 : 12;
  const width = isFullscreen
    ? Math.max(baseWidth, length * widthPerCandle + paddingX * 2)
     : isMobile
      ? Math.max(baseWidth, length * widthPerCandle + paddingX * 2)
      : baseWidth;

  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  const xPositions = Array.from({ length }, (_, idx) =>
    paddingX + (innerWidth * idx) / (length - 1),
  );

  const toY = (pct) => paddingY + (1 - (pct - minPercent) / pctRange) * innerHeight;

  // Y ticks
  const yTickCount = 5;
  const yStep = pctRange / (yTickCount - 1);
  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const pct = maxPercent - i * yStep;
    const price = basePrice * (1 + pct / 100);
    const y = toY(pct);
    return { label: price.toFixed(6), y };
  });

  // X ticks
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

    const x = ((clientX - rect.left) / rect.width) * width;
    const step = innerWidth / (length - 1);
    const raw = Math.round((x - paddingX) / step);
    return clamp(raw, 0, length - 1);
  };

  const startDrag = (idx) => {
    if (idx == null) return;
    setIsDragging(true);
    setDragStartIdx(idx);
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

  // normalize selected range for drawing + pnl
  const hasSelection =
    selectedRange && selectedRange.startIdx != null && selectedRange.endIdx != null;
  const s = hasSelection ? Math.min(selectedRange.startIdx, selectedRange.endIdx) : null;
  const e = hasSelection ? Math.max(selectedRange.startIdx, selectedRange.endIdx) : null;

  // PNL values
  let pnlBox = null;
  if (hasSelection && s !== e) {
    const entry = closeSeries[s];
    const exit = closeSeries[e];
    // short: позитивний результат, коли ціна знижується
    const pct = ((entry - exit) / entry) * 100;

    // ✅ time range text like "10:50 – 11:00"
    let rangeText = `${Math.abs(e - s)}m`;
    if (startTime) {
      const t1 = startTime.add(s - 30, 'minute').format('HH:mm');
      const t2 = startTime.add(e - 30, 'minute').format('HH:mm');
      rangeText = `${t1} – ${t2}`;
    }

    // ✅ $PNL (USDT) if investment provided
    const inv = Number(investment);
    const pnlUsd = Number.isFinite(inv) && inv > 0 ? (inv * pct) / 100 : null;

    const midX = (xPositions[s] + xPositions[e]) / 2;

    pnlBox = {
      entry,
      exit,
      pct,
      rangeText,
      midX,
      pnlUsd,
    };
  }

  const boxW = isFullscreen ? 280 : 230;
  const boxH = isFullscreen ? 90 : 78;

  return (
    <div className={`w-full ${isFullscreen ? 'h-full flex items-center justify-center' : ''}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`block mx-auto ${isFullscreen ? 'w-full h-full' : ''}`}
        style={{ touchAction: 'none' }}
        onPointerDown={(ev) => {
          ev.preventDefault();
          const idx = getIdxFromClientX(ev.clientX);
          startDrag(idx);
        }}
        onPointerMove={(ev) => {
          if (!isDragging) return;
          ev.preventDefault();
          const idx = getIdxFromClientX(ev.clientX);
          updateDrag(idx);
        }}
        onPointerUp={(ev) => {
          ev.preventDefault();
          endDrag();
        }}
        onPointerCancel={() => endDrag()}
        onPointerLeave={() => {
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

        {/* selection highlight */}
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

        {/* ✅ PNL box AFTER candles => always on top */}
        {pnlBox && (
          <>
            {(() => {
              const x = clamp(pnlBox.midX - boxW / 2, paddingX, width - paddingX - boxW);
              const y = paddingY + 6;

              const pctText = `${pnlBox.pct >= 0 ? '+' : ''}${pnlBox.pct.toFixed(2)}%`;
              const usdText =
                pnlBox.pnlUsd == null ? null : `${Math.abs(pnlBox.pnlUsd).toFixed(4)} USDT`;

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
                  <text x={x + 10} y={y + 18} fill="#e2e8f0" fontSize={isFullscreen ? 13 : 11}>
                    PNL%:{' '}
                    <tspan fill={pnlBox.pct >= 0 ? '#22c55e' : '#ef4444'}>{pctText}</tspan>
                    {usdText && <tspan fill={pnlBox.pct >= 0 ? '#22c55e' : '#ef4444'}>{`  •  ${usdText}`}</tspan>}
                  </text>

                  <text x={x + 10} y={y + 36} fill="#94a3b8" fontSize={isFullscreen ? 12 : 10}>
                    {pnlBox.rangeText}
                  </text>

                  <text x={x + 10} y={y + 54} fill="#94a3b8" fontSize={isFullscreen ? 12 : 10}>
                    Entry: {pnlBox.entry.toFixed(6)} → Exit: {pnlBox.exit.toFixed(6)}
                  </text>
                </g>
              );
            })()}
          </>
        )}
      </svg>
    </div>
  );
}
