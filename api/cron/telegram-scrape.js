/* eslint-env node */
/* global process */
import { createClient } from "@supabase/supabase-js";

function parseChannels(envVal) {
  return (envVal || "")
    .split(",")
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean);
}

// дуже простий (але робочий) парсинг t.me/s/...
function decodeHtml(s) {
  return (s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractPosts(html, expectedChannel) {
  // Беремо кожен message-блок по data-post="channel/id"
  // і далі шукаємо найближчий message text та time datetime в межах цього блоку.
  const posts = [];

  const reBlock = /data-post="([^"]+?)\/(\d+)"[\s\S]*?<\/article>/g; // на t.me/s часто все в <article>
  let m;

  while ((m = reBlock.exec(html)) !== null) {
    const channel = m[1];
    const id = Number(m[2]);
    const block = m[0];

    if (expectedChannel && channel !== expectedChannel) continue;

    // текст (у Telegram часто: tgme_widget_message_text js-message_text)
    const textMatch =
      /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);

    // datetime (часто в <time datetime="...">)
    const timeMatch = /<time[^>]+datetime="([^"]+)"/.exec(block);

    const text = decodeHtml(textMatch ? textMatch[1] : "");
    const datetime = timeMatch ? timeMatch[1] : null;

    // Якщо нема тексту (інколи пости тільки з картинкою) — пропускаємо
    if (!text) continue;

    posts.push({
      channel,
      id,
      text,
      datetime,
      link: `https://t.me/${channel}/${id}`,
    });
  }

  // fallback: якщо <article> не підходить — пробуємо по wrap div
  if (!posts.length) {
    const reWrap = /data-post="([^"]+?)\/(\d+)"[\s\S]*?class="tgme_widget_message_footer"/g;
    let w;
    while ((w = reWrap.exec(html)) !== null) {
      const channel = w[1];
      const id = Number(w[2]);
      const block = w[0];
      if (expectedChannel && channel !== expectedChannel) continue;

      const textMatch =
        /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
      const timeMatch = /<time[^>]+datetime="([^"]+)"/.exec(block);

      const text = decodeHtml(textMatch ? textMatch[1] : "");
      const datetime = timeMatch ? timeMatch[1] : null;
      if (!text) continue;

      posts.push({
        channel,
        id,
        text,
        datetime,
        link: `https://t.me/${channel}/${id}`,
      });
    }
  }

  return posts;
}


function guessEventFromText(text) {
  // мінімальна евристика: якщо є дата/час — ставимо її, інакше null (модератор поправить)
  // можеш розширити під свої формати постів.
  return {
    title: text.split("\n")[0]?.slice(0, 140) || "Telegram event",
    description: text.slice(0, 4000),
    start_at: null,
    type: "Airdrop",
  };
}

export default async function handler(req, res) {
  // (опційно) захист: Vercel може слати Authorization: Bearer CRON_SECRET
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).send("Unauthorized");
    }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const channels = parseChannels(process.env.TG_CHANNELS);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }
  if (!channels.length) {
    return res.status(200).json({ ok: true, message: "No TG_CHANNELS provided" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const summary = [];

  for (const channel of channels) {
    // читаємо last_msg_id
    const { data: stateRow, error: stErr } = await supabase
      .from("tg_scrape_state")
      .select("last_msg_id")
      .eq("channel", channel)
      .maybeSingle();

    if (stErr) {
      return res.status(500).json({ error: stErr.message, where: "tg_scrape_state select" });
    }

    const lastMsgId = stateRow?.last_msg_id ?? 0;

    // тягнемо сторінку
    const url = `https://t.me/s/${channel}`;
    const page = await fetch(url, {
      headers: {
        // інколи допомагає з блоками/403
        "user-agent": "Mozilla/5.0 (cron)",
      },
    });

    if (!page.ok) {
      summary.push({ channel, ok: false, status: page.status });
      continue;
    }

    const html = await page.text();
    const dataPostCount = (html.match(/data-post="/g) || []).length;
    const hasWidgetText = html.includes("tgme_widget_message_text");
    const posts = extractPosts(html, channel)

      .filter((p) => p.channel === channel)
      .sort((a, b) => a.id - b.id);

    const newPosts = posts.filter((p) => p.id > lastMsgId);

    let inserted = 0;
    let skipped = 0;
    let maxSeen = lastMsgId;

    for (const p of newPosts) {
      if (p.id > maxSeen) maxSeen = p.id;

      const event = guessEventFromText(p.text);

      // анти-дублікат: по link
      const { data: exists, error: exErr } = await supabase
        .from("auto_events_pending")
        .select("id")
        .eq("link", p.link)
        .limit(1);

      if (exErr) {
        return res.status(500).json({ error: exErr.message, where: "auto_events_pending select" });
      }

      if (exists?.length) {
        skipped++;
        continue;
      }

      const payload = {
        title: event.title,
        description: event.description,
        start_at: event.start_at ?? p.datetime ?? null,
        timezone: "Kyiv",
        type: event.type,
        link: p.link,
        // можеш додати coin_name / coins якщо витягнеш з тексту
      };

      const { error: insErr } = await supabase.from("auto_events_pending").insert(payload);
      if (insErr) {
        return res.status(500).json({ error: insErr.message, where: "auto_events_pending insert" });
      }
      inserted++;
    }

    // оновлюємо state
    if (maxSeen > lastMsgId) {
      const { error: upErr } = await supabase
        .from("tg_scrape_state")
        .upsert({ channel, last_msg_id: maxSeen, updated_at: new Date().toISOString() });

      if (upErr) {
        return res.status(500).json({ error: upErr.message, where: "tg_scrape_state upsert" });
      }
    }

    summary.push({ channel, lastMsgId, dataPostCount, hasWidgetText, new: newPosts.length, inserted, skipped, maxSeen });
  }

  return res.status(200).json({ ok: true, summary });
}
