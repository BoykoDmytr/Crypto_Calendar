import { supaRoma } from './supabaseRoma'

// Вкладка /earn — креатор-кампанії (пости/стріми за нагороди).
// Пише туди promo-radar бот (кнопка «На сайт»); тут лише читання.
// RLS: анонім бачить тільки status='published'; адмін-сесія — все.

export async function fetchCreatorCampaigns({ all = false } = {}) {
  let q = supaRoma
    .from('site_creator_campaigns')
    .select('*')
    .order('ends_at', { ascending: true, nullsFirst: false })
  if (!all) q = q.eq('status', 'published')
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Лічильники постів із трекера (є лише в кампаній, де налаштований збір).
export async function fetchCampaignStats() {
  const { data, error } = await supaRoma
    .from('site_creator_campaign_stats')
    .select('cp_campaign_id, posts_observed, unique_authors, posts_last_60_min, last_synced')
  if (error) throw error
  const by = {}
  for (const r of data || []) by[r.cp_campaign_id] = r
  return by
}

export async function updateCampaign(id, patch) {
  const { error } = await supaRoma
    .from('site_creator_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function adminSignIn(email, password) {
  const { data, error } = await supaRoma.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function adminSession() {
  const { data } = await supaRoma.auth.getSession()
  return data.session
}

export async function adminSignOut() {
  await supaRoma.auth.signOut()
}
