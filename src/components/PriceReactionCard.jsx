import React from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import ReactionChart from './ReactionChart';
import ProfitCalculator from './ProfitCalculator';

// Register dayjs plugins for UTC and timezones.
dayjs.extend(utc);
dayjs.extend(timezone);

// Mapping for common timezone labels.
const TZ_MAP = {
  Kyiv: 'Europe/Kyiv',
};

// Format a timestamp into DD MMM HH:mm in the given timezone.
function formatDate(iso, tz) {
  if (!iso) return '';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('DD MMM HH:mm');
}

// Assign a CSS class for percentage display based on value.
function percentClass(value) {
  if (value === null || value === undefined) return 'text-gray-400';
  if (value > 0) return 'text-emerald-500';
  if (value < 0) return 'text-red-500';
  return 'text-amber-500';
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

/**
 * PriceReactionCard (updated)
 *
 * Expects item to include fields from the new ±30m reaction backend:
 * - seriesClose: number[61] (close prices, offsets -30..+30; index 30 = T0)
 * - seriesHigh:  number[61] (optional)
 * - seriesLow:   number[61] (optional)
 * - preReturn30m, postReturn30m, netReturn60m
 * - maxPrice, maxOffset, minPrice, minOffset
 * - eventPctMcap (optional)
 */
export default function PriceReactionCard({ item }) {
  const {
    title,
    startAt,
    type,
    coinName,
    timezone: tz,
    pair,
    seriesClose,
    seriesHigh,
    seriesLow,
    preReturn30m,
    postReturn30m,
    netReturn60m,
    maxPrice,
    maxOffset,
    minPrice,
    minOffset,
    eventPctMcap,
  } = item;

  const hasSeries = Array.isArray(seriesClose) && seriesClose.length === 61;

  return (
    <article className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white/90 px-4 py-5 text-slate-900 shadow-xl backdrop-blur-sm dark:border-slate-800 dark:bg-gradient-to-br dark:from-[#0b0f1a] dark:via-[#0f172a] dark:to-[#0b111f] dark:text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_20%_10%,rgba(34,197,94,0.12),transparent_35%),radial-gradient(circle_at_80%_0,rgba(14,165,233,0.1),transparent_30%)]"
        aria-hidden
      />

      {/* Header chips */}
      <div className="relative flex flex-wrap items-center gap-2 text-[11px] font-semibold mb-3">
        <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 border border-emerald-200 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30">
          Completed
        </span>

        <span className="rounded-full bg-gray-100 text-gray-700 px-2.5 py-1 border border-gray-200 shadow-sm dark:bg-white/5 dark:text-gray-200 dark:border-white/10">
          {type || 'Event'}
        </span>

        {pair && (
          <span className="truncate text-gray-600 max-w-full sm:max-w-none dark:text-gray-300">
            {pair}
          </span>
        )}
      </div>

      {/* Title + meta */}
      <div className="relative flex flex-col gap-1 mb-4">
        <h3 className="font-semibold text-lg leading-snug line-clamp-2 break-words">{title}</h3>

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[11px] uppercase tracking-wide dark:bg-white/5 dark:border-white/10">
            UTC
          </span>

          <span className="whitespace-nowrap">{formatDate(startAt, tz)}</span>

          {coinName && <span className="text-gray-500 dark:text-gray-300">· {coinName}</span>}
        </div>
      </div>

      {/* Reaction Curve block */}
      <div className="relative rounded-2xl border border-gray-100 bg-gradient-to-b from-gray-50 via-white to-white shadow-sm backdrop-blur-sm overflow-hidden dark:border-white/5 dark:from-white/10 dark:via-white/5 dark:to-white/0 mb-4">
        <div className="p-4">
          {hasSeries ? (
            <>
              <ReactionChart
                closeSeries={seriesClose}
                highSeries={Array.isArray(seriesHigh) && seriesHigh.length === 61 ? seriesHigh : null}
                lowSeries={Array.isArray(seriesLow) && seriesLow.length === 61 ? seriesLow : null}
              />

              {/* KPI row */}
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-center">
                <div>
                  <span className="block text-gray-500 dark:text-gray-400">Pre −30→0m</span>
                  <span className={`font-semibold ${percentClass(preReturn30m)}`}>
                    {formatPercent(preReturn30m)}
                  </span>
                </div>

                <div>
                  <span className="block text-gray-500 dark:text-gray-400">Post 0→+30m</span>
                  <span className={`font-semibold ${percentClass(postReturn30m)}`}>
                    {formatPercent(postReturn30m)}
                  </span>
                </div>

                <div>
                  <span className="block text-gray-500 dark:text-gray-400">Net −30→+30m</span>
                  <span className={`font-semibold ${percentClass(netReturn60m)}`}>
                    {formatPercent(netReturn60m)}
                  </span>
                </div>
              </div>

              {/* MAX/MIN row */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-600 dark:text-gray-300">
                {maxPrice != null && (
                  <div className="flex flex-col">
                    <span className="uppercase tracking-wide text-[10px]">MAX</span>
                    <span className="font-semibold">
                      {Number(maxPrice).toFixed(6)} ({maxOffset > 0 ? '+' : ''}{maxOffset}m)
                    </span>
                  </div>
                )}

                {minPrice != null && (
                  <div className="flex flex-col">
                    <span className="uppercase tracking-wide text-[10px]">MIN</span>
                    <span className="font-semibold">
                      {Number(minPrice).toFixed(6)} ({minOffset > 0 ? '+' : ''}{minOffset}m)
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Немає серії ±30m (ще не пораховано або івент занадто свіжий).
            </div>
          )}
        </div>
      </div>

      {/* % of MCap */}
      {eventPctMcap != null && (
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
          % of MCap: {Number(eventPctMcap).toFixed(2)}%
        </div>
      )}

      {/* Profit Calculator */}
      {hasSeries && <ProfitCalculator closeSeries={seriesClose} />}
    </article>
  );
}
