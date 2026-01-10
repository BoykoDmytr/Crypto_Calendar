/* eslint-env node */
/* global process */

// This cron script automatically removes old events from the database.
//
// It is intended to be executed on a scheduled basis via Vercel Cron
// (see `vercel.json`). The job looks up all approved events where
// the start date is more than a configurable number of days in the past
// (45 by default) and permanently deletes them along with any
// associated records such as price reactions, exclusions and pending
// edits. Removing old events helps keep the calendar lean and
// prevents stale data from cluttering the UI and statistics.

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);

export default async function handler(req, res) {
  try {
    // optional simple auth – provide DELETE_OLD_EVENTS_SECRET in env or a query parameter
    const envSecret = process.env.DELETE_OLD_EVENTS_SECRET;
    const providedSecret = req?.query?.secret || req.headers?.authorization?.replace(/^Bearer /, "");
    if (envSecret && providedSecret !== envSecret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // determine the cutoff date – events starting before this will be removed
    const DAYS_TO_KEEP = Number(process.env.EVENT_RETENTION_DAYS || "45");
    const threshold = dayjs.utc().subtract(DAYS_TO_KEEP, "day").toISOString();

    // fetch all approved events older than the threshold
    const { data: oldEvents, error: fetchErr } = await supabase
      .from("events_approved")
      .select("id")
      .lt("start_at", threshold);

    if (fetchErr) {
      return res.status(500).json({ ok: false, error: fetchErr.message, where: "events_approved select" });
    }

    let deleted = 0;
    for (const ev of oldEvents || []) {
      const id = ev.id;
      // delete related exclusions
      const { error: exclErr } = await supabase
        .from("event_price_reaction_exclusions")
        .delete()
        .eq("event_id", id);
      if (exclErr) {
        return res.status(500).json({ ok: false, error: exclErr.message, where: "exclusions delete", id });
      }
      // delete related price reactions
      const { error: reactErr } = await supabase
        .from("event_price_reaction")
        .delete()
        .eq("event_id", id);
      if (reactErr) {
        return res.status(500).json({ ok: false, error: reactErr.message, where: "price reaction delete", id });
      }
      // delete pending edits referencing this event
      const { error: editsErr } = await supabase
        .from("event_edits_pending")
        .delete()
        .eq("event_id", id);
      if (editsErr) {
        return res.status(500).json({ ok: false, error: editsErr.message, where: "pending edits delete", id });
      }
      // finally delete the event itself
      const { error: delErr } = await supabase
        .from("events_approved")
        .delete()
        .eq("id", id);
      if (delErr) {
        return res.status(500).json({ ok: false, error: delErr.message, where: "event delete", id });
      }
      deleted += 1;
    }

    // optionally prune pending events older than the threshold
    // some pending events may have never been approved; remove them too
    const tablesToPrune = ["events_pending", "auto_events_pending"];
    let pendingDeleted = 0;
    for (const table of tablesToPrune) {
      const { data: rows, error: pendingFetchErr } = await supabase
        .from(table)
        .select("id")
        .lt("start_at", threshold);
      if (!pendingFetchErr) {
        for (const row of rows || []) {
          const { error: pendDelErr } = await supabase.from(table).delete().eq("id", row.id);
          if (pendDelErr) {
            return res.status(500).json({ ok: false, error: pendDelErr.message, where: `${table} delete`, id: row.id });
          }
          pendingDeleted += 1;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      deletedApproved: deleted,
      deletedPending: pendingDeleted,
      cutoff: threshold,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}