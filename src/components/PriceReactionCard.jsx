import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Register dayjs plugins for UTC and timezones.  This ensures that
// formatting functions work properly regardless of the user's locale.
dayjs.extend(utc);
dayjs.extend(timezone);

// Mapping for common timezone labels.  You can extend this if your
// application uses additional labels beyond Kyiv/UTC.
const TZ_MAP = {
  Kyiv: 'Europe/Kyiv',
};

// Format a timestamp into HH:mm in the given timezone.  If no
// timestamp is provided, returns an em dash.
function formatTime(iso, tz) {
  if (!iso) return '—';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('HH:mm');
}

// Format a timestamp into DD MMM HH:mm in the given timezone.  If no
// timestamp is provided, returns an empty string.
function formatDate(iso, tz) {
  if (!iso) return '';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('DD MMM HH:mm');
}

// Assign a CSS class for percentage display based on value.  Positive
// values are green, negatives red, zero yellow, missing values gray.
function percentClass(value) {
  if (value === null || value === undefined) return 'text-gray-400';
  if (value > 0) return 'text-emerald-500';
  if (value < 0) return 'text-red-500';
  return 'text-amber-500';
}

// Format percent for display.  Adds a plus sign for positive values and
// returns an em dash for missing values.
function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const rounded = Number(numeric.toFixed(5));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized}%`;
}

// Format price for display.  Returns an em dash for missing values.
function formatPrice(price) {
  if (price === null || price === undefined) return '—';
  return Number(price);
}

// Determine overall trend of a price series: up, down or flat.  Used to
// display a summary label on the card.
function deriveTrend(prices) {
  if (prices.length < 2) return 'unknown';
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

// Given a trend, return a color string (tailwind palette values) for
// use as a stroke or background.
function chartColor(trend) {
  if (trend === 'up') return '#22c55e'; // emerald-500
  if (trend === 'down') return '#ef4444'; // red-500
  if (trend === 'flat') return '#f59e0b'; // amber-500
  return '#9ca3af'; // gray-400
}

/**
 * Build segments for a two‑segment sparkline with color coding.
 * Each segment gets a colour depending on whether the price goes up,
 * down or stays flat.  This allows the sparkline to show direction
 * changes clearly.  The returned array is consumed by the svg
 * renderer below.
 *
 * @param {number[]} prices Array of prices (numbers).
 * @param {number} width    Width of the SVG canvas.
 * @param {number} height   Height of the SVG canvas.
 * @returns {Array<{points: string, color: string}>}
 */
function buildColoredSegments(prices, width = 240, height = 64, paddingY = 12) {
  const segments = [];
  const points = [];
  if (prices.length < 2) return { segments, points };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const innerHeight = Math.max(height - paddingY * 2, 1);
  const step = width / (prices.length - 1);
  const coords = prices.map((price, idx) => {
    const x = idx * step;
    const normalized = (price - min) / range;
    const y = paddingY + (1 - normalized) * innerHeight;
    return { x, y };
  });
  for (let i = 0; i < coords.length - 1; i++) {
    const { x: x1, y: y1 } = coords[i];
    const { x: x2, y: y2 } = coords[i + 1];
    const delta = prices[i + 1] - prices[i];
    let color;
    if (delta > 0) color = '#22c55e';
    else if (delta < 0) color = '#ef4444';
    else color = '#f59e0b';
    segments.push({ points: `${x1},${y1} ${x2},${y2}`, color });
  }
  return { segments, points: coords };
}

function calcOverallChange(base, next) {
  if (base == null || next == null) return null;
  const b = Number(base);
  const n = Number(next);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b === 0) return null;
  return ((n - b) / b) * 100;
}

function formatDeltaLabel(value) {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const rounded = Number(numeric.toFixed(2));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(2)}%`;
}

export default function PriceReactionCard({ item }) {
  const { title, startAt, type, priceReaction, coinName, timezone, pair } = item;
  // Extract numeric price points for the sparkline
  const pricePoints = priceReaction
    .filter((entry) => entry.price !== null && entry.price !== undefined)
    .map((entry) => Number(entry.price));
  const trend = deriveTrend(pricePoints);
  const sparkWidth = 260;
  const sparkHeight = 120;
  const sparkPaddingY = 26;
  const { segments: coloredSegments, points } = buildColoredSegments(pricePoints, sparkWidth, sparkHeight, sparkPaddingY);
  const overallChange =
    pricePoints.length >= 2 ? calcOverallChange(pricePoints[0], pricePoints[pricePoints.length - 1]) : null;
  const basePrice = pricePoints[0];

  const timelineLabels = priceReaction.map((entry) => entry.label || '').filter(Boolean);
  const tickCount = Math.max(timelineLabels.length - 1, 1);
  const tickSpacing = sparkWidth / tickCount;

  const horizontalGuides = [0.33, 0.66];


  const deltaLabels = pricePoints
    .slice(0, -1)
    .map((base, idx) => {
      const next = pricePoints[idx + 1];
      const change = calcOverallChange(base, next);
      const label = formatDeltaLabel(change);
      if (!label) return null;

      const pointA = points[idx];
      const pointB = points[idx + 1];
      const dx = (pointB?.x ?? 0) - (pointA?.x ?? 0);
      const dy = (pointB?.y ?? 0) - (pointA?.y ?? 0);
      const length = Math.hypot(dx, dy) || 1;
      const normX = dx / length;
      const normY = dy / length;
      const perpX = -normY;
      const perpY = normX;
      const offset = change >= 0 ? 12 : 16;
      const x = (pointB?.x ?? 0) - normX * 4 + perpX * (change >= 0 ? -offset : offset);
      const y = (pointB?.y ?? 0) - normY * 4 + perpY * (change >= 0 ? -offset : offset);
      const color = chartColor(change > 0 ? 'up' : change < 0 ? 'down' : 'flat');

      return {
        label,
        x,
        y,
        color,
      };
    })
    .filter(Boolean);


  const lastPoint = points[points.length - 1];
  const changeLabelX = lastPoint ? Math.min(Math.max(lastPoint.x - 32, 6), sparkWidth - 64) : 0;
  const changeLabelY = lastPoint ? Math.min(Math.max(lastPoint.y - 36, 6), sparkHeight - 28) : 6;

  return (
    <article className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-[#0b0f1a] via-[#0f172a] to-[#0b111f] px-4 py-5 text-white shadow-2xl">
      <div
        className="pointer-events-none absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_20%_10%,rgba(34,197,94,0.14),transparent_35%),radial-gradient(circle_at_80%_0,rgba(14,165,233,0.12),transparent_30%)]"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center gap-2 text-[11px] font-semibold mb-3">
        <span className="rounded-full bg-emerald-500/15 text-emerald-200 px-2.5 py-1 border border-emerald-500/30">Completed</span>
        <span className="rounded-full bg-white/5 text-gray-200 px-2.5 py-1 border border-white/10">{type || 'Binance Tournaments'}</span>
        {pair && <span className="truncate text-gray-300 max-w-full sm:max-w-none">{pair}</span>}
      </div>

      <div className="relative flex flex-col gap-1 mb-4">
        <h3 className="font-semibold text-lg leading-snug line-clamp-2 break-words">{title}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide">UTC</span>
          <span className="whitespace-nowrap">{formatDate(startAt, timezone)}</span>
          {coinName && <span className="text-gray-300">· {coinName}</span>}
        </div>
      </div>

      <div className="relative rounded-2xl border border-white/5 bg-white/5 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 text-xs text-gray-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="uppercase tracking-wide text-[11px] text-gray-400">Price reaction</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 border border-white/10 text-[11px] shadow-sm">T0 → T+15m</span>
            {basePrice !== undefined && <span className="text-gray-400">base: {formatPrice(basePrice)} USDT</span>}
          </div>
          {overallChange !== null && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm"
              style={{
                backgroundColor: `${chartColor(trend)}26`,
                color: chartColor(trend),
              }}
            >
              {overallChange > 0 && '▲'}
              {overallChange === 0 && '▬'}
              {overallChange < 0 && '▼'}
              {formatPercent(overallChange)}
            </span>
            )}
        </div>
        <div className="px-4 pb-4 pt-2 bg-gradient-to-b from-white/5 via-white/[0.02] to-transparent">
          <div className="relative">
            <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} className="w-full h-36">
              <defs>
                <linearGradient id="sparklineFill" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#0b0f1a" stopOpacity="0" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="100%" height="100%" rx="12" fill="url(#sparklineFill)" opacity="0.35" />
              {horizontalGuides.map((ratio) => {
                const y = sparkPaddingY + ratio * (sparkHeight - sparkPaddingY * 2);
                return <line key={`h-${ratio}`} x1="8" x2={sparkWidth - 8} y1={y} y2={y} stroke="#ffffff22" strokeWidth="1" strokeDasharray="6 10" />;
              })}
              {Array.from({ length: tickCount + 1 }).map((_, idx) => {
                const x = Math.min(idx * tickSpacing, sparkWidth);
                return <line key={`v-${idx}`} x1={x} x2={x} y1={12} y2={sparkHeight - 12} stroke="#ffffff14" strokeWidth="1" />;
              })}
              {coloredSegments.map((seg, idx) => (
                <polyline key={idx} fill="none" stroke={seg.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={seg.points} />
              ))}
              {points.map((pt, idx) => (
                <g key={idx}>
                  <circle cx={pt.x} cy={pt.y} r="4.25" fill="#0b0f1a" stroke="#0ea5e9" strokeWidth="1.5" />
                  <circle cx={pt.x} cy={pt.y} r="2.25" fill="#22c55e" />
                </g>
              ))}
              {deltaLabels.map((delta, idx) => {
                const textWidth = Math.max(38, delta.label.length * 6 + 12);
                const textHeight = 18;
                const clampedX = Math.min(Math.max(delta.x - textWidth / 2, 4), sparkWidth - textWidth - 4);
                const clampedY = Math.min(Math.max(delta.y - textHeight / 2, 2), sparkHeight - textHeight - 2);

                return (
                  <g key={idx}>
                    <rect x={clampedX} y={clampedY} width={textWidth} height={textHeight} rx="8" ry="8" fill={`${delta.color}1f`} stroke={delta.color} strokeWidth="1" />
                    <text x={clampedX + textWidth / 2} y={clampedY + textHeight / 2 + 3} textAnchor="middle" fill={delta.color} fontSize="10" fontWeight="700">
                      {delta.label}
                    </text>
                  </g>
                );
              })}
              {overallChange !== null && lastPoint && (
                <g transform={`translate(${changeLabelX},${changeLabelY})`}>

                </g>
              )}
            </svg>

            {timelineLabels.length > 0 && (
              <div className="mt-2 grid text-[11px] text-gray-400" style={{ gridTemplateColumns: `repeat(${timelineLabels.length}, minmax(0, 1fr))` }}>
                {timelineLabels.map((label) => (
                  <span key={label} className="text-center font-semibold tracking-wide">
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
         </div>

        <div className="divide-y divide-white/5 bg-[#0d1425]/70">
          {priceReaction.map((entry) => (
            <div
              key={entry.label}
              className="grid grid-cols-[70px,1fr] sm:grid-cols-[70px,1fr,90px] items-center gap-3 px-4 py-3 text-xs sm:text-sm text-gray-100"
            >
              <div className="flex items-center gap-2">
                <span className="w-16 rounded-full bg-white/5 px-2 py-1 text-center text-[11px] uppercase tracking-wide text-gray-200 border border-white/10">
                  {entry.label}
                </span>
              </div>
               <div className="flex flex-wrap items-center gap-3">
                <span className="w-14 font-mono text-[11px] sm:text-xs text-gray-400">{formatTime(entry.time, timezone)}</span>
                <span className="text-white font-semibold break-words">{formatPrice(entry.price)}</span>
                <span className={`sm:hidden ml-auto font-semibold ${percentClass(entry.percent)}`}>
                  {formatPercent(entry.percent)}
                </span>
              </div>
              <div className={`hidden sm:block text-right font-semibold ${percentClass(entry.percent)}`}>
                {formatPercent(entry.percent)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}