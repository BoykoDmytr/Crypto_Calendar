// src/utils/statsCalc.js
// Stats calculation for V1 (user-selected setup) and V2 (ideal historical setup)

/**
 * Median helper
 */
function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Get same-type historical events (excluding current)
 */
function getSameTypeEvents(allItems, currentEventId, eventType, eventTypeSlug) {
  return allItems.filter((item) => {
    if (item.eventId === currentEventId) return false;
    // Match by slug first, then by type name
    if (eventTypeSlug && item.eventTypeSlug === eventTypeSlug) return true;
    if (eventType && item.type === eventType) return true;
    return false;
  });
}

/**
 * V1 — базова версія Stats
 *
 * Бере offsets, які вибрав користувач (entry_offset_min, exit_offset_min),
 * і перевіряє, як такий самий сетап працював на попередніх same-type events.
 *
 * @param {Object} params
 * @param {Array} params.allItems - всі завершені івенти
 * @param {string} params.currentEventId
 * @param {string} params.eventType - тип івенту (людська назва)
 * @param {string} params.eventTypeSlug
 * @param {'short'|'long'} params.side
 * @param {number} params.entryOffsetMin - зміщення entry від T0 (в хвилинах)
 * @param {number} params.exitOffsetMin - зміщення exit від T0 (в хвилинах)
 * @param {number} [params.feeBuffer=0.1] - мінімальний pnl% для "worked"
 * @returns {Object|null}
 */
export function computeV1Stats({
  allItems,
  currentEventId,
  eventType,
  eventTypeSlug,
  side,
  entryOffsetMin,
  exitOffsetMin,
  feeBuffer = 0.1,
}) {
  if (entryOffsetMin == null || exitOffsetMin == null) return null;
  if (exitOffsetMin <= entryOffsetMin) return null;

  const sameType = getSameTypeEvents(allItems, currentEventId, eventType, eventTypeSlug);
  if (!sameType.length) return null;

  const pnlValues = [];

  for (const item of sameType) {
    const series = item.seriesClose;
    if (!Array.isArray(series) || series.length < 31) continue;

    // event_idx = індекс T0 всередині series_close
    const eventIdx = series.length - 31;

    const entryIdx = eventIdx + entryOffsetMin;
    const exitIdx = eventIdx + exitOffsetMin;

    // Edge case: індекси поза межами масиву
    if (entryIdx < 0 || entryIdx >= series.length) continue;
    if (exitIdx < 0 || exitIdx >= series.length) continue;

    const entryPrice = series[entryIdx];
    const exitPrice = series[exitIdx];

    // Edge case: series_close null
    if (entryPrice == null || exitPrice == null) continue;
    if (!Number.isFinite(Number(entryPrice)) || !Number.isFinite(Number(exitPrice))) continue;
    if (Number(entryPrice) <= 0) continue;

    let pnlPct;
    if (side === 'short') {
      pnlPct = ((entryPrice - exitPrice) / entryPrice) * 100;
    } else {
      pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    }

    pnlValues.push(pnlPct);
  }

  if (pnlValues.length === 0) return null;

  const workedCount = pnlValues.filter((p) => p > feeBuffer).length;
  const medianPnl = median(pnlValues);

  return {
    side,
    sampleSize: pnlValues.length,
    workedCount,
    medianPnl,
    eventType: eventType || eventTypeSlug || 'Unknown',
    isSmallSample: pnlValues.length < 5,
  };
}

/**
 * V2 — ідеальний історичний сетап через екстремуми
 *
 * Використовує max_price/max_offset/min_price/min_offset
 * для визначення ідеального ретроспективного сценарію.
 *
 * @param {Object} params
 * @param {Array} params.allItems
 * @param {string} params.currentEventId
 * @param {string} params.eventType
 * @param {string} params.eventTypeSlug
 * @param {'short'|'long'} params.side
 * @returns {Object|null}
 */
export function computeV2Stats({
  allItems,
  currentEventId,
  eventType,
  eventTypeSlug,
  side,
}) {
  const sameType = getSameTypeEvents(allItems, currentEventId, eventType, eventTypeSlug);
  if (!sameType.length) return null;

  const validCases = [];

  for (const item of sameType) {
    const { maxPrice, maxOffset, minPrice, minOffset } = item;

    // Edge case: null values
    if (maxPrice == null || minPrice == null || maxOffset == null || minOffset == null) continue;
    if (!Number.isFinite(Number(maxPrice)) || !Number.isFinite(Number(minPrice))) continue;

    if (side === 'short') {
      // Short валідний, коли максимум був раніше мінімуму
      if (maxOffset >= minOffset) continue;
      if (Number(maxPrice) <= 0) continue;

      const pnl = ((maxPrice - minPrice) / maxPrice) * 100;
      validCases.push({
        entryOffset: maxOffset,
        exitOffset: minOffset,
        pnl,
      });
    } else {
      // Long валідний, коли мінімум був раніше максимуму
      if (minOffset >= maxOffset) continue;
      if (Number(minPrice) <= 0) continue;

      const pnl = ((maxPrice - minPrice) / minPrice) * 100;
      validCases.push({
        entryOffset: minOffset,
        exitOffset: maxOffset,
        pnl,
      });
    }
  }

  if (validCases.length === 0) return null;

  return {
    side,
    sampleSize: sameType.length,
    validCount: validCases.length,
    medianEntryOffset: median(validCases.map((c) => c.entryOffset)),
    medianExitOffset: median(validCases.map((c) => c.exitOffset)),
    medianPnl: median(validCases.map((c) => c.pnl)),
    isSmallSample: validCases.length < 5,
  };
}

/**
 * Format offset to human-readable text
 * < 0 → "X хв до івенту"
 * > 0 → "X хв після івенту"
 * 0 → "в момент івенту"
 */
export function formatOffset(offset) {
  if (offset == null) return '—';
  const rounded = Math.round(offset);
  if (rounded === 0) return 'в момент івенту';
  if (rounded < 0) return `${Math.abs(rounded)} хв до івенту`;
  return `${rounded} хв після івенту`;
}