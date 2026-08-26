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
  // Читання /live анонімне. Але секція «Креатор-кампанії» в /admin логіниться саме
  // цим клієнтом, тому сесію ТРЕБА зберігати — інакше пароль питається щоразу.
  // Окремий storageKey ізолює її від основного клієнта сайту.
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-roma-live' },
})
