import { supaRoma } from './supabaseRoma'

// Універсальні турніри (нові таблиці tournaments / tournament_volume /
// tournament_volume_history). Пише туди тільки бекенд-поллер. Читаємо тут для /live.
// Наявний okx_campaigns-шар (okxApi.js) НЕ чіпаємо — це паралельна модель.

function one(v) {
  return Array.isArray(v) ? v[0] || null : v || null
}

// Активні турніри + поточний обсяг. У DEV показуємо всі (щоб бачити pending до
// апруву); у проді — лише approved (апрув-гейт: сигнал у TG → кнопка «На сайт»).
export async function fetchTournaments() {
  let q = supaRoma
    .from('tournaments')
    .select(
      'id, venue, market, kind, mechanic, coin_symbol, coin_icon, title, page_url, reward_pool, reward_currency, fee_per_1k, start_at, end_at, status, approved, config, ' +
        'tournament_volume(total_volume, min_rank_volume, participants, token_price_usd, updated_at)'
    )
  if (!import.meta.env.DEV) q = q.eq('approved', true)
  const { data, error } = await q.order('end_at', { ascending: true })
  if (error) throw error
  return (data || []).map((t) => ({ ...t, vol: one(t.tournament_volume) }))
}

export async function fetchTournamentHistory(tournamentId, limit = 400) {
  const { data, error } = await supaRoma
    .from('tournament_volume_history')
    .select('total_volume, min_rank_volume, observed_at')
    .eq('tournament_id', tournamentId)
    .order('observed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).reverse()
}

export function subscribeTournamentVolume(onRow) {
  return supaRoma
    .channel(`tournament-volume-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tournament_volume' },
      (payload) => {
        if (payload.new && payload.new.tournament_id != null) onRow(payload.new)
      }
    )
    .subscribe()
}
