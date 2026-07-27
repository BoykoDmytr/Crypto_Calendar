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
      'id, venue, market, kind, mechanic, external_id, coin_symbol, coin_icon, title, page_url, reward_pool, reward_currency, fee_per_1k, fee_auto, fee_auto_lo, fee_auto_hi, fee_auto_note, fee_auto_at, start_at, end_at, status, approved, config, ' +
        'tournament_volume(total_volume, min_rank_volume, participants, token_price_usd, extra, updated_at)'
    )
  if (!import.meta.env.DEV) q = q.eq('approved', true)
  const { data, error } = await q.order('end_at', { ascending: true })
  if (error) throw error
  return (data || []).map((t) => ({ ...t, vol: one(t.tournament_volume) }))
}

export async function fetchTournamentHistory(tournamentId, limit = 3000) {
  const { data, error } = await supaRoma
    .from('tournament_volume_history')
    .select('total_volume, min_rank_volume, observed_at')
    .eq('tournament_id', tournamentId)
    .order('observed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).reverse()
}

// Денні снепшоти к-сті учасників (найсвіжіший на турнір) — для приросту «+N».
export async function fetchParticipantSnapshots() {
  const { data, error } = await supaRoma
    .from('tournament_participants_daily')
    .select('tournament_id, snap_date, participants')
    .order('snap_date', { ascending: false })
  if (error) throw error
  const latest = {} // tournament_id → {snap_date, participants} (перший = найсвіжіший)
  for (const r of data || []) if (!(r.tournament_id in latest)) latest[r.tournament_id] = r
  return latest
}

// Історія авто-комси турніру (для «сер. комса за 24г до кінця» на завершених).
export async function fetchTournamentFeeHistory(tournamentId, limit = 200) {
  const { data, error } = await supaRoma
    .from('tournament_fee_history')
    .select('fee_auto, observed_at')
    .eq('tournament_id', tournamentId)
    .order('observed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).reverse()
}

// OKX-турніри зі старої моделі (okx_campaigns: flash-earn + спот) → нормалізуємо у
// форму картки, щоб показати у вкладці «Турніри» разом з новими. Стару пайплайн НЕ
// чіпаємо — лише читаємо. status беремо РЕАЛЬНИЙ (не хардкод) → фронт `state()` сам
// покладе живі в «Актуальні», завершені в «Завершені».
function normalizeOkx(c) {
  const isFlash = /\/flash-earn\//i.test(c.page_url || '')
  const v = one(c.okx_volume)
  return {
    id: `okx-${c.id}`,
    okxId: c.id,
    _raw: { ...c, okx_volume: v }, // сирий okx_campaigns для повного VIP-калькулятора (CEX)
    venue: 'okx',
    market: 'cex',
    kind: isFlash ? 'flash' : 'spot',
    mechanic: 'pool-share',
    coin_symbol: c.coin_symbol,
    coin_icon: c.coin_icon,
    title: c.name,
    page_url: c.page_url,
    reward_pool: c.share_pool ?? c.prize_pool ?? c.coin_amount ?? null,
    reward_currency: c.prize_currency || 'USDT',
    fee_per_1k: null,
    start_at: c.start_at,
    end_at: c.end_at,
    status: c.status || 'active', // РЕАЛЬНИЙ статус (active/ended) — а не хардкод 'ended'
    approved: true,
    vol: v ? { total_volume: v.total_volume, participants: v.participants, min_rank_volume: null, token_price_usd: v.token_price_usd, updated_at: v.updated_at } : null,
  }
}

const OKX_SEL = '*, okx_volume(total_volume, raw_volume, participants, currency, updated_at, token_price_usd)'

// АКТИВНІ okx_campaigns (flash-earn як AEON + спот) — щоб живі показувались у «Актуальні».
// Раніше фронт тягнув лише ended → нові flash-earn не зʼявлялись (RE/DATA/SLX завершились
// ще до нового UI, тож AEON перший це виявив).
export async function fetchOkxActiveAsTournaments() {
  const { data, error } = await supaRoma
    .from('okx_campaigns')
    .select(OKX_SEL)
    .eq('status', 'active')
    .eq('watch', true)
    .order('end_at', { ascending: true })
  if (error) throw error
  return (data || []).map(normalizeOkx)
}

export async function fetchOkxEndedAsTournaments() {
  const { data, error } = await supaRoma
    .from('okx_campaigns')
    .select(OKX_SEL)
    .eq('status', 'ended')
    .order('end_at', { ascending: false })
  if (error) throw error
  return (data || []).map(normalizeOkx)
}

// Історія завершеного OKX-турніру (стара таблиця okx_volume_history) — для графіка.
export async function fetchOkxHistory(campaignId, limit = 3000) {
  const { data, error } = await supaRoma
    .from('okx_volume_history')
    .select('total_volume, observed_at')
    .eq('campaign_id', campaignId)
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
