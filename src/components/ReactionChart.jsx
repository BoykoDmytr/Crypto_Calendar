import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_MAP = { Kyiv: 'Europe/Kyiv' };

// Number of candles after the event (T0). There are always 31 minutes after the event.
const LOOKAHEAD_AFTER_EVENT = 31;
const MIN_VIEW = 8; // мін. свічок у вікні при zoom-in

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function getTouchDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Mobile exchange-like interactions:
 * - Pinch (2 fingers): zoom X by changing visible candle count (recomputes axes).
 * - 1-finger drag (when zoomed in): pan horizontally.
 * - Long-press (~250ms): start range selection (PNL) to avoid pan/selection conflict.
 *
 * Desktop:
 * - Same as before: drag = range selection.
 */
export default function ReactionChart({
  closeSeries = [],
  highSeries = [],
  lowSeries = [],
  onRangeSelect,
  selectedRange = null,
  startAt,
  timezone: tz,
  height: heightProp = 200,
  investment,
  isFullscreen = false,
}) {
  // ---------------- HOOKS (MUST ALWAYS RUN) ----------------
  const svgRef = useRef(null);
  const wrapRef = useRef(null);

  const [phoneLike, setPhoneLike] = useState(false);
  const [containerW, setContainerW] = useState(null);

  // initialize the number of visible candles to the length of the provided series or fallback
  const [viewCount, setViewCount] = useState(closeSeries.length || LOOKAHEAD_AFTER_EVENT);
  const [viewStart, setViewStart] = useState(0);
  const didInitRef = useRef(false);

  const [isSelecting, setIsSelecting] = useState(false);
  const selectStartIdxRef = useRef(null);

  const modeRef = useRef('none'); // none | pending | pan | select
  const pointerIdRef = useRef(null);
  const movedRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const panRef = useRef({ startX: 0, startViewStart: 0 });

  const isPinchingRef = useRef(false);
  const pinchRef = useRef({
    initialDistance: 0,
    initialCount: closeSeries.length || LOOKAHEAD_AFTER_EVENT,
    initialStart: 0,
    anchorIdx: 0,
    anchorRel: 0.5,
  });

  // detect phone-like (touch/coarse + width<1024)
  useEffect(() => {
    const compute = () => {
      if (typeof window === 'undefined') return;
      const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
      const tp = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
      const small = window.innerWidth < 1024;
      setPhoneLike((coarse || tp > 0) && small);
    };

    compute();

    if (typeof window === 'undefined') return undefined;

    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);

    const mq = window.matchMedia?.('(pointer: coarse)');
    const onMq = () => compute();
    try {
      mq?.addEventListener?.('change', onMq);
    } catch {
      // older safari
      mq?.addListener?.(onMq);
    }

    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
      try {
        mq?.removeEventListener?.('change', onMq);
      } catch {
        mq?.removeListener?.(onMq);
      }
    };
  }, []);

  // ResizeObserver for container width (only matters on phone-like)
  useEffect(() => {
    if (!phoneLike) return;
    if (!wrapRef.current) return;
    if (typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const w = entries?.[0]?.contentRect?.width;
      if (w && Number.isFinite(w)) setContainerW(w);
    });

    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [phoneLike]);

  // init viewport on phone-like (center around EVENT)
  useEffect(() => {
    if (!phoneLike) {
        didInitRef.current = false;
        setViewCount(closeSeries.length || LOOKAHEAD_AFTER_EVENT);
        setViewStart(0);
        return;
      }
      if (didInitRef.current) return;
      didInitRef.current = true;

    setViewCount(closeSeries.length || LOOKAHEAD_AFTER_EVENT);
      setViewStart(0);
    }, [phoneLike, closeSeries.length]);

  // keep viewStart clamped
  useEffect(() => {
    const fullLen = closeSeries.length;
    setViewStart((s) => clamp(s, 0, fullLen - viewCount));
  }, [viewCount, closeSeries.length]);

  // ---------------- AFTER HOOKS: SAFE COMPUTATIONS ----------------
  const fullLen = closeSeries.length;
  // Index of the event (T0) is the number of pre-event candles.
  const baseIndex = fullLen >= LOOKAHEAD_AFTER_EVENT ? fullLen - LOOKAHEAD_AFTER_EVENT : 0;
  const hasData = fullLen >= LOOKAHEAD_AFTER_EVENT;

  // still after hooks => eslint ok
  if (!hasData) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Немає даних для графіку.
      </p>
    );
  }

  const effectiveViewCount = phoneLike ? viewCount : fullLen;
  const effectiveViewStart = phoneLike ? viewStart : 0;
  const viewEnd = effectiveViewStart + effectiveViewCount - 1;

  // build derived series
  const basePrice = closeSeries[baseIndex];

  const openFull = closeSeries.map((cl, idx) => (idx === 0 ? cl : closeSeries[idx - 1]));
  const highsFull =
    Array.isArray(highSeries) && highSeries.length === fullLen
      ? highSeries
      : closeSeries.map((cl, idx) => Math.max(cl ?? 0, openFull[idx] ?? 0));
  const lowsFull =
    Array.isArray(lowSeries) && lowSeries.length === fullLen
      ? lowSeries
      : closeSeries.map((cl, idx) => Math.min(cl ?? 0, openFull[idx] ?? 0));

  // sizing
  const height = isFullscreen ? Math.max(heightProp, 420) : heightProp;
  const paddingX = isFullscreen ? 72 : 60;
  const paddingY = isFullscreen ? 36 : 30;

  const desktopWidth = isFullscreen ? 1280 : 600;
  const width = phoneLike
    ? Math.max(320, Math.floor(containerW || 360))
    : desktopWidth;

  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  // autoscale Y based on visible window (exchange-like)
  const visHighPcts = [];
  const visLowPcts = [];
  for (let gi = effectiveViewStart; gi <= viewEnd; gi++) {
    visHighPcts.push(((highsFull[gi] - basePrice) / basePrice) * 100);
    visLowPcts.push(((lowsFull[gi] - basePrice) / basePrice) * 100);
  }
  const maxPercent = Math.max(...visHighPcts);
  const minPercent = Math.min(...visLowPcts);
  const pctRange = maxPercent - minPercent || 1;

  const toY = (pct) => paddingY + (1 - (pct - minPercent) / pctRange) * innerHeight;

  const stepX = effectiveViewCount > 1 ? innerWidth / (effectiveViewCount - 1) : innerWidth;
  const xPositions = Array.from({ length: effectiveViewCount }, (_, i) => paddingX + i * stepX);

  // ticks
  const zone = TZ_MAP[tz] || tz || 'UTC';
  const startTime = startAt ? dayjs.utc(startAt).tz(zone) : null;

  const yTickCount = 5;
  const yStep = pctRange / (yTickCount - 1);
  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const pct = maxPercent - i * yStep;
    const price = basePrice * (1 + pct / 100);
    return { y: toY(pct), label: price.toFixed(6) };
  });

  const xTicks = [];
  if (startTime) {
    const candidates = [];
    for (let gi = effectiveViewStart; gi <= viewEnd; gi++) {
      const offset = gi - baseIndex;
      if (offset % 5 === 0) candidates.push(gi);
    }
    const maxLabels = 7;
    const stride = Math.max(1, Math.ceil(candidates.length / maxLabels));
    const picked = candidates.filter((_, i) => i % stride === 0);

    for (const gi of picked) {
      const vi = gi - effectiveViewStart;
      const x = xPositions[vi];
      const offset = gi - baseIndex;
      xTicks.push({ x, label: startTime.add(offset, 'minute').format('HH:mm') });
    }
  }

  // selection helpers (use internal start idx so no parent-state lag)
  const startSelect = (idx) => {
    if (idx == null) return;
    setIsSelecting(true);
    selectStartIdxRef.current = idx;
    onRangeSelect?.({ startIdx: idx, endIdx: idx });
  };

  const updateSelect = (idx) => {
    if (!isSelecting) return;
    const s = selectStartIdxRef.current;
    if (s == null || idx == null) return;
    onRangeSelect?.({ startIdx: s, endIdx: idx });
  };

  const endSelect = () => {
    setIsSelecting(false);
    selectStartIdxRef.current = null;
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const getIdxFromClientX = (clientX) => {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    if (!rect.width) return null;

    const xSvg = ((clientX - rect.left) / rect.width) * width;
    const raw = Math.round((xSvg - paddingX) / stepX);
    const vi = clamp(raw, 0, effectiveViewCount - 1);
    return effectiveViewStart + vi;
  };

  // selection rendering (clip to viewport)
  const hasSelection =
    selectedRange && selectedRange.startIdx != null && selectedRange.endIdx != null;

  const selS = hasSelection ? Math.min(selectedRange.startIdx, selectedRange.endIdx) : null;
  const selE = hasSelection ? Math.max(selectedRange.startIdx, selectedRange.endIdx) : null;

  const selectionOverlaps =
    hasSelection && !(selE < effectiveViewStart || selS > viewEnd);

  const clipS = selectionOverlaps ? clamp(selS, effectiveViewStart, viewEnd) : null;
  const clipE = selectionOverlaps ? clamp(selE, effectiveViewStart, viewEnd) : null;

  // pnl tooltip only if fully inside current window
  let pnlBox = null;
  if (hasSelection && selS !== selE && selS >= effectiveViewStart && selE <= viewEnd) {
    const entry = closeSeries[selS];
    const exit = closeSeries[selE];
    const pct = ((entry - exit) / entry) * 100;

    let rangeText = `${Math.abs(selE - selS)}m`;
    if (startTime) {
      const t1 = startTime.add(selS - baseIndex, 'minute').format('HH:mm');
      const t2 = startTime.add(selE - baseIndex, 'minute').format('HH:mm');
      rangeText = `${t1} – ${t2}`;
    }

    const inv = Number(investment);
    const pnlUsd = Number.isFinite(inv) && inv > 0 ? (inv * pct) / 100 : null;

    const xs = xPositions[selS - effectiveViewStart];
    const xe = xPositions[selE - effectiveViewStart];

    pnlBox = { entry, exit, pct, pnlUsd, rangeText, midX: (xs + xe) / 2 };
  }

  const boxW = isFullscreen ? 280 : 230;
  const boxH = isFullscreen ? 90 : 78;

  // EVENT marker only if visible in viewport
  const eventVisible = baseIndex >= effectiveViewStart && baseIndex <= viewEnd;
  const eventX = eventVisible ? xPositions[baseIndex - effectiveViewStart] : null;
  const eventPct = ((closeSeries[baseIndex] - basePrice) / basePrice) * 100;
  const eventY = toY(eventPct);

  // ---------------- INTERACTIONS ----------------
  const handlePointerDown = (ev) => {
    ev.preventDefault();

    if (isPinchingRef.current) return;

    pointerIdRef.current = ev.pointerId;
    svgRef.current?.setPointerCapture?.(ev.pointerId);

    movedRef.current = false;
    panRef.current.startX = ev.clientX;
    panRef.current.startViewStart = effectiveViewStart;

    // desktop => always select (as before)
    if (!phoneLike) {
      modeRef.current = 'select';
      startSelect(getIdxFromClientX(ev.clientX));
      return;
    }

    // phone-like:
    // if zoomed in => default action is PAN, selection via long-press
    if (effectiveViewCount < fullLen) {
      modeRef.current = 'pending';
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        if (modeRef.current !== 'pending') return;
        if (movedRef.current) return;
        modeRef.current = 'select';
        startSelect(getIdxFromClientX(panRef.current.startX));
      }, 250);
      return;
    }

    // if fully zoomed out => drag behaves like selection (old behavior)
    modeRef.current = 'select';
    startSelect(getIdxFromClientX(ev.clientX));
  };

  const handlePointerMove = (ev) => {
    if (pointerIdRef.current != null && ev.pointerId !== pointerIdRef.current) return;
    if (isPinchingRef.current) return;

    const mode = modeRef.current;
    if (mode === 'none') return;

    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect?.width) return;

    const dxPx = ev.clientX - panRef.current.startX;
    if (Math.abs(dxPx) > 6) movedRef.current = true;

    // pending -> pan when finger moves
    if (mode === 'pending' && movedRef.current) {
      clearLongPress();
      modeRef.current = 'pan';
    }

    if (modeRef.current === 'pan') {
      ev.preventDefault();

      const dxSvg = (dxPx / rect.width) * width;
      const shiftCandles = Math.round(dxSvg / stepX);

      const nextStart = clamp(
        panRef.current.startViewStart - shiftCandles,
        0,
        fullLen - effectiveViewCount,
      );

      // only meaningful on phone-like
      setViewStart(nextStart);
      return;
    }

    if (modeRef.current === 'select') {
      ev.preventDefault();
      updateSelect(getIdxFromClientX(ev.clientX));
    }
  };

  const handlePointerUp = (ev) => {
    if (pointerIdRef.current != null && ev.pointerId !== pointerIdRef.current) return;

    clearLongPress();
    if (modeRef.current === 'select') endSelect();

    modeRef.current = 'none';
    pointerIdRef.current = null;
    movedRef.current = false;
  };

  // pinch zoom (touch)
  const handleTouchStart = (e) => {
    if (!phoneLike) return;
    if (e.touches.length !== 2) return;

    e.preventDefault();
    clearLongPress();

    // cancel any selection/pan
    if (isSelecting) endSelect();
    modeRef.current = 'none';

    isPinchingRef.current = true;

    const [t1, t2] = e.touches;
    const dist = getTouchDistance(t1, t2);

    const rect = svgRef.current?.getBoundingClientRect();
    const cx = (t1.clientX + t2.clientX) / 2;

    let anchorRel = 0.5;
    if (rect?.width) {
      const xSvg = ((cx - rect.left) / rect.width) * width;
      anchorRel = clamp((xSvg - paddingX) / innerWidth, 0, 1);
    }

    const anchorIdx = effectiveViewStart + Math.round(anchorRel * (effectiveViewCount - 1));

    pinchRef.current = {
      initialDistance: dist,
      initialCount: effectiveViewCount,
      initialStart: effectiveViewStart,
      anchorIdx: clamp(anchorIdx, 0, fullLen - 1),
      anchorRel,
    };
  };

  const handleTouchMove = (e) => {
    if (!phoneLike) return;
    if (!isPinchingRef.current) return;
    if (e.touches.length !== 2) return;

    e.preventDefault();

    const [t1, t2] = e.touches;
    const dist = getTouchDistance(t1, t2);

    const p = pinchRef.current;
    const ratio = dist / (p.initialDistance || dist);

    // dist ↑ => zoom-in => fewer candles
    let nextCount = Math.round(p.initialCount / ratio);
    nextCount = clamp(nextCount, MIN_VIEW, fullLen);

    let nextStart = Math.round(p.anchorIdx - p.anchorRel * (nextCount - 1));
    nextStart = clamp(nextStart, 0, fullLen - nextCount);

    setViewCount(nextCount);
    setViewStart(nextStart);
  };

  const handleTouchEnd = (e) => {
    if (!phoneLike) return;
    if (e.touches.length < 2) isPinchingRef.current = false;
  };

  // ---------------- RENDER ----------------
  return (
    <div ref={wrapRef} className={`w-full ${isFullscreen ? 'h-full flex items-center justify-center' : ''}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`block mx-auto ${isFullscreen ? 'w-full h-full' : ''}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          clearLongPress();
          if (modeRef.current === 'select') endSelect();
          modeRef.current = 'none';
          pointerIdRef.current = null;
          movedRef.current = false;
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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

        {/* Event marker */}
        {eventVisible && (
          <g>
            <line
              x1={eventX}
              x2={eventX}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeDasharray="6 4"
              opacity="0.95"
            />
            <rect x={eventX - 28} y={paddingY - 24} width={56} height={18} rx={5} fill="#2563eb" />
            <text
              x={eventX}
              y={paddingY - 11}
              fill="#dbeafe"
              fontSize={9}
              fontWeight={700}
              textAnchor="middle"
              letterSpacing="0.8"
            >
              EVENT
            </text>
            <circle cx={eventX} cy={eventY} r={4} fill="#60a5fa" stroke="#1e3a8a" strokeWidth="1" />
          </g>
        )}

        {/* selection highlight (clipped) */}
        {selectionOverlaps && clipS != null && clipE != null && clipS !== clipE && (
          <>
            <rect
              x={Math.min(xPositions[clipS - effectiveViewStart], xPositions[clipE - effectiveViewStart]) - stepX / 2}
              y={paddingY}
              width={Math.abs(xPositions[clipE - effectiveViewStart] - xPositions[clipS - effectiveViewStart]) + stepX}
              height={innerHeight}
              fill="#60a5fa"
              opacity="0.14"
            />
            <line
              x1={xPositions[clipS - effectiveViewStart]}
              x2={xPositions[clipS - effectiveViewStart]}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#60a5fa"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <line
              x1={xPositions[clipE - effectiveViewStart]}
              x2={xPositions[clipE - effectiveViewStart]}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#60a5fa"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
          </>
        )}

        {/* candles (viewport only) */}
        {Array.from({ length: effectiveViewCount }, (_, vi) => {
          const gi = effectiveViewStart + vi;
          const close = closeSeries[gi];
          const open = openFull[gi];
          const high = highsFull[gi];
          const low = lowsFull[gi];

          const isUp = close >= open;
          const color = isUp ? '#22c55e' : '#ef4444';
          const x = xPositions[vi];

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
          const candleWidth = stepX * 0.6;

          return (
            <g key={gi}>
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

        {/* PNL box */}
        {pnlBox && (
          <>
            {(() => {
              const x = clamp(pnlBox.midX - boxW / 2, paddingX, width - paddingX - boxW);
              const y = paddingY + 6;

              const pctText = `${pnlBox.pct >= 0 ? '+' : ''}${pnlBox.pct.toFixed(2)}%`;
              const usdText = pnlBox.pnlUsd == null ? null : `${Math.abs(pnlBox.pnlUsd).toFixed(4)} USDT`;

              
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
                    {usdText && (
                      <tspan fill={pnlBox.pct >= 0 ? '#22c55e' : '#ef4444'}>{`  •  ${usdText}`}</tspan>
                    )}
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