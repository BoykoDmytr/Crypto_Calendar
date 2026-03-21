import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import ReactionChart from './ReactionChart';
import ProfitCalculator from './ProfitCalculator';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_MAP = { Kyiv: 'Europe/Kyiv' };

function formatMcapPercent(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const abs = Math.abs(n);

  if (abs > 0 && abs < 0.0001) return '<0.0001%';
  if (abs >= 1) return `${n.toFixed(2)}%`;
  if (abs >= 0.1) return `${n.toFixed(3)}%`;
  if (abs >= 0.01) return `${n.toFixed(4)}%`;

  return `${n.toFixed(6).replace(/\.?0+$/, '')}%`;
}

function formatBigUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;

  return n.toFixed(2);
}

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const abs = Math.abs(n);

  if (abs >= 1000) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  if (abs >= 0.01) return n.toFixed(6);

  return n.toFixed(8).replace(/\.?0+$/, '');
}

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
    eventUsdValue,
    mcapUsd,
    priceSnap,
    mcapSnap,
  } = item;

  const hasSeries = Array.isArray(seriesClose) && seriesClose.length >= 31;
  const baseIndex = hasSeries ? seriesClose.length - 31 : 0;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needRotateHint, setNeedRotateHint] = useState(false);
  const chartFsRef = useRef(null);

  const [range, setRange] = useState(null);
  const [investment, setInvestment] = useState(100);
  const [direction, setDirection] = useState('short');
  const [showProfit, setShowProfit] = useState(false);

  const handleRangeSelect = ({ startIdx, endIdx }) => {
    if (endIdx == null) setRange({ startIdx, endIdx: null });
    else setRange({ startIdx, endIdx });
  };

  const startOffset = range && range.endIdx != null ? range.startIdx - baseIndex : null;
  const endOffset = range && range.endIdx != null ? range.endIdx - baseIndex : null;

  const seriesSnapshotPrice = useMemo(() => {
    if (!hasSeries) return null;
    const idx = baseIndex;
    const val = seriesClose?.[idx];
    return Number.isFinite(Number(val)) ? Number(val) : null;
  }, [hasSeries, baseIndex, seriesClose]);

  const resolvedPriceSnap = useMemo(() => {
    const dbSnap = Number(priceSnap);
    if (Number.isFinite(dbSnap)) return dbSnap;
    return seriesSnapshotPrice;
  }, [priceSnap, seriesSnapshotPrice]);

  const resolvedMcapSnap = useMemo(() => {
    const dbSnap = Number(mcapSnap);
    if (Number.isFinite(dbSnap)) return dbSnap;

    const legacyMcap = Number(mcapUsd);
    if (Number.isFinite(legacyMcap)) return legacyMcap;

    return null;
  }, [mcapSnap, mcapUsd]);

  const resolvedEventPctMcap = useMemo(() => {
    const dbPct = Number(eventPctMcap);
    if (Number.isFinite(dbPct)) return dbPct;

    const evUsd = Number(eventUsdValue);
    if (Number.isFinite(evUsd) && Number.isFinite(resolvedMcapSnap) && resolvedMcapSnap > 0) {
      return (evUsd / resolvedMcapSnap) * 100;
    }

    return null;
  }, [eventPctMcap, eventUsdValue, resolvedMcapSnap]);

  const selectionMeta = useMemo(() => {
    if (!hasSeries || range?.endIdx == null) return null;

    const startIdx = Math.min(range.startIdx, range.endIdx);
    const endIdx = Math.max(range.startIdx, range.endIdx);

    const entryPrice = seriesClose?.[startIdx];
    const exitPrice = seriesClose?.[endIdx];

    if (!Number.isFinite(Number(entryPrice)) || !Number.isFinite(Number(exitPrice))) {
      return null;
    }

    let timeText = `${Math.abs(endIdx - startIdx)}m`;

    if (startAt) {
      const zone = TZ_MAP[tz] || tz || 'UTC';
      const base = dayjs.utc(startAt).tz(zone);
      const t1 = base.add(startIdx - baseIndex, 'minute').format('HH:mm');
      const t2 = base.add(endIdx - baseIndex, 'minute').format('HH:mm');
      timeText = `${t1} → ${t2}`;
    }

    return {
      timeText,
      entryText: `Entry: ${Number(entryPrice).toFixed(6)} → Exit: ${Number(exitPrice).toFixed(6)}`,
    };
  }, [hasSeries, range, seriesClose, startAt, tz, baseIndex]);

  const pnlSummary = useMemo(() => {
    if (!hasSeries || range?.endIdx == null) return null;

    const startIdx = Math.min(range.startIdx, range.endIdx);
    const endIdx = Math.max(range.startIdx, range.endIdx);

    const entryPrice = seriesClose?.[startIdx];
    const exitPrice = seriesClose?.[endIdx];
    const inv = Number(investment);

    if (
      !Number.isFinite(Number(entryPrice)) ||
      !Number.isFinite(Number(exitPrice)) ||
      !Number.isFinite(inv) ||
      inv <= 0
    ) {
      return null;
    }

    const qty = inv / entryPrice;
    const pnl =
      direction === 'long'
        ? qty * (exitPrice - entryPrice)
        : qty * (entryPrice - exitPrice);

    const pnlPct = inv ? (pnl / inv) * 100 : null;

    return { pnl, pnlPct };
  }, [hasSeries, range, seriesClose, investment, direction]);

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
          setNeedRotateHint(true);
        }
      } else {
        setNeedRotateHint(true);
      }
    } catch {
      setNeedRotateHint(true);
    }
  };

  const exitFullscreen = async () => {
    try {
      if (screen.orientation?.unlock) {
        try {
          screen.orientation.unlock();
        } catch {
          // ignore
        }
      }

      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const summaryColor =
    pnlSummary == null
      ? 'text-white/55'
      : pnlSummary.pnl > 0
      ? 'text-emerald-400'
      : pnlSummary.pnl < 0
      ? 'text-red-400'
      : 'text-amber-400';

  return (
    <article className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white/90 px-4 py-5 text-slate-900 shadow-xl backdrop-blur-sm dark:border-slate-800 dark:bg-gradient-to-br dark:from-[#0b0f1a] dark:via-[#0f172a] dark:to-[#0b111f] dark:text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_20%_10%,rgba(34,197,94,0.12),transparent_35%),radial-gradient(circle_at_80%_0,rgba(14,165,233,0.1),transparent_30%)]"
        aria-hidden
      />

      <div className="relative mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-emerald-800 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200">
          Completed
        </span>

        <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-gray-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
          {type || 'Event'}
        </span>
      </div>

      <div className="relative mb-4 flex flex-col gap-1">
        <h3 className="line-clamp-2 break-words text-lg font-semibold leading-snug">{title}</h3>

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="whitespace-nowrap">{formatDate(startAt, tz)}</span>
          {(pair || coinName) && (
            <span className="text-gray-500 dark:text-gray-300">
              · {pair ? `${pair} MEXC` : coinName}
            </span>
          )}
        </div>

        {(resolvedPriceSnap != null ||
          eventUsdValue != null ||
          resolvedEventPctMcap != null ||
          resolvedMcapSnap != null) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            {eventUsdValue != null && (
              <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200">
                Event $ {formatBigUsd(eventUsdValue)}
              </span>
            )}

            {resolvedEventPctMcap != null && (
              <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-200">
                {formatMcapPercent(resolvedEventPctMcap)} of MCAP
              </span>
            )}

            {resolvedMcapSnap != null && (
              <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                MCAP {formatBigUsd(resolvedMcapSnap)}
              </span>
            )}

            {resolvedPriceSnap != null && (
              <span className="rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-200">
                Price $ {formatPrice(resolvedPriceSnap)}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        ref={chartFsRef}
        className={`relative ${
          isFullscreen ? 'flex h-screen w-screen items-center justify-center bg-[#020617] p-2 sm:p-4' : ''
        }`}
      >
        <div
          className={`relative border border-gray-100 bg-gradient-to-b from-gray-50 via-white to-white shadow-sm backdrop-blur-sm dark:border-white/5 dark:from-white/10 dark:via-white/5 dark:to-white/0 ${
            isFullscreen
              ? 'mb-0 h-full w-full max-h-[900px] max-w-[1600px] overflow-hidden rounded-2xl'
              : 'mb-2 overflow-x-auto rounded-2xl md:overflow-x-hidden'
          }`}
        >
          {hasSeries && (
            <button
              type="button"
              onClick={enterFullscreen}
              className="absolute right-3 top-3 z-10 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white backdrop-blur hover:bg-black/55 md:hidden"
            >
              ⤢ Fullscreen
            </button>
          )}

          {isFullscreen && (
            <button
              type="button"
              onClick={exitFullscreen}
              className="absolute left-3 top-3 z-10 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white backdrop-blur hover:bg-black/55 md:hidden"
            >
              ✕
            </button>
          )}

          {needRotateHint && isFullscreen && (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white md:hidden">
              Поверни телефон горизонтально ↻
            </div>
          )}

          <div className="p-4 md:flex md:justify-center">
            {hasSeries ? (
              <ReactionChart
                closeSeries={seriesClose}
                highSeries={
                  Array.isArray(seriesHigh) && seriesHigh.length === seriesClose.length
                    ? seriesHigh
                    : null
                }
                lowSeries={
                  Array.isArray(seriesLow) && seriesLow.length === seriesClose.length
                    ? seriesLow
                    : null
                }
                onRangeSelect={handleRangeSelect}
                selectedRange={range}
                startAt={startAt}
                timezone={tz}
                isFullscreen={isFullscreen}
              />
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Немає серії ±30m (ще не пораховано або івент занадто свіжий).
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-[22px] px-1 text-[11px] text-white/55 sm:text-xs">
        {selectionMeta && (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center">
            <span>{selectionMeta.timeText}</span>
            <span className="text-white/45">{selectionMeta.entryText}</span>
          </div>
        )}
      </div>

      {hasSeries && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-[#111931]/70 p-1 shadow-[0_8px_22px_rgba(10,16,38,0.25)]">
              <button
                type="button"
                onClick={() => setDirection('short')}
                className={`min-w-[76px] rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  direction === 'short'
                    ? 'bg-red-500 text-white shadow-[0_6px_16px_rgba(239,68,68,0.35)]'
                    : 'text-white/80 hover:bg-white/5'
                }`}
              >
                Short
              </button>

              <button
                type="button"
                onClick={() => setDirection('long')}
                className={`min-w-[76px] rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  direction === 'long'
                    ? 'bg-emerald-500 text-white shadow-[0_6px_16px_rgba(16,185,129,0.35)]'
                    : 'text-white/80 hover:bg-white/5'
                }`}
              >
                Long
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowProfit((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111931]/70 px-4 py-3 text-sm font-medium text-white/85 shadow-[0_8px_22px_rgba(10,16,38,0.25)] transition hover:bg-white/10"
            >
              <span>Profit</span>
              <span className="text-white/50">{showProfit ? '▲' : '›'}</span>
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-white/10 bg-[#0f1730]/60 px-4 py-3 text-sm shadow-[0_8px_22px_rgba(10,16,38,0.2)]">
            {pnlSummary ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-white/80">
                  PnL{' '}
                  <span className={`font-semibold ${summaryColor}`}>
                    {pnlSummary.pnlPct >= 0 ? '+' : ''}
                    {pnlSummary.pnlPct.toFixed(2)}%
                  </span>
                </div>
                <div className={`font-semibold ${summaryColor}`}>
                  {pnlSummary.pnl >= 0 ? '+' : ''}
                  {pnlSummary.pnl.toFixed(4)} USDT
                </div>
              </div>
            ) : (
              <div className="text-white/55">
                Оберіть дві свічки на графіку, щоб порахувати прибуток.
              </div>
            )}
          </div>

          {showProfit && (
            <ProfitCalculator
              closeSeries={seriesClose}
              startOffset={startOffset}
              endOffset={endOffset}
              baseIndex={baseIndex}
              investment={investment}
              onInvestmentChange={setInvestment}
              direction={direction}
            />
          )}
        </>
      )}
    </article>
  );
}