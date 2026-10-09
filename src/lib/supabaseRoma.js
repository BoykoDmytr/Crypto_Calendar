import { createClient } from '@supabase/supabase-js'

// База живих даних ботів (турніри OKX, клейми) для /live і /claims.
//
// 09.10.2026 переїхала з jtskeszumqapfjhpyevq (орг romasya06) на
// qaiipwbczkzesolhqhbn: стару організацію Supabase заблокував до 16.10 за
// перевищення egress (5.68 з 5.5 ГБ). Причиною була ця ж сторінка — щохвилинне
// повне перезавантаження історії у фоновій вкладці; виправлено тим самим
// комітом. Стара база лишилась архівом корпусу Binance Square, сайт її не читає.
//
// Окремий клієнт: основний VITE_SUPABASE_URL вказує на календарну базу.
// Publishable-ключ безпечний для фронтенду (RLS: тільки SELECT; промки,
// налаштування й користувачі ботів анонімові не видні — перевірено 09.10).
const url =
  import.meta.env.VITE_ROMA_SUPABASE_URL || 'https://qaiipwbczkzesolhqhbn.supabase.co'
const key =
  import.meta.env.VITE_ROMA_SUPABASE_ANON_KEY ||
  'sb_publishable_yXFfL38gEqzRM8Zpmi-rCQ_xaAdoboM'

export const supaRoma = createClient(url, key, {
  // Читання /live анонімне. Але секція «Креатор-кампанії» в /admin логіниться саме
  // цим клієнтом, тому сесію ТРЕБА зберігати — інакше пароль питається щоразу.
  // Окремий storageKey ізолює її від основного клієнта сайту.
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-roma-live' },
})
