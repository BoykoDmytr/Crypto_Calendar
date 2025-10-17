// src/utils/time.js

/**
 * Converts a time string (HH:mm or HH:mm:ss) into minutes since the start of the day.
 * Returns +Infinity when the value cannot be parsed so it sorts last.
 * @param {string | undefined | null} value
 * @returns {number}
 */
export function timeStringToMinutes(value) {
  if (!value && value !== 0) return Number.POSITIVE_INFINITY;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

/**
 * Helper to compare two minute values that can be Infinity.
 * Finite values are always considered smaller than Infinity.
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
export function compareMinutes(left, right) {
  const leftFinite = Number.isFinite(left);
  const rightFinite = Number.isFinite(right);
  if (leftFinite && rightFinite) return left - right;
  if (leftFinite) return -1;
  if (rightFinite) return 1;
  return 0;
}