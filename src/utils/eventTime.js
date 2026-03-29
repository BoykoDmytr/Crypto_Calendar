// src/utils/eventTime.js
// Центральна утиліта для роботи з часом івентів.
// Вся конвертація UTC ↔ локальний час івенту — ТІЛЬКИ тут.

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = 'Europe/Kyiv';

/**
 * Конвертує start_at (UTC ISO з БД) у dayjs-об'єкт
 * у часовій зоні ІВЕНТУ (а не браузера).
 *
 * Це вирішує головну проблему DST: коли переводять годинник,
 * dayjs(utcString) у браузері зсуває час, бо використовує
 * поточний UTC-offset браузера. А dayjs.utc(...).tz(zone)
 * завжди використовує правильний offset для конкретної дати.
 *
 * @param {string} isoUtc - ISO timestamp з БД (start_at / end_at)
 * @param {string} tz - часова зона івенту ('UTC' | 'Kyiv')
 * @returns {dayjs.Dayjs | null}
 */
export function toEventLocal(isoUtc, tz) {
  if (!isoUtc) return null;
  const d = dayjs.utc(isoUtc);
  if (!d.isValid()) return null;
  if (tz === 'Kyiv') return d.tz(KYIV_TZ);
  return d; // UTC — залишаємо як є (utc mode)
}

/**
 * Чи має івент вказаний час (не просто дата)?
 *
 * Перевіряє в часовій зоні ІВЕНТУ, а не браузера.
 * Якщо start_at = '2026-03-28T22:00:00Z' і tz = 'Kyiv',
 * то в Kyiv це 00:00 → час НЕ вказано (тільки дата).
 *
 * Це фіксить баг коли після DST 00:00 UTC+2 стає 01:00 UTC+3
 * і система думає що час вказано.
 */
export function eventHasTime(isoUtc, tz) {
  const local = toEventLocal(isoUtc, tz);
  if (!local) return false;
  return local.hour() !== 0 || local.minute() !== 0;
}

/**
 * Форматує дату/час івенту для відображення.
 * Завжди використовує часову зону ІВЕНТУ.
 *
 * @param {string} isoUtc
 * @param {string} tz - 'UTC' | 'Kyiv'
 * @param {boolean} forceTime - завжди показувати час (навіть 00:00)
 * @returns {string}
 */
export function formatEventDateTime(isoUtc, tz, forceTime = false) {
  const local = toEventLocal(isoUtc, tz);
  if (!local) return '';
  const hasTime = forceTime || eventHasTime(isoUtc, tz);
  return local.format(hasTime ? 'DD MMM HH:mm' : 'DD MMM');
}

/**
 * Повертає дату івенту (YYYY-MM-DD) у часовій зоні ІВЕНТУ.
 * Для групування по датах у Calendar.
 */
export function eventDateKey(isoUtc, tz) {
  const local = toEventLocal(isoUtc, tz);
  if (!local) return '';
  return local.format('YYYY-MM-DD');
}

/**
 * Повертає день місяця (число) у TZ івенту.
 */
export function eventDay(isoUtc, tz) {
  const local = toEventLocal(isoUtc, tz);
  if (!local) return '';
  return local.format('DD');
}

/**
 * Повертає день тижня (3 літери) у TZ івенту.
 */
export function eventWeekday(isoUtc, tz) {
  const local = toEventLocal(isoUtc, tz);
  if (!local) return '';
  return local.format('ddd');
}

export { KYIV_TZ };