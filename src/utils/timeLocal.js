// src/utils/timeLocal.js
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = "Europe/Kyiv";

/**
 * Перетворює ISO в рядок для <input type="date|datetime-local"> у вибраній TZ.
 * @param {string} iso   UTC ISO з БД
 * @param {"UTC"|"Kyiv"} tz  часовa зона події
 * @param {"date"|"datetime"} mode
 */
export function toLocalInput(iso, tz = "UTC", mode = "datetime") {
  if (!iso) return "";
  const d = dayjs.utc(iso);
  const local = tz === "Kyiv" ? d.tz(KYIV_TZ) : d; // для UTC залишаємо як є
  return mode === "date"
    ? local.format("YYYY-MM-DD")
    : local.format("YYYY-MM-DDTHH:mm");
}
