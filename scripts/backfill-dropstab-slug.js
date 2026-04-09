/* eslint-env node */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resolveSlug(coinName) {
  const { data, error } = await supabase.functions.invoke('dropstab-circ', {
    body: { coinName },
  });
  if (error) return null;
  return data?.slug || null;
}

async function run() {
  const { data: events, error } = await supabase
    .from('events_approved')
    .select('id, coins, coin_name')
    .not('coins', 'is', null);

  if (error) throw error;

  let updated = 0;
  for (const ev of events || []) {
    let coinsArr;
    try {
      coinsArr = typeof ev.coins === 'string' ? JSON.parse(ev.coins) : ev.coins;
    } catch { continue; }
    if (!Array.isArray(coinsArr) || !coinsArr.length) continue;

    let changed = false;
    for (const c of coinsArr) {
      if (c?.dropstab_slug) continue;
      const name = c?.name || ev.coin_name;
      if (!name) continue;
      const slug = await resolveSlug(name);
      if (slug) {
        c.dropstab_slug = slug;
        changed = true;
        console.log(`OK ${name} -> ${slug}`);
      }
    }

    if (changed) {
      const { error: updErr } = await supabase
        .from('events_approved')
        .update({ coins: JSON.stringify(coinsArr) })
        .eq('id', ev.id);
      if (!updErr) updated++;
    }
  }
  console.log(`Done. Updated ${updated} events.`);
}

run().catch(console.error);
