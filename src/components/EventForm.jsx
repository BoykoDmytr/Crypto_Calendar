// src/components/EventForm.jsx
import { useEffect, useState, useRef, useMemo } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../lib/supabase';
import { fetchEventTypes } from '../lib/api';
import { toLocalInput } from '../utils/timeLocal';
import { extractCoinEntries, hasCoinEntries, parseCoinQuantity } from '../utils/coins';

dayjs.extend(utc);
dayjs.extend(timezone);

const kyivTZ = 'Europe/Kyiv';

// The empty coin template used when adding a new coin entry in the form.  It
// includes a contract address field instead of a price link; the address
// represents the token contract on its native chain.
const emptyCoin = { name: '', quantity: '', address: '' };

const extractTimeSegment = (value) => {
  if (!value) return '';
  const match = String(value).match(/(\d{2}:\d{2})/);
  return match ? match[1] : '';
};

// Convert a normalized coin entry into the shape expected by the form state.
// Prefers the explicit address field over a legacy price_link if present.
const toFormCoin = (coin) => {
  const name = coin?.name || '';
  const hasQuantity = coin && Object.prototype.hasOwnProperty.call(coin, 'quantity');
  const quantity = hasQuantity && coin.quantity !== null && coin.quantity !== undefined
    ? String(coin.quantity)
    : '';
  // Prefer address; fallback to price_link for legacy events
  const address = coin?.address || coin?.price_link || '';
  return { name, quantity, address };
};

// Build the list of coins for the form state from an incoming source (event or edit).
const deriveCoinsForState = (source) => {
  const entries = extractCoinEntries(source);
  if (!entries.length) return [];
  return entries.map((coin) => toFormCoin(coin));
};

// Sanitize coins before sending to the backend.  Trims strings and converts
// quantity to a number.  Only includes fields that are present.  Uses
// `address` instead of `price_link`.
const sanitizeCoinsForPayload = (coins) => {
  if (!Array.isArray(coins)) return [];
  return coins
    .map((coin) => {
      const name = (coin?.name || '').trim();
      const address = (coin?.address || '').trim();
      const quantityValue = parseCoinQuantity(coin?.quantity);

      const hasAny = name || address || quantityValue !== null;
      if (!hasAny) return null;

      const entry = {};
      if (name) entry.name = name;
      if (quantityValue !== null) entry.quantity = quantityValue;
      if (address) entry.address = address;
      return entry;
    })
    .filter(Boolean);
};

export default function EventForm({ onSubmit, loading, initial = {} }) {
  const [types, setTypes] = useState([]); // довідник типів
  const [form, setForm] = useState(() => {
    const isEditing = initial && Object.keys(initial).length > 0;
    const defaultTimezone = isEditing ? (initial.timezone || 'UTC') : 'Kyiv';

    const base = {
      title: '',
      description: '',
      nickname: '',
      // важливо: тепер зберігаємо slug типу
      event_type_slug: initial?.event_type_slug || 'listing-tge',
      type: initial?.type || 'Listing (TGE)', // лишаємо для відображення у картках/легасі
      // 👇 ключова правка: узгоджуємо з тим, чим гідратимемо поля
      timezone: defaultTimezone,
      start_at: '',
      end_at: '',
      start_date: '',
      start_time: '',
      link: '',
      coins: [],
      tge_exchanges: [],
    };

    const merged = { ...base, ...(initial || {}) };
    const coins = deriveCoinsForState(initial);
    merged.coins = coins.length ? coins : [];
    delete merged.coin_name;
    delete merged.coin_quantity;
    delete merged.coin_price_link;
    delete merged.coin_address;
    delete merged.coin_circulating_supply;
    merged.nickname = merged.nickname || '';
    return merged;
  });

  const hydratedRef = useRef(false);
  const hydratedWithTypesRef = useRef(false);
  const [showTokenFields, setShowTokenFields] = useState(() => hasCoinEntries(initial));
  const initialHasTokenInfo = useMemo(() => hasCoinEntries(initial), [initial]);

  /** 1) Тягаємо типи і НЕ перетираємо тип, якщо прийшли редагувати */
  useEffect(() => {
    (async () => {
      try {
        const list = await fetchEventTypes(); // твоя функція -> [{label/name, slug, active, is_tge, ...}]
        setTypes(list || []);

        // Якщо вже є тип у initial — нічого не авто-ставимо
        const hasInitialType = !!(initial?.event_type_slug || initial?.type);
        if (hasInitialType) return;

        // Якщо у формі ще не обраний тип — поставимо перший активний
        setForm((s) => {
          if (s.event_type_slug || !list?.length) return s;
          const first = list.find((t) => t.active) || list[0];
          return first
            ? { ...s, event_type_slug: first.slug, type: first.name ?? first.label }
            : s;
        });
      } catch (e) {
        console.error('Failed to load event_types', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.event_type_slug, initial?.type]);

  /** 2) Одноразова гідрація форми з initial (щоб не “злітав” час, тип і біржі) */
  useEffect(() => {
    const hasTypes = Array.isArray(types) && types.length > 0;
    if (!initial || Object.keys(initial).length === 0) return;

    if (hasTypes && hydratedWithTypesRef.current) return;
    if (!hasTypes && hydratedRef.current) return;

    setForm((prev) => {
      let next = { ...prev, ...initial };

      // Підтягнемо slug за назвою, якщо прийшла тільки назва типу
      let matchedType = null;
      if (types?.length) {
        matchedType =
          types.find(
            (t) =>
              t.slug === (initial.event_type_slug || next.event_type_slug) ||
              t.name === initial.type ||
              t.label === initial.type
          ) || null;
      }

      if (!next.event_type_slug && matchedType) {
        next.event_type_slug = matchedType.slug;
        next.type = matchedType.name ?? matchedType.label ?? initial.type ?? prev.type;
      }

      if (!matchedType && (initial.type || initial.event_type_slug) && types?.length) {
        matchedType =
          types.find(
            (t) =>
              t.slug === next.event_type_slug ||
              t.name === next.type ||
              t.label === next.type
          ) || null;
      }

      // Зберігаємо біржі як є (якщо це TGE і масив присутній)
      if (Array.isArray(initial.tge_exchanges)) {
        next.tge_exchanges = [...initial.tge_exchanges];
      }

      // Конвертації дат/часів під інпути (це лише для ПРЕФІЛУ UI; у submit ти вже конвертуєш назад у UTC)
      const tz = initial.timezone || 'UTC';
      const typeName = next.type;
      const isTge = matchedType?.is_tge || typeName === 'Listing (TGE)';
      const isTimeOptional = !!matchedType?.time_optional || typeName === 'Binance Alpha';

      if (isTge) {
        if (initial.start_at) {
          next.start_at = toLocalInput(initial.start_at, tz, 'date'); // YYYY-MM-DD
          const hasTime = /(\d{2}:\d{2})/.test(String(initial.start_at));
          let timeLocal = '';
          if (hasTime) {
            timeLocal = toLocalInput(initial.start_at, tz, 'time');
          } else if (initial.start_time) {
            timeLocal = extractTimeSegment(initial.start_time);
          } else if (prev.start_time) {
            timeLocal = extractTimeSegment(prev.start_time);
          }
          next.start_time = timeLocal === '00:00' ? '' : timeLocal;
        } else if (initial.start_time) {
          const cleaned = extractTimeSegment(initial.start_time);
          next.start_time = cleaned === '00:00' ? '' : cleaned;
        }
        // end_at для TGE ігноруємо
      } else if (isTimeOptional) {
        if (initial.start_at) {
          next.start_date = toLocalInput(initial.start_at, tz, 'date');   // YYYY-MM-DD
          let optionalTime = toLocalInput(initial.start_at, tz, 'time');   // HH:mm (або '')
          if (!optionalTime && initial.start_time) {
            optionalTime = extractTimeSegment(initial.start_time);
          } else if (!optionalTime && prev.start_time) {
            optionalTime = extractTimeSegment(prev.start_time);
          }
          next.start_time = optionalTime === '00:00' ? '' : optionalTime;
        }
        if (initial.end_at) {
          next.end_at = toLocalInput(initial.end_at, tz, 'datetime');     // YYYY-MM-DDTHH:mm
        }
      } else {
        // інші типи — звичайний datetime-local
        if (initial.start_at) {
          next.start_at = toLocalInput(initial.start_at, tz, 'datetime');
        }
        if (initial.end_at) {
          next.end_at = toLocalInput(initial.end_at, tz, 'datetime');
        }
      }

      // 👇 ключова правка: зафіксувати у формі ту саму TZ, якою гідратнули поля
      next.timezone = tz;

      const derivedCoins = deriveCoinsForState(initial);
      if (derivedCoins.length) {
        next.coins = derivedCoins;
      } else {
        next.coins = Array.isArray(prev.coins) ? prev.coins : [];
      }
      delete next.coin_name;
      delete next.coin_quantity;
      delete next.coin_price_link;
      delete next.coin_address;
      delete next.coin_circulating_supply;
      next.nickname = next.nickname || '';
      return next;
    });

    hydratedRef.current = true;
    if (hasTypes) {
      hydratedWithTypesRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, types]);

  const currentType = useMemo(
    () => types.find(t => t.slug === form.event_type_slug) || { is_tge: true, time_optional: true, name: 'Listing (TGE)' },
    [types, form.event_type_slug]
  );

  // довідник бірж
  const [dictExchanges, setDictExchanges] = useState({ spot: [], futures: [] });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('exchanges')
        .select('name, segment')
        .eq('active', true)
        .order('segment', { ascending: true })
        .order('name', { ascending: true });
      if (!error && alive) {
        const spot = [], futures = [];
        (data || []).forEach(x => (x.segment === 'Futures' ? futures : spot).push(x.name));
        setDictExchanges({ spot, futures });
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (initialHasTokenInfo) {
      setShowTokenFields(true);
    }
  }, [initialHasTokenInfo]);

  useEffect(() => {
    if (!showTokenFields) return;
    setForm((prev) => {
      const coins = Array.isArray(prev.coins) ? prev.coins.filter(Boolean) : [];
      if (coins.length > 0) return prev;
      return { ...prev, coins: [{ ...emptyCoin }] };
    });
  }, [showTokenFields]);
  const change = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const handleTokenToggle = (checked) => {
    setShowTokenFields(checked);
    if (!checked) {
      setForm((s) => ({
        ...s,
        coins: [],
      }));
    }
  };

  const addCoin = () => {
    setForm((prev) => {
      const list = Array.isArray(prev.coins) ? prev.coins.slice() : [];
      return { ...prev, coins: [...list, { ...emptyCoin }] };
    });
  };

  const updateCoin = (index, key, value) => {
    setForm((prev) => {
      const list = Array.isArray(prev.coins) ? prev.coins.slice() : [];
      if (!list[index]) {
        list[index] = { ...emptyCoin };
      }
      list[index] = { ...list[index], [key]: value };
      return { ...prev, coins: list };
    });
  };

  const removeCoin = (index) => {
    setForm((prev) => {
      const list = Array.isArray(prev.coins) ? prev.coins.slice() : [];
      if (list.length <= 1) {
        return { ...prev, coins: [{ ...emptyCoin }] };
      }
      list.splice(index, 1);
      return { ...prev, coins: list };
    });
  };
  // ряди бірж (TGE)
  const addExchange = () =>
    change('tge_exchanges', [ ...(form.tge_exchanges || []), { name: '', time: '' } ]);
  const setExchange = (i, key, val) => {
    const arr = [ ...(form.tge_exchanges || []) ];
    arr[i] = { ...arr[i], [key]: val };
    change('tge_exchanges', arr);
  };
  const removeExchange = (i) => {
    const arr = [ ...(form.tge_exchanges || []) ];
    arr.splice(i, 1);
    change('tge_exchanges', arr);
  };

  const toISOorNull = (localStr, mode) => {
    if (!localStr) return null;
    if (mode === 'UTC') return new Date(localStr + 'Z').toISOString();
    return dayjs.tz(localStr.replace('T', ' '), kyivTZ).toDate().toISOString();
  };

  // prefills для «дата + (опц.)час»
  const datePrefill = () =>
    form.start_date || (form.start_at ? String(form.start_at).slice(0,10) : '');
  const timePrefill = () => {
    if (form.start_time) return form.start_time;
    if (!form.start_at) return '';
    const t = dayjs(form.start_at).format('HH:mm');
    return t === '00:00' ? '' : t;
  };

  const submit = (e) => {
    e.preventDefault();
    const payload = { ...form };

    // записуємо «людську» назву типу (для картки/легасі)
    payload.type = currentType.name;

    if (currentType.is_tge) {
      // дата + (опційний) час + біржі
      const rawDate = (form.start_at || '').trim();
      const date = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
      const manualTime = (form.start_time || '').trim();
      const fallbackTime = !manualTime && rawDate.includes('T')
        ? rawDate.split('T')[1].slice(0, 5)
        : '';
      const time = manualTime || fallbackTime || '00:00';
      const local = date ? `${date}T${time}` : '';
      payload.start_at = toISOorNull(local, form.timezone);
      delete payload.end_at;
      payload.tge_exchanges = (payload.tge_exchanges || [])
        .filter(x => (x?.name || '').trim() || (x?.time || '').trim());
      delete payload.start_date;
      delete payload.start_time;
    } else if (currentType.time_optional) {
      // дата + опційний час
      const date = (form.start_date && String(form.start_date).trim())
                || (form.start_at && String(form.start_at).slice(0,10))
                || '';
      const time = (form.start_time || '').trim(); // може бути порожнім
      const local = time ? `${date}T${time}` : `${date}T00:00`;
      payload.start_at = toISOorNull(local, form.timezone);
      payload.end_at   = toISOorNull(form.end_at, form.timezone);
      if (!payload.end_at) delete payload.end_at;
      delete payload.start_date;
      delete payload.start_time;
      delete payload.tge_exchanges;
    } else {
      // повний datetime-local
      payload.start_at = toISOorNull(form.start_at, form.timezone);
      payload.end_at   = toISOorNull(form.end_at,   form.timezone);
      if (!payload.end_at) delete payload.end_at;
      delete payload.start_date;
      delete payload.start_time;
      delete payload.tge_exchanges;
    }

    if (form.link !== undefined) {
      if (String(form.link).trim() === '') {
        payload.link = null;
      } else {
        payload.link = String(form.link).trim();
      }
    }
    if (!payload.description) delete payload.description;

    if (showTokenFields) {
      const sanitizedCoins = sanitizeCoinsForPayload(form.coins);
      if (sanitizedCoins.length > 0) {
        payload.coins = sanitizedCoins.map((coin) => ({ ...coin }));
        const [primary] = sanitizedCoins;
        if (primary.name) {
          payload.coin_name = primary.name;
        } else {
          delete payload.coin_name;
        }
        if (Object.prototype.hasOwnProperty.call(primary, 'quantity')) {
          payload.coin_quantity = primary.quantity;
        } else {
          delete payload.coin_quantity;
        }
        if (primary.address) {
          payload.coin_address = primary.address;
        } else {
          delete payload.coin_address;
        }
        // Do not set coin_price_link at creation; it will be resolved later
        delete payload.coin_price_link;
        // clear any previously stored circulating supply on new submission
        delete payload.coin_circulating_supply;
      } else {
        delete payload.coins;
        delete payload.coin_name;
        delete payload.coin_quantity;
        delete payload.coin_address;
        delete payload.coin_price_link;
        delete payload.coin_circulating_supply;
      }
    } else {
      delete payload.coins;
      delete payload.coin_name;
      delete payload.coin_quantity;
      delete payload.coin_address;
      delete payload.coin_price_link;
      delete payload.coin_circulating_supply;
    }
    const nickname = (form.nickname || '').trim();
    if (nickname) {
      payload.nickname = nickname;
    } else if (initial?.nickname) {
      payload.nickname = null;
    } else {
      delete payload.nickname;
    }
    onSubmit?.(payload);
  };
  const coinsList = Array.isArray(form.coins) ? form.coins : [];
  const tgeDateValue = form.start_at ? String(form.start_at).slice(0, 10) : '';
  const tgeTimeValue = (() => {
    if (form.start_time) return form.start_time;
    if (!form.start_at) return '';
    const raw = String(form.start_at);
    if (!raw.includes('T')) return '';
    const candidate = raw.split('T')[1].slice(0, 5);
    return candidate === '00:00' ? '' : candidate;
  })();
  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Нікнейм відправника */}
      <div>
        <label className="label">Нікнейм (опц.)</label>
        <input
          className="input"
          value={form.nickname || ''}
          onChange={(e) => change('nickname', e.target.value)}
          placeholder="Напр., cryptofan"
        />
      </div>
      {/* Заголовок */}
      <div>
        <label className="label">Заголовок *</label>
        <input className="input" required
          value={form.title}
          onChange={e => change('title', e.target.value)}
          placeholder="Напр., ASTER TGE" />
      </div>

      {/* Опис */}
      <div>
        <label className="label">Опис</label>
        <textarea className="input min-h-[90px]"
          value={form.description}
          onChange={e => change('description', e.target.value)}
          placeholder="Короткий опис події" />
      </div>
      
      {/* Часова зона вводу */}
      <div>
        <label className="label">Часова зона вводу</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button"
            onClick={()=>change('timezone','UTC')}
            className={`px-3 py-2 rounded-xl border ${form.timezone==='UTC'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>UTC</button>
          <button type="button"
            onClick={()=>change('timezone','Kyiv')}
            className={`px-3 py-2 rounded-xl border ${form.timezone==='Kyiv'?'bg-brand-600 text-white border-brand-600':'border-gray-200'}`}>Київський час</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Вводь час у вибраній зоні — ми збережемо в UTC.</p>
      </div>

      {/* Поля дат/часу згідно з типом */}
      {currentType.is_tge ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Початок *</label>
            <input type="date" required className="input"
              value={tgeDateValue}
              onChange={e=>change('start_at', e.target.value)} />
          </div>
          <div>
            <label className="label">Час (опц.)</label>
            <input
              type="time"
              step="60"
              className="input"
              value={tgeTimeValue}
              onChange={e=>change('start_time', e.target.value)}
            />
          </div>
        </div>
      ) : currentType.time_optional ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Дата *</label>
              <input type="date" required className="input"
                value={datePrefill()}
                onChange={e=>change('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Час (опц.)</label>
              <input type="time" step="60" className="input"
                value={timePrefill()}
                onChange={e=>change('start_time', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Кінець (необов’язково)</label>
            <input type="datetime-local" className="input"
              value={form.end_at || ''}
              onChange={e=>change('end_at', e.target.value)} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Початок *</label>
            <input type="datetime-local" required className="input"
              value={form.start_at || ''}
              onChange={e=>change('start_at', e.target.value)} />
          </div>
          <div>
            <label className="label">Кінець (необов’язково)</label>
            <input type="datetime-local" className="input"
              value={form.end_at || ''}
              onChange={e=>change('end_at', e.target.value)} />
          </div>
        </div>
      )}

      {/* Тип + Посилання */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Тип</label>
          <select className="input"
            value={form.event_type_slug}
            onChange={e=>{
              const slug = e.target.value;
              const t = types.find(x=>x.slug===slug);
              change('event_type_slug', slug);
              change('type', t?.name || '');
            }}>
            {types.map(t => (
              <option key={t.id} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Посилання</label>
          <input className="input" value={form.link || ''}
            onChange={e=>change('link', e.target.value)}
            placeholder="https://…" />
        </div>
      </div>
      
      {/* Монети */}
      <div className="space-y-2">
        <label className="label inline-flex items-center gap-2 mb-0">
          <input
            type="checkbox"
            checked={showTokenFields}
            onChange={(e) => handleTokenToggle(e.target.checked)}
          />
        <span>Додати інформацію про монети</span>
        </label>

        {showTokenFields && (
          <div className="space-y-3">
            {coinsList.map((coin, index) => (
              <div key={`coin-${index}`} className="space-y-2 rounded-xl border border-gray-200 p-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Назва монети</label>
                    <input
                      className="input"
                      value={coin?.name || ''}
                      onChange={(e) => updateCoin(index, 'name', e.target.value)}
                      placeholder="Напр., TURTLE"
                    />
                  </div>
                  <div>
                    <label className="label">Кількість монет</label>
                    <input
                      className="input"
                      inputMode="decimal"
                      pattern="[0-9.,\s]*"
                      value={coin?.quantity || ''}
                      onChange={(e) => updateCoin(index, 'quantity', e.target.value)}
                      placeholder="1 000 000"
                    />
                  </div>
                  <div>
                    <label className="label">Адреса контракту</label>
                    <input
                      className="input"
                      value={coin?.address || ''}
                      onChange={(e) => updateCoin(index, 'address', e.target.value)}
                      placeholder="0x…"
                    />
                  </div>
                </div>
                {coinsList.length > 1 && (
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary" onClick={() => removeCoin(index)}>
                      Видалити монету
                    </button>
                  </div>
                )}
              </div>
              ))}
            <button type="button" className="btn" onClick={addCoin}>
              + Додати монету
            </button>
            <p className="text-xs text-gray-500">
               Вкажіть монету, її кількість і адресу контракту — ми автоматично підставимо URL на MEXC
              та підтягнемо USD‑ціну. Якщо вказана адреса вже торгується на MEXC, ціна братиметься з MEXC; інакше буде виконано пошук через CoinGecko.
            </p>
          </div>
        )}
      </div>

      {/* Біржі + час (лише для TGE) */}
      {currentType.is_tge && (
        <div className="space-y-2">
          <div className="label">Біржі та час (опц.)</div>
          {(form.tge_exchanges || []).map((x, i)=>(
            <div key={i} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <select className="input sm:col-span-3"
                value={x.name || ''} onChange={e=>setExchange(i,'name', e.target.value)}>
                <option value="" disabled>Оберіть біржу…</option>
                <optgroup label="Spot">
                  {dictExchanges.spot.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
                <optgroup label="Futures">
                  {dictExchanges.futures.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              </select>
              <input type="time" step="60" className="input sm:col-span-1"
                value={x.time || ''} onChange={e=>setExchange(i,'time', e.target.value)} />
              <button type="button" className="btn-secondary sm:col-span-1"
                onClick={()=>removeExchange(i)}>–</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={addExchange}>+ Додати біржу</button>
          <p className="text-xs text-gray-500">Дата й (за потреби) час задаються вище, нижче — часи для конкретних бірж.</p>
        </div>
      )}

      <div className="pt-2">
        <button disabled={loading} className="btn">
          {loading ? 'Зберігаю…' : 'Надіслати на модерацію'}
        </button>
      </div>
    </form>
  );
}