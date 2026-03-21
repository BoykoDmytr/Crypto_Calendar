/* eslint-env node */
/* global process */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);

// Ці типи ЗБЕРІГАЄМО, все інше старе — видаляємо
const KEEP_EVENT_TYPE_NAMES = [
  "Claim",
  "Binance Tournaments",
  "Booster",
  "TS Bybit",
  "Unlocks",
  "OKX Alpha",
];

const KEEP_EVENT_TYPE_SLUGS = [
  "claim",
  "binance-tournaments",
  "booster",
  "ts-bybit",
  "unlocks",
  "okx-alpha",
];

export default async function handler(req, res) {
  try {
    const envSecret = process.env.DELETE_OLD_EVENTS_SECRET;
    const providedSecret =
      req?.query?.secret ||
      req.headers?.authorization?.replace(/^Bearer /, "");

    if (envSecret && providedSecret !== envSecret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const DAYS_TO_KEEP = Number(process.env.EVENT_RETENTION_DAYS || "45");
    const threshold = dayjs.utc().subtract(DAYS_TO_KEEP, "day").toISOString();

    const { data: allOldEvents, error: fetchErr } = await supabase
      .from("events_approved")
      .select("id, event_type_slug, type")
      .lt("start_at", threshold);

    if (fetchErr) {
      return res.status(500).json({
        ok: false,
        error: fetchErr.message,
        where: "events_approved select",
      });
    }

    // Видаляємо всі старі івенти, КРІМ цих 6 типів
    const targetEvents = (allOldEvents || []).filter((ev) => {
      const slug = String(ev.event_type_slug || "").trim().toLowerCase();
      const type = String(ev.type || "").trim();

      const shouldKeep =
        KEEP_EVENT_TYPE_SLUGS.includes(slug) ||
        KEEP_EVENT_TYPE_NAMES.includes(type);

      return !shouldKeep;
    });

    let deleted = 0;

    for (const ev of targetEvents) {
      const id = ev.id;

      const { error: exclErr } = await supabase
        .from("event_price_reaction_exclusions")
        .delete()
        .eq("event_id", id);

      if (exclErr) {
        return res.status(500).json({
          ok: false,
          error: exclErr.message,
          where: "exclusions delete",
          id,
        });
      }

      const { error: reactErr } = await supabase
        .from("event_price_reaction")
        .delete()
        .eq("event_id", id);

      if (reactErr) {
        return res.status(500).json({
          ok: false,
          error: reactErr.message,
          where: "price reaction delete",
          id,
        });
      }

      const { error: editsErr } = await supabase
        .from("event_edits_pending")
        .delete()
        .eq("event_id", id);

      if (editsErr) {
        return res.status(500).json({
          ok: false,
          error: editsErr.message,
          where: "pending edits delete",
          id,
        });
      }

      const { error: delErr } = await supabase
        .from("events_approved")
        .delete()
        .eq("id", id);

      if (delErr) {
        return res.status(500).json({
          ok: false,
          error: delErr.message,
          where: "event delete",
          id,
        });
      }

      deleted += 1;
    }

    const tablesToPrune = ["events_pending", "auto_events_pending"];
    let pendingDeleted = 0;

    for (const table of tablesToPrune) {
      const { data: rows, error: pendingFetchErr } = await supabase
        .from(table)
        .select("id, event_type_slug, type")
        .lt("start_at", threshold);

      if (!pendingFetchErr) {
        const targets = (rows || []).filter((row) => {
          const slug = String(row.event_type_slug || "").trim().toLowerCase();
          const type = String(row.type || "").trim();

          const shouldKeep =
            KEEP_EVENT_TYPE_SLUGS.includes(slug) ||
            KEEP_EVENT_TYPE_NAMES.includes(type);

          return !shouldKeep;
        });

        for (const row of targets) {
          const { error: pendDelErr } = await supabase
            .from(table)
            .delete()
            .eq("id", row.id);

          if (pendDelErr) {
            return res.status(500).json({
              ok: false,
              error: pendDelErr.message,
              where: `${table} delete`,
              id: row.id,
            });
          }

          pendingDeleted += 1;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      deletedApproved: deleted,
      deletedPending: pendingDeleted,
      keptSlugs: KEEP_EVENT_TYPE_SLUGS,
      cutoff: threshold,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}