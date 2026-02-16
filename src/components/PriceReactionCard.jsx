import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import ReactionChart from './ReactionChart';
import ProfitCalculator from './ProfitCalculator';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_MAP = { Kyiv: 'Europe/Kyiv' };

function formatDate(iso, tz) {
  if (!iso) return '';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('DD MMM HH:mm');
}

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
    eventPctMcap,
  } = item;

  const hasSeries = Array.isArray(seriesClose) && seriesClose.length === 61;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needRotateHint, setNeedRotateHint] = useState(false);
  const chartFsRef = useRef(null);

  const [range, setRange] = useState(null);

  // ✅ investment shared between chart tooltip and ProfitCalculator
  const [investment, setInvestment] = useState(100);

  const handleRangeSelect = ({ startIdx, endIdx }) => {
    if (endIdx == null) setRange({ startIdx, endIdx: null });
    else setRange({ startIdx, endIdx });
  };

  const startOffset = range && range.endIdx != null ? range.startIdx - 30 : null;
  const endOffset = range && range.endIdx != null ? range.endIdx - 30 : null;

  useEffect(() => {
    const onFs = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (!active) setNeedRotateHint(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const enterFullscreen = async () => {
    try {
      const el = chartFsRef.current;
      if (!el) return;

      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else {
        setNeedRotateHint(true);
        return;
      }

      if (screen.orientation?.lock) {
        try {
          await screen.orientation.lock('landscape');
        } catch {
          void 0;
          setNeedRotateHint(true);
        }
      } else {
        setNeedRotateHint(true);
      }
    } catch {
      void 0;
      setNeedRotateHint(true);
    }
  };

  const exitFullscreen = async () => {
    try {
      if (screen.orientation?.unlock) {
        try {
          screen.orientation.unlock();
        } catch {
          void 0;
        }
      }
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      void 0;
    }
  };

  return (
    <article className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white/90 px-4 py-5 text-slate-900 shadow-xl backdrop-blur-sm dark:border-slate-800 dark:bg-gradient-to-br dark:from-[#0b0f1a] dark:via-[#0f172a] dark:to-[#0b111f] dark:text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_20%_10%,rgba(34,197,94,0.12),transparent_35%),radial-gradient(circle_at_80%_0,rgba(14,165,233,0.1),transparent_30%)]"
        aria-hidden
      />

      {/* Заголовки */}
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

      {/* Назва */}
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

      {/* Wrapper fullscreen */}
      <div ref={chartFsRef} className="relative">
        <div
          className="relative rounded-2xl border border-gray-100 bg-gradient-to-b from-gray-50 via-white to-white shadow-sm backdrop-blur-sm
                     overflow-x-auto md:overflow-x-hidden
                     dark:border-white/5 dark:from-white/10 dark:via-white/5 dark:to-white/0 mb-4"
        >
          {hasSeries && (
            <button
              type="button"
              onClick={enterFullscreen}
              className="md:hidden absolute right-3 top-3 z-10 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white backdrop-blur hover:bg-black/55"
            >
              ⤢ Fullscreen
            </button>
          )}

          {isFullscreen && (
            <button
              type="button"
              onClick={exitFullscreen}
              className="md:hidden absolute left-3 top-3 z-10 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white backdrop-blur hover:bg-black/55"
            >
              ✕
            </button>
          )}

          {needRotateHint && isFullscreen && (
            <div className="md:hidden absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-xl border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white">
              Поверни телефон горизонтально ↻
            </div>
          )}

          <div className="p-4 md:flex md:justify-center">
            {hasSeries ? (
              <ReactionChart
                closeSeries={seriesClose}
                highSeries={Array.isArray(seriesHigh) && seriesHigh.length === 61 ? seriesHigh : null}
                lowSeries={Array.isArray(seriesLow) && seriesLow.length === 61 ? seriesLow : null}
                onRangeSelect={handleRangeSelect}
                selectedRange={range}
                startAt={startAt}
                timezone={tz}
                investment={investment} // ✅
              />
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Немає серії ±30m (ще не пораховано або івент занадто свіжий).
              </div>
            )}
          </div>
        </div>
      </div>

      {eventPctMcap != null && (
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
          % of MCap: {Number(eventPctMcap).toFixed(2)}%
        </div>
      )}

      {hasSeries && (
        <ProfitCalculator
          closeSeries={seriesClose}
          startOffset={startOffset}
          endOffset={endOffset}
          investment={investment}
          onInvestmentChange={setInvestment}
        />
      )}
    </article>
  );
}
