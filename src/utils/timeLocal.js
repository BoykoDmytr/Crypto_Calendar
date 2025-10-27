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
 * @param {"date"|"datetime"|"time"} mode
 */
export function toLocalInput(value, tz = "UTC", mode = "datetime") {
  if (!value) return "";

  const str = String(value).trim();
  const hasExplicitZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(str);

  if (!hasExplicitZone) {
    // Значення вже у локальному форматі (без часової зони).
    if (mode === "date") return str.slice(0, 10);
    if (mode === "time") {
      if (str.length === 5 && str.includes(":")) return str;
      if (str.includes("T")) return str.split("T")[1].slice(0, 5);
      const match = str.match(/\d{2}:\d{2}/);
      return match ? match[0] : "";
    }
    if (str.includes("T")) return str.slice(0, 16);
    return str.replace(" ", "T").slice(0, 16);
  }

  const d = dayjs.utc(str);
  const local = tz === "Kyiv" ? d.tz(KYIV_TZ) : d; // для UTC залишаємо як є
  if (mode === "date") return local.format("YYYY-MM-DD");
  if (mode === "time") return local.format("HH:mm");
  return local.format("YYYY-MM-DDTHH:mm");
}
