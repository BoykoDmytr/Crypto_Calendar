import { supaRoma } from './supabaseRoma'

// OKX Tournaments — read layer поверх romasya06 (okx_campaigns / okx_volume /
// okx_volume_history / fee_tiers). Пише туди тільки headless-поллер бекенду.

// PostgREST може віддати embed як обʼєкт (o2o) або масив — нормалізуємо.
function one(v) {
  return Array.isArray(v) ? v[0] || null : v || null
}

export async function fetchOkxCampaigns() {
  let q = supaRoma
    .from('okx_campaigns')
    .select('*, okx_volume(total_volume, raw_volume, currency, participants, updated_at, token_price_usd)')
  // DEV-режим (локалка): показуємо і watch=false — для розробки нових турнірів
  // (DATA/RE flash-earn) без появи їх на проді. НЕ ПУШИТИ без узгодження.
  if (!import.meta.env.DEV) q = q.eq('watch', true) // приховані/паузовані турніри (watch=false) не показуємо
  const { data, error } = await q.order('end_at', { ascending: true })
  if (error) throw error
  return (data || []).map((c) => ({ ...c, okx_volume: one(c.okx_volume) }))
}

// limit 300 ≈ 24 год історії при кроці ~5 хв — треба для дельти «за 1 день».
// (Sparkline показує лише хвіст, дельти рахуються з повної глибини.)
export async function fetchVolumeHistory(campaignId, limit = 300) {
  const { data, error } = await supaRoma
    .from('okx_volume_history')
    .select('total_volume, raw_volume, observed_at')
    .eq('campaign_id', campaignId)
    .order('observed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).reverse()
}

// Спотові fee-групи OKX (значення = відсотки: 0.08 => 0.08%). Знято з okx.com/ua/fees
// 2026-07-10. MAKER однаковий у всіх групах (Regular…VIP6); різниця лише в TAKER на
// VIP4-6 — дрібніші монети мають меншу знижку. Групу монети визначає `groupId` з
// публічного instruments-API: 12=Група1(мейджори BTC/ETH), 13=Група2, 14=Група3.
// УСІ trade-to-earn турнірні токени = Група 2 (TAO/CARDS/NES/MON/RE/DATA/SLX —
// перевірено, groupId=13), тому дефолт калькуляторів = група 2.
export const FEE_TIERS_BY_GROUP = {
  1: [
    { level: 'Regular', maker_pct: 0.08, taker_pct: 0.1 },
    { level: 'VIP1', maker_pct: 0.0675, taker_pct: 0.08 },
    { level: 'VIP2', maker_pct: 0.06, taker_pct: 0.07 },
    { level: 'VIP3', maker_pct: 0.055, taker_pct: 0.065 },
    { level: 'VIP4', maker_pct: 0.03, taker_pct: 0.045 },
    { level: 'VIP5', maker_pct: 0.025, taker_pct: 0.035 },
    { level: 'VIP6', maker_pct: 0, taker_pct: 0.03 },
  ],
  2: [
    { level: 'Regular', maker_pct: 0.08, taker_pct: 0.1 },
    { level: 'VIP1', maker_pct: 0.0675, taker_pct: 0.08 },
    { level: 'VIP2', maker_pct: 0.06, taker_pct: 0.07 },
    { level: 'VIP3', maker_pct: 0.055, taker_pct: 0.065 },
    { level: 'VIP4', maker_pct: 0.03, taker_pct: 0.05 },
    { level: 'VIP5', maker_pct: 0.025, taker_pct: 0.045 },
    { level: 'VIP6', maker_pct: 0, taker_pct: 0.04 },
  ],
  3: [
    { level: 'Regular', maker_pct: 0.08, taker_pct: 0.1 },
    { level: 'VIP1', maker_pct: 0.0675, taker_pct: 0.08 },
    { level: 'VIP2', maker_pct: 0.06, taker_pct: 0.07 },
    { level: 'VIP3', maker_pct: 0.055, taker_pct: 0.065 },
    { level: 'VIP4', maker_pct: 0.03, taker_pct: 0.055 },
    { level: 'VIP5', maker_pct: 0.025, taker_pct: 0.05 },
    { level: 'VIP6', maker_pct: 0, taker_pct: 0.045 },
  ],
}
// Дефолт = група 2 (турнірні токени). Якщо у кампанії є fee_group — беремо його.
export const feeTiersForGroup = (g) => FEE_TIERS_BY_GROUP[Number(g)] || FEE_TIERS_BY_GROUP[2]

// Фолбек-псевдонім (Група 1 = стандарт) для старого коду.
export const FEE_TIERS_FALLBACK = FEE_TIERS_BY_GROUP[1]

export async function fetchFeeTiers() {
  try {
    const { data, error } = await supaRoma
      .from('fee_tiers')
      .select('level, maker_pct, taker_pct, requirement, sort_order')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data && data.length ? data : FEE_TIERS_FALLBACK
  } catch {
    return FEE_TIERS_FALLBACK
  }
}

// Live-оновлення обсягу без рефрешу. Повертає channel — прибрати через
// supaRoma.removeChannel(channel) у cleanup.
// Topic унікальний на кожен виклик: client.channel() дедуплікує по topic і при
// ремаунті (HMR / швидка навігація) повернув би той самий канал у стані
// 'leaving', на якому subscribe() — мовчазний no-op → realtime тихо вмирає.
export function subscribeOkxVolume(onRow) {
  return supaRoma
    .channel(`okx-volume-live-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'okx_volume' },
      (payload) => {
        if (payload.new && payload.new.campaign_id != null) onRow(payload.new)
      },
    )
    .subscribe()
}
