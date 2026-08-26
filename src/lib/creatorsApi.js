import { supabase } from './supabase'

// Вкладка /creators — креатор-кампанії (пости/стріми за нагороди).
// Живуть у ОСНОВНІЙ базі сайту, тому працює той самий клієнт і та сама
// адмін-сесія, що й решта адмінки: жодних окремих логінів.
// Пише сюди promo-radar бот (кнопка «На сайт») сервісним ключем.
// Лічильники постів — звичайні колонки (колектор оновлює їх ззовні),
// бо таблиці трекера живуть в іншій базі і view між базами неможливий.

const COLUMNS =
  'id, exchange, platform, title, subtitle, steps, reward, reward_class, slots, url, ' +
  'hashtags, starts_at, ends_at, status, sort_order, cp_campaign_id, ' +
  'posts_observed, unique_authors, posts_last_60_min, stats_synced_at'

export async function fetchCreatorCampaigns({ all = false } = {}) {
  let q = supabase
    .from('site_creator_campaigns')
    .select(COLUMNS)
    .order('ends_at', { ascending: true, nullsFirst: false })
  if (!all) q = q.eq('status', 'published')
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function updateCampaign(id, patch) {
  const { error } = await supabase
    .from('site_creator_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCampaign(id) {
  const { error } = await supabase.from('site_creator_campaigns').delete().eq('id', id)
  if (error) throw error
}
