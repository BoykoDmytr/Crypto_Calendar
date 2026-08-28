import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================================
// АДМІНКА ТУРНІРІВ. Дані живуть у БД А (romasya06), куди фронт має ЛИШЕ читання
// (anon + RLS). Тому запис іде через поллер — у нього сервісний ключ. Гейт:
// заголовок x-admin-secret = SESSION_PUSH_SECRET (той самий, що в закладці
// релогіну OKX). Секрет питаємо один раз і тримаємо в localStorage браузера.
// ============================================================================
const POLLER = import.meta.env.VITE_POLLER_URL || 'https://okx-volume-poller.fly.dev'
const SECRET_KEY = 'tl-admin-secret'

// Що саме оновлює кожен каданс + скільки важить один фетч (щоб ціна була видима).
const CADENCE_META = {
  rank: { label: 'Обсяг + тіри + мій ранг', size: '37 KB', hint: 'головний важіль свіжості й трафіку' },
  web3: { label: 'Поріг топ-N + учасники', size: '0.35 KB', hint: 'дешевий; він же підлога для rank/ssr' },
  ssr: { label: 'Правила тірів + ціна', size: '95 KB', hint: 'міняється рідко — можна рідше' },
  stocks: { label: 'Обсяг xStocks (CEX)', size: '~30 KB', hint: 'потребує залогіненої сесії' },
  feesim: { label: 'Авто-комса', size: '~0', hint: 'прямі виклики, не через проксі' },
}

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const ago = (ts) => {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 90) return s + 'с тому'
  if (s < 5400) return Math.round(s / 60) + 'хв тому'
  return Math.round(s / 3600) + 'г тому'
}
const hhmm = (h) => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0')

export default function TournamentsAdmin() {
  // ГОЛОВНИЙ ШЛЯХ: токен уже залогіненого адміна сайту (поллер перевіряє його тим
  // самим RPC is_admin(), що й фронт) — окремий пароль не потрібен. Секрет лишається
  // запасним шляхом (інший браузер / поза адмінкою).
  const [token, setToken] = useState(null)
  const [tokenReady, setTokenReady] = useState(false)
  const [secret, setSecret] = useState(() => { try { return localStorage.getItem(SECRET_KEY) || '' } catch { return '' } })
  const [draftSecret, setDraftSecret] = useState('')
  const [state, setState] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [edits, setEdits] = useState({}) // id → {поле: значення}

  useEffect(() => {
    let alive = true
    const read = (session) => { if (alive) { setToken(session?.access_token || null); setTokenReady(true) } }
    supabase.auth.getSession().then(({ data }) => read(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => read(session))
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const call = useCallback(async (path, opts = {}) => {
    const auth = token ? { authorization: 'Bearer ' + token } : { 'x-admin-secret': secret }
    const r = await fetch(POLLER + path, {
      ...opts,
      headers: { ...auth, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    })
    if (r.status === 404) throw new Error('невірний секрет або роут недоступний')
    const j = await r.json().catch(() => null)
    if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status))
    return j
  }, [secret, token])

  const load = useCallback(async () => {
    if (!token && !secret) return
    setErr('')
    try { setState(await call('/admin/state')) } catch (e) { setErr(e.message); setState(null) }
  }, [secret, token, call])

  useEffect(() => { if (tokenReady) load() }, [load, tokenReady])
  useEffect(() => {
    if ((!secret && !token) || !state) return
    const t = setInterval(load, 60000) // тримаємо панель свіжою
    return () => clearInterval(t)
  }, [secret, token, state, load])

  const saveSecret = () => {
    const v = draftSecret.trim()
    if (!v) return
    try { localStorage.setItem(SECRET_KEY, v) } catch { /* приватний режим */ }
    setSecret(v); setDraftSecret('')
  }
  const forgetSecret = () => {
    try { localStorage.removeItem(SECRET_KEY) } catch { /* ignore */ }
    setSecret(''); setState(null)
  }

  const setCadence = async (key, minutes) => {
    setBusy('cad:' + key)
    try { await call('/admin/cadence', { method: 'POST', body: JSON.stringify({ key, minutes: Number(minutes) }) }); await load() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const patchTournament = async (id, patch) => {
    setBusy('t:' + id)
    try {
      await call('/admin/tournament', { method: 'POST', body: JSON.stringify({ id, patch }) })
      setEdits((p) => { const n = { ...p }; delete n[id]; return n })
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const action = async (id, act) => {
    setBusy('a:' + id + ':' + act)
    try { await call('/admin/action', { method: 'POST', body: JSON.stringify({ id, action: act }) }); await load() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  // Поки читаємо сесію — не блимаємо формою пароля.
  if (!tokenReady) return <section className="border rounded p-3 text-sm opacity-70">Турніри: перевіряю доступ…</section>
  if (!token && !secret) {
    return (
      <section className="border rounded p-3">
        <h2 className="font-semibold mb-2">Турніри (поллер)</h2>
        <p className="text-sm opacity-70 mb-2">
          Зазвичай доступ береться з твого логіну в адмінці автоматично. Якщо цього не сталося —
          введи секрет поллера (той самий, що в закладці релогіну OKX). Зберігається лише в цьому браузері.
        </p>
        <div className="flex gap-2">
          <input type="password" className="border rounded px-2 py-1 flex-1" placeholder="секрет поллера"
            value={draftSecret} onChange={(e) => setDraftSecret(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveSecret()} />
          <button className="border rounded px-3 py-1" onClick={saveSecret}>Увійти</button>
        </div>
      </section>
    )
  }

  const tours = (state && state.tournaments) || []
  const active = tours.filter((t) => t.status === 'active')
  const ended = tours.filter((t) => t.status !== 'active').slice(0, 6)
  const edit = (id, field, value) => setEdits((p) => ({ ...p, [id]: { ...(p[id] || {}), [field]: value } }))
  const val = (t, field) => (edits[t.id] && edits[t.id][field] !== undefined ? edits[t.id][field] : (t[field] != null ? t[field] : ''))

  return (
    <section className="border rounded p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-semibold">Турніри (поллер)</h2>
        <div className="flex items-center gap-2 text-sm">
          {state && state.poller && (
            <span className="opacity-70">
              цикл {ago(state.poller.at)} · {state.poller.ok ? 'ok' : 'ЗБІЙ'}
              {state.poller.deadCycles > 0 ? ' · мертвих ' + state.poller.deadCycles : ''}
            </span>
          )}
          <button className="border rounded px-2 py-0.5" onClick={load}>Оновити</button>
          {!token && secret && <button className="border rounded px-2 py-0.5 opacity-70" onClick={forgetSecret}>Забути секрет</button>}
        </div>
      </div>

      {err && <div className="text-sm text-red-600 mb-2">Помилка: {err}</div>}
      {!state && !err && <div className="text-sm opacity-70">Завантаження…</div>}

      {state && (
        <>
          <h3 className="text-sm font-semibold mt-2 mb-1">Частота опитування</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
            {Object.entries(state.cadences || {}).map(([key, c]) => {
              const meta = CADENCE_META[key] || {}
              return (
                <div key={key} className="border rounded p-2">
                  <div className="text-sm font-medium">{key} <span className="opacity-60 font-normal">({c.src})</span></div>
                  <div className="text-xs opacity-70">{meta.label} · {meta.size}/раз</div>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" min="1" max="1440" defaultValue={c.min} className="border rounded px-2 py-0.5 w-20"
                      onKeyDown={(e) => e.key === 'Enter' && setCadence(key, e.currentTarget.value)} />
                    <span className="text-xs opacity-70">хв</span>
                    <button className="border rounded px-2 py-0.5 text-xs" disabled={busy === 'cad:' + key}
                      onClick={(e) => setCadence(key, e.currentTarget.parentElement.querySelector('input').value)}>
                      {busy === 'cad:' + key ? '…' : 'Зберегти'}
                    </button>
                  </div>
                  {meta.hint && <div className="text-xs opacity-50 mt-1">{meta.hint}</div>}
                </div>
              )
            })}
          </div>

          <h3 className="text-sm font-semibold mb-1">Актуальні ({active.length})</h3>
          {active.length === 0 && <div className="text-sm opacity-60 mb-2">Активних турнірів зараз немає.</div>}
          {active.map((t) => {
            const extra = (t.vol && t.vol.extra) || {}
            const rb = extra.refback
            const hrs = extra.hours
            const toks = extra.tokens
            return (
              <div key={t.id} className="border rounded p-2 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{t.coin_symbol}</b>
                  <span className="text-xs opacity-70">#{t.id} · {t.kind} · {t.market}</span>
                  {t.vol && t.vol.total_volume != null && <span className="text-xs">обсяг {fmt.format(Math.round(t.vol.total_volume))}</span>}
                  {t.vol && t.vol.participants != null && <span className="text-xs">уч. {fmt.format(t.vol.participants)}</span>}
                  <span className="text-xs opacity-60">{ago(t.vol && t.vol.updated_at)}</span>
                </div>

                <div className="text-xs opacity-75 mt-1">
                  {toks && toks.length ? <>монети: {toks.map((x) => x.sym).join(', ')} · </> : null}
                  комса: {t.fee_per_1k != null ? '$' + t.fee_per_1k + '/1k (ручна)' : '$' + (t.fee_auto != null ? t.fee_auto : '—') + '/1k'}
                  {t.fee_ui_pct != null ? ' (' + t.fee_ui_pct + '%)' : ''}
                  {t.fee_slip_per_1k != null ? ' + прослиз. $' + t.fee_slip_per_1k : ''}
                  {rb ? <> · рефбек: {rb.eligible ? 'до ' + rb.maxPct + '%' : 'нема'} <span className="opacity-60">({rb.reason})</span></> : null}
                  {hrs && hrs.limited && hrs.fromUtc != null ? <> · вікно {hhmm(hrs.fromUtc)}–{hhmm(hrs.toUtc)} UTC</> : null}
                </div>

                <div className="flex flex-wrap items-end gap-2 mt-2">
                  <label className="text-xs">комса $/1k (ручна)
                    <input type="number" step="0.01" className="border rounded px-2 py-0.5 w-24 block"
                      value={val(t, 'fee_per_1k')} onChange={(e) => edit(t.id, 'fee_per_1k', e.target.value)} />
                  </label>
                  <label className="text-xs">ставка %
                    <input type="number" step="0.001" className="border rounded px-2 py-0.5 w-24 block"
                      value={val(t, 'fee_ui_pct')} onChange={(e) => edit(t.id, 'fee_ui_pct', e.target.value)} />
                  </label>
                  <label className="text-xs">приз
                    <input type="number" step="any" className="border rounded px-2 py-0.5 w-28 block"
                      value={val(t, 'reward_pool')} onChange={(e) => edit(t.id, 'reward_pool', e.target.value)} />
                  </label>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={!!(edits[t.id] && edits[t.id].approved !== undefined ? edits[t.id].approved : t.approved)}
                      onChange={(e) => edit(t.id, 'approved', e.target.checked)} /> на сайті
                  </label>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={!!(edits[t.id] && edits[t.id].watch !== undefined ? edits[t.id].watch : t.watch)}
                      onChange={(e) => edit(t.id, 'watch', e.target.checked)} /> трекати
                  </label>

                  <button className="border rounded px-2 py-0.5 text-xs" disabled={!edits[t.id] || busy === 't:' + t.id}
                    onClick={() => {
                      const p = { ...edits[t.id] }
                      for (const k of ['fee_per_1k', 'fee_ui_pct', 'reward_pool']) {
                        if (k in p) p[k] = p[k] === '' ? null : Number(p[k])
                      }
                      patchTournament(t.id, p)
                    }}>
                    {busy === 't:' + t.id ? '…' : 'Зберегти'}
                  </button>
                  <button className="border rounded px-2 py-0.5 text-xs" disabled={busy === 'a:' + t.id + ':poll'}
                    onClick={() => action(t.id, 'poll')}>{busy === 'a:' + t.id + ':poll' ? '…' : 'Опитати зараз'}</button>
                  <button className="border rounded px-2 py-0.5 text-xs" disabled={busy === 'a:' + t.id + ':feesim'}
                    onClick={() => action(t.id, 'feesim')}>{busy === 'a:' + t.id + ':feesim' ? '…' : 'Перерахувати комсу'}</button>
                </div>
                {t.fee_auto_note && <div className="text-xs opacity-50 mt-1">{t.fee_auto_note}</div>}
              </div>
            )
          })}

          {ended.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-3 mb-1">Останні завершені</h3>
              <div className="text-xs opacity-75 space-y-0.5">
                {ended.map((t) => (
                  <div key={t.id}>
                    #{t.id} {t.coin_symbol} — обсяг {t.vol && t.vol.total_volume != null ? fmt.format(Math.round(t.vol.total_volume)) : '—'}
                    {t.vol && t.vol.participants != null ? ' · уч. ' + fmt.format(t.vol.participants) : ''}
                    {t.end_at ? ' · до ' + new Date(t.end_at).toLocaleDateString('uk-UA') : ''}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
