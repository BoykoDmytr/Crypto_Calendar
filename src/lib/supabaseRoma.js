import { createClient } from '@supabase/supabase-js'

// romasya06 Supabase (jtskeszumqapfjhpyevq) — okx_* live-дані для /live.
// Окремий клієнт: основний VITE_SUPABASE_URL у продакшні може вказувати на
// іншу базу (календар), а okx_campaigns/okx_volume живуть саме тут.
// Publishable-ключ безпечний для фронтенду (RLS: тільки SELECT).
const url =
  import.meta.env.VITE_ROMA_SUPABASE_URL || 'https://jtskeszumqapfjhpyevq.supabase.co'
const key =
  import.meta.env.VITE_ROMA_SUPABASE_ANON_KEY ||
  'sb_publishable_tMlzL2lli6sjAb1CnBUcwQ_mmL4Cs9Q'

export const supaRoma = createClient(url, key, {
  // читаємо анонімно; окремий storageKey, щоб не конфліктувати з основним клієнтом
  auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-roma-live' },
})
