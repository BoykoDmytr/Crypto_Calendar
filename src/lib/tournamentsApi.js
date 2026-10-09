import { supaRoma } from './supabaseRoma'

// Універсальні турніри (нові таблиці tournaments / tournament_volume /
// tournament_volume_history). Пише туди тільки бекенд-поллер. Читаємо тут для /live.
// Наявний okx_campaigns-шар (okxApi.js) НЕ чіпаємо — це паралельна модель.

function one(v) {
  return Array.isArray(v) ? v[0] || null : v || null
}

// Стеля PostgREST: більше 1000 рядків за запит сервер не віддає, хоч проси 3000 (limit
// тихо ріжеться). Тож чесна стеля на серію — 1000: це ≥3 доби при кроці 5 хв (okx) і
// ≥6 діб при 10 хв (турніри) — з запасом для дельти «1 день».
const MAX_ROWS = 1000
// Довгий in.() змушує сервер віддати заголовок Content-Location, що переповнює буфер
// заголовків (undici: UND_ERR_HEADERS_OVERFLOW) → in() ріжемо пачками по 20.
const IN_CHUNK = 20

// Дедлайн на КОЖЕН запит. У supaRoma (і в supabase-js) таймауту fetch немає, а /live
// опитує себе сам і чекає попередній прохід: один завислий запит (мертве HTTP/2 після
// сну ноутбука чи зміни Wi-Fi, captive portal, вкладка в бекграунді на телефоні) тримав
// би прохід вічно — і сторінка більше не оновилась би до перезавантаження. Аборт
// postgrest-js повертає як { error }, тож запит просто падає, як будь-який інший збій.
const REQ_TIMEOUT_MS = 30_000
function deadline(q) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return q.abortSignal(AbortSignal.timeout(REQ_TIMEOUT_MS))
  const c = new AbortController() // старі Safari (<16) без AbortSignal.timeout
  setTimeout(() => c.abort(), REQ_TIMEOUT_MS)
  return q.abortSignal(c.signal)
}

// in() пачками по IN_CHUNK, у кожної пачки свій catch: збій однієї не гасить решту.
// checked — id із пачок, що відповіли: для них «рядка нема» означає, що його справді
// нема (сховали / не проходить фільтр), а не що запит упав.
async function inChunks(ids, fetchChunk) {
  const rows = []
  const checked = new Set()
  const chunks = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK))
  await Promise.all(
    chunks.map(async (chunk) => {
      const got = await fetchChunk(chunk).catch(() => null)
      if (!got) return
      rows.push(...got)
      for (const id of chunk) checked.add(id)
    })
  )
  return { rows, checked }
}

// Турніри + поточний обсяг. НОВИЙ турнір показуємо на /live ОДРАЗУ після виявлення
// (watch=true), не чекаючи кнопки «На сайт»: кнопка тепер гейтить лише пост у
// календар. «Скип» ставить watch=false → турнір ховається і з /live.
// Кейс Arc 16.09: виявлено рівно на старті, але ~годину висів невидимим до апруву.
// approved.eq.true лишено в OR, щоб жоден уже схвалений турнір не зник, навіть
// якщо «трекати» колись вимкнули в адмінці.
// activeOnly — лише незавершені (status ≠ 'ended'; поллер перемикає його через ~30 хв
// після end_at, тож грейс сюди теж потрапляє). ids — лише ці (≤ IN_CHUNK за раз).
export async function fetchTournaments({ activeOnly = false, ids = null } = {}) {
  let q = supaRoma
    .from('tournaments')
    .select(
      'id, venue, market, kind, mechanic, external_id, coin_symbol, coin_icon, title, page_url, reward_pool, reward_currency, fee_per_1k, fee_ui_pct, fee_slip_per_1k, fee_auto, fee_auto_lo, fee_auto_hi, fee_auto_note, fee_auto_at, fee_tokens, start_at, end_at, status, approved, config, ' +
        'tournament_volume(total_volume, min_rank_volume, participants, token_price_usd, extra, updated_at)'
    )
  q = q.or('approved.eq.true,watch.eq.true')
  if (activeOnly) q = q.neq('status', 'ended')
  if (ids) q = q.in('id', ids)
  const { data, error } = await deadline(q.order('end_at', { ascending: true }))
  if (error) throw error
  return (data || []).map((t) => ({ ...t, vol: one(t.tournament_volume) }))
}

// Перечитати конкретні турніри (ті, що випали з активних) — пачками по IN_CHUNK.
export function fetchTournamentsByIds(ids) {
  return inChunks(ids, (chunk) => fetchTournaments({ ids: chunk }))
}

export async function fetchTournamentHistory(tournamentId, limit = MAX_ROWS) {
  const { data, error } = await deadline(supaRoma
    .from('tournament_volume_history')
    .select('total_volume, min_rank_volume, observed_at')
    .eq('tournament_id', tournamentId)
    .order('observed_at', { ascending: false })
    .limit(limit))
  if (error) throw error
  return (data || []).reverse()
}

// Історія КІЛЬКОХ серій одним запитом на пачку (замість запиту на кожен турнір).
// Повертає id → рядки за зростанням observed_at (як fetchTournamentHistory), не більше
// cap на серію. Стеля 1000 рядків діє на ВЕСЬ запит, а не на серію, тож догортаємо
// сторінками назад у часі, поки кожна серія не набере cap або дані не скінчаться.
// Курсор — lte по observed_at: рядки на самій межі сторінки приходять удруге й
// відкидаються як дубль. Збій пачки → її id у відповіді просто немає (catch на пачку),
// і фронт лишає попередній графік, а не гасить усі.
// since (id → observed_at останнього рядка, що вже є у фронта) — ІНКРЕМЕНТ: лише новіші
// рядки. Історія лише дописується (новий рядок раз на 5–10 хв), тож живу серію після
// першого фетчу не качаємо цілком щоразу — вартість росте з к-стю нових рядків, а не з
// віком турніру. Поріг — у кожної серії свій (or з and(id, observed_at > поріг)): спільний
// найменший змусив би серію, що давно не писалась (досетлінг завершеного flash через
// добу), тягнути за собою добу чужої історії.
async function fetchHistoryBatch(table, idCol, cols, ids, since = null, cap = MAX_ROWS) {
  const by = {}
  for (const id of ids) by[id] = []
  const chunks = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK))
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        // Пороги лише коли вони є в КОЖНОЇ серії пачки — інакше серія без порогу недобрала б.
        // Значення в лапках, як радить PostgREST для or(): у часі є «.», «:» і «+».
        const inc = since && chunk.every((id) => since[id]) ? chunk.map((id) => `and(${idCol}.eq."${id}",observed_at.gt."${since[id]}")`).join(',') : null
        let need = chunk
        let before = null
        while (need.length) {
          let q = supaRoma.from(table).select(`${idCol}, ${cols}`).in(idCol, need).order('observed_at', { ascending: false }).limit(MAX_ROWS)
          if (inc) q = q.or(inc)
          if (before) q = q.lte('observed_at', before)
          const { data, error } = await deadline(q)
          if (error) throw error
          for (const r of data || []) {
            const arr = by[r[idCol]]
            const s = since?.[r[idCol]]
            if (s && Date.parse(r.observed_at) <= Date.parse(s)) continue // уже є у фронта
            if (arr && arr.length < cap && arr[arr.length - 1]?.observed_at !== r.observed_at) arr.push(r)
          }
          const last = data?.[data.length - 1]?.observed_at
          if (!data || data.length < MAX_ROWS || last === before) break
          before = last
          need = need.filter((id) => by[id].length < cap)
        }
      } catch {
        for (const id of chunk) delete by[id]
      }
    })
  )
  for (const id in by) by[id].reverse()
  return by
}

export function fetchTournamentHistories(tournamentIds, since = null) {
  return fetchHistoryBatch('tournament_volume_history', 'tournament_id', 'total_volume, min_rank_volume, observed_at', tournamentIds, since)
}

// Точки глибокого лідерборду (ранг > 100) — з них будується крива «обсяг → ранг».
// Пише поллер: зонди (гаманці, що випали з топ-100) + перевірки користувачів.
// Анонімно — адрес у таблиці немає. Беремо всі турніри одним запитом.
// Плоский список, найсвіжіші першими. since — лише точки з observed_at ≥ since:
// старі точки не змінюються, тож після першого фетчу фронт докачує тільки нові.
export async function fetchRankPointRows(since = null, limit = MAX_ROWS) {
  let q = supaRoma
    .from('tournament_rank_points')
    .select('tournament_id, rank, volume, v100, observed_at')
  if (since) q = q.gte('observed_at', since)
  const { data, error } = await deadline(q.order('observed_at', { ascending: false }).limit(limit))
  if (error) throw error
  return data || []
}

export function groupRankPoints(rows) {
  const by = {}
  for (const r of rows || []) (by[r.tournament_id] ||= []).push(r)
  return by
}

export async function fetchRankPoints(limit = MAX_ROWS) {
  return groupRankPoints(await fetchRankPointRows(null, limit))
}

// Денні снепшоти к-сті учасників (найсвіжіший на турнір) — для приросту «+N».
// Лише для переданих (активних) турнірів: «+N» є тільки на живих картках, а таблиця
// росте на рядок на турнір на добу і не чиститься — без фільтра опит ріс би вічно.
export async function fetchParticipantSnapshots(tournamentIds) {
  const { rows } = await inChunks(tournamentIds, async (chunk) => {
    const { data, error } = await deadline(supaRoma
      .from('tournament_participants_daily')
      .select('tournament_id, snap_date, participants')
      .in('tournament_id', chunk)
      .order('snap_date', { ascending: false }))
    if (error) throw error
    return data || []
  })
  rows.sort((a, b) => (a.snap_date < b.snap_date ? 1 : a.snap_date > b.snap_date ? -1 : 0)) // пачки зливаємо назад у «найсвіжіші першими»
  const latest = {} // tournament_id → {snap_date, participants} (перший = найсвіжіший)
  for (const r of rows) if (!(r.tournament_id in latest)) latest[r.tournament_id] = r
  return latest
}

// Історія авто-комси турніру (для «сер. комса за 24г до кінця» на завершених).
export async function fetchTournamentFeeHistory(tournamentId, limit = 200) {
  const { data, error } = await deadline(supaRoma
    .from('tournament_fee_history')
    .select('fee_auto, observed_at')
    .eq('tournament_id', tournamentId)
    .order('observed_at', { ascending: false })
    .limit(limit))
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
    flashConfig: isFlash ? c.flash_config || null : null, // коефіцієнти дня/пари/активності
    venue: 'okx',
    market: 'cex',
    kind: isFlash ? 'flash' : 'spot',
    // Flash Earn рахує нагороду інакше за звичайний пул-шер (ефективний обсяг,
    // без розмивання, з кепом) — позначаємо окремою механікою, щоб калькулятор
    // не застосував до нього формулу розмивання.
    mechanic: isFlash ? 'flash-share' : 'pool-share',
    coin_symbol: c.coin_symbol,
    coin_icon: c.coin_icon,
    title: c.name,
    page_url: c.page_url,
    reward_pool: c.share_pool ?? c.prize_pool ?? c.coin_amount ?? null,
    reward_currency: c.prize_currency || 'USDT',
    fee_per_1k: null,
    // Комса спота OKX = taker базового рівня (0,1% від обсягу; обидві ноги
    // рахуються в турнірний обсяг, тож ставка застосовується просто до нього).
    // Нижчі ставки VIP1-6 — у повному калькуляторі під карткою.
    fee_ui_pct: c.fee_ui_pct != null ? Number(c.fee_ui_pct) : 0.1,
    fee_slip_per_1k: c.fee_slip_per_1k, // живий замір зі стакану (поллер, щогодини)
    fee_auto_at: c.fee_checked_at,
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
  const { data, error } = await deadline(supaRoma
    .from('okx_campaigns')
    .select(OKX_SEL)
    .eq('status', 'active')
    .eq('watch', true)
    .order('end_at', { ascending: true }))
  if (error) throw error
  return (data || []).map(normalizeOkx)
}

export async function fetchOkxEndedAsTournaments() {
  const { data, error } = await deadline(supaRoma
    .from('okx_campaigns')
    .select(OKX_SEL)
    .eq('status', 'ended')
    .order('end_at', { ascending: false }))
  if (error) throw error
  return (data || []).map(normalizeOkx)
}

// Перечитати конкретні кампанії (ті, що випали з активних) — пачками по IN_CHUNK.
// Лишаємо те, що віддали б два списки вище: завершені (будь-який watch) або активні з
// watch=true. Сховану (активна, watch=false) не повертаємо — вона зникає, як і раніше.
export function fetchOkxByIdsAsTournaments(campaignIds) {
  return inChunks(campaignIds, async (chunk) => {
    const { data, error } = await deadline(supaRoma.from('okx_campaigns').select(OKX_SEL).in('id', chunk))
    if (error) throw error
    return (data || []).filter((c) => c.status === 'ended' || (c.status === 'active' && c.watch)).map(normalizeOkx)
  })
}

// Історія завершеного OKX-турніру (стара таблиця okx_volume_history) — для графіка.
export async function fetchOkxHistory(campaignId, limit = MAX_ROWS) {
  const { data, error } = await deadline(supaRoma
    .from('okx_volume_history')
    .select('total_volume, observed_at')
    .eq('campaign_id', campaignId)
    .order('observed_at', { ascending: false })
    .limit(limit))
  if (error) throw error
  return (data || []).reverse()
}

// Те саме пачкою — для АКТИВНИХ OKX-кампаній (ключ — campaign_id, не `okx-<id>`).
export function fetchOkxHistories(campaignIds, since = null) {
  return fetchHistoryBatch('okx_volume_history', 'campaign_id', 'total_volume, observed_at', campaignIds, since)
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
