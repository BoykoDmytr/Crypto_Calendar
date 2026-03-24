// src/components/StatsPanel.jsx
import React, { useMemo } from 'react';
import { computeV1Stats, computeV2Stats, formatOffset } from '../utils/statsCalc';

function formatPnl(value) {
  if (value == null) return '—';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function pnlColor(value) {
  if (value == null) return 'text-white/55';
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-amber-400';
}

/**
 * StatsPanel — показує V1 (базову статистику сетапу) та V2 (ідеальний історичний сетап)
 *
 * Props:
 *   allItems          — всі завершені івенти зі Stats page
 *   currentEventId    — ID поточного івенту
 *   eventType         — тип івенту (людська назва)
 *   eventTypeSlug     — slug типу
 *   side              — 'short' | 'long'
 *   entryOffsetMin    — зміщення entry відносно T0 (хвилини)
 *   exitOffsetMin     — зміщення exit відносно T0 (хвилини)
 */
export default function StatsPanel({
  allItems = [],
  currentEventId,
  eventType,
  eventTypeSlug,
  side = 'short',
  entryOffsetMin,
  exitOffsetMin,
}) {
  const v1 = useMemo(() => {
    return computeV1Stats({
      allItems,
      currentEventId,
      eventType,
      eventTypeSlug,
      side,
      entryOffsetMin,
      exitOffsetMin,
    });
  }, [allItems, currentEventId, eventType, eventTypeSlug, side, entryOffsetMin, exitOffsetMin]);

  const v2 = useMemo(() => {
    return computeV2Stats({
      allItems,
      currentEventId,
      eventType,
      eventTypeSlug,
      side,
    });
  }, [allItems, currentEventId, eventType, eventTypeSlug, side]);

  const hasAny = v1 || v2;

  if (!hasAny) {
    return (
      <div className="mt-4 rounded-2xl border border-white/10 bg-[#0f1730]/60 px-4 py-4 text-sm text-white/55 shadow-[0_8px_22px_rgba(10,16,38,0.2)]">
        Недостатньо історичних даних для аналізу цього типу івентів.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {/* ═══ V1: Базова статистика ═══ */}
      {v1 && (
        <div className="rounded-2xl border border-indigo-200/50 bg-gradient-to-br from-[#161d3d] via-[#101735] to-[#0b1127] p-4 text-white shadow-[0_10px_30px_rgba(10,16,38,0.35)] dark:border-white/10">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300/80">
              Ваш сетап
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
              {side === 'short' ? 'Short' : 'Long'}
            </span>
          </div>

          {v1.isSmallSample && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠️ Мала вибірка (менше 5 кейсів) — результати можуть бути ненадійними
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/45">Спрацювало</div>
              <div className="mt-1 text-lg font-bold text-white">
                {v1.workedCount}/{v1.sampleSize}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/45">Типовий результат</div>
              <div className={`mt-1 text-lg font-bold ${pnlColor(v1.medianPnl)}`}>
                {formatPnl(v1.medianPnl)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/45">Вибірка</div>
              <div className="mt-1 text-sm text-white/70">
                останні {v1.sampleSize} {v1.eventType}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ V2: Ідеальний історичний сетап ═══ */}
      {v2 && (
        <div className="rounded-2xl border border-cyan-200/30 bg-gradient-to-br from-[#0d1a2d] via-[#0e1528] to-[#091020] p-4 text-white shadow-[0_10px_30px_rgba(10,16,38,0.35)] dark:border-white/10">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-300/80">
              Ідеальний історичний {side === 'short' ? 'short' : 'long'} setup
            </span>
          </div>

          {v2.isSmallSample && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠️ Мала вибірка (менше 5 валідних кейсів)
            </div>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-white/55">Вхід:</span>
              <span className="font-medium text-white/90">{formatOffset(v2.medianEntryOffset)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/55">Закриття:</span>
              <span className="font-medium text-white/90">{formatOffset(v2.medianExitOffset)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/55">Спрацювало:</span>
              <span className="font-medium text-white/90">{v2.validCount}/{v2.sampleSize}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/55">Типовий результат:</span>
              <span className={`font-bold ${pnlColor(v2.medianPnl)}`}>
                {formatPnl(v2.medianPnl)}
              </span>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-white/35 italic">
            * Ретроспективний benchmark, не гарантовано repeatable strategy
          </div>
        </div>
      )}
    </div>
  );
}