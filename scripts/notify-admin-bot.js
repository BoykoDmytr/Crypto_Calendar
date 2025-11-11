import { createClient } from '@supabase/supabase-js';
// Import process explicitly so ESLint recognizes it in an ES module context.
import process from 'node:process';

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment');
  process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment');
  process.exit(1);
}

// Initialize Supabase client.  We disable persisted sessions because this is a
// server-side script.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

/**
 * Send a message via Telegram Bot API.
 *
 * @param {string} text - The message text to send.
 */
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error('Failed to send Telegram message:', json);
    }
  } catch (err) {
    console.error('Telegram message error:', err);
  }
}

/**
 * Format an event for the notification message.  Adjust this function to
 * include fields that are important for your moderators.
 *
 * @param {object} ev - The event record from Supabase.
 * @param {string} tableName - The table from which the record was inserted.
 * @returns {string}
 */
function formatEventMessage(ev, tableName) {
  const when = ev.start_at ?? 'N/A';
  const type = ev.type ?? '—';
  const source = tableName === 'events_pending' ? 'Автозаявка' : 'Заявка';
  return [
    `🆕 ${source}`,
    '',
    `Заголовок: ${ev.title || '—'}`,
    `Дата/час початку: ${when}`,
    `Тип: ${type}`,
    ev.link ? `Лінк: ${ev.link}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  console.log('Starting notification bot…');
  // Subscribe to INSERT events on events_pending and auto_events_pending tables
  supabase
    .channel('moderation_notifications')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'events_pending' },
      async (payload) => {
        const ev = payload.new;
        const message = formatEventMessage(ev, 'events_pending');
        await sendTelegramMessage(message);
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'auto_events_pending' },
      async (payload) => {
        const ev = payload.new;
        const message = formatEventMessage(ev, 'auto_events_pending');
        await sendTelegramMessage(message);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Subscribed to Supabase realtime changes');
      }
    });

  // Keep the process alive
  // In Node >=16, fetch is globally available.  To prevent the script from exiting,
  // we wait indefinitely.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});