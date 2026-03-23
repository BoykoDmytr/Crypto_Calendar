// src/pages/Admin.jsx
import { useEffect, useState } from 'react';
import { toLocalInput } from "../utils/timeLocal";
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../lib/supabase';
import EventForm from '../components/EventForm';
import { formatQuantity as formatTokenQuantity } from '../hooks/useTokenPrice';
import Toast from '../components/Toast';
import { extractCoinEntries, coinEntriesEqual, parseCoinQuantity as parseQuantity } from '../utils/coins';
import { fetchMexcTickerPrice } from '../utils/fetchMexcTicker';


dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = 'Europe/Kyiv';

function RowActions({ children }) {
  return <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">{children}</div>;
}

// форматування дати/часу у списках адмінки
function formatEventDate(ev) {
  const tz = ev?.timezone || 'UTC';
  const base = tz === 'Kyiv' ? dayjs.utc(ev.start_at).tz(KYIV_TZ) : dayjs.utc(ev.start_at);
  if (ev?.type === 'Listing (TGE)') {
    const hasTime = base.hour() !== 0 || base.minute() !== 0;
    return `${base.format(hasTime ? 'DD MMM YYYY, HH:mm' : 'DD MMM YYYY')} ${tz}`;
  }
  return `${base.format('DD MMM YYYY, HH:mm')} ${tz}`;
}

// утиліта для сорту часу бірж (HH:mm)
const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  return (+m[1]) * 60 + (+m[2]);
};

const formatCoinQuantity = (value) => {
  const formatted = formatTokenQuantity(value);
  return formatted ?? '—';
};

const CoinList = ({ coins = [], className = '', valueClassName = 'font-medium text-gray-800', linkClassName = 'underline' }) => {
  if (!coins || coins.length === 0) return null;
  const containerClass = ['flex flex-col gap-1', className].filter(Boolean).join(' ');
  return (
    <div className={containerClass}>
      {coins.map((coin, idx) => (
        <div key={`${coin?.name || 'coin'}-${idx}`} className="flex flex-wrap items-center gap-3">
          {coin?.name && (
            <span>
              Монета:{' '}
              <span className={valueClassName}>{coin.name}</span>
            </span>
          )}
          {Object.prototype.hasOwnProperty.call(coin || {}, 'quantity') && (
            <span>
              Кількість:{' '}
              <span className={valueClassName}>{formatCoinQuantity(coin.quantity)}</span>
            </span>
          )}
          {coin?.price_link && (
            <a
              className={linkClassName}
              href={coin.price_link}
              target="_blank"
              rel="noreferrer"
            >
              Debot
            </a>
          )}
        </div>
      ))}
    </div>
  );
};

const CoinsDiffRow = ({ oldCoins = [], newCoins = [] }) => (
  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
    <div className="text-xs font-medium text-amber-800">Монети</div>
    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
      <div className="text-sm text-amber-900 line-through decoration-2 decoration-amber-400">
        {oldCoins.length > 0 ? (
          <CoinList coins={oldCoins} className="text-sm" valueClassName="font-medium" linkClassName="underline" />
        ) : (
          '—'
        )}
      </div>
      <div className="text-sm font-semibold text-amber-900">
        {newCoins.length > 0 ? (
          <CoinList coins={newCoins} className="text-sm" valueClassName="font-semibold" linkClassName="underline" />
        ) : (
          '—'
        )}
      </div>
    </div>
  </div>
);

const formatNickname = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
};
const normalizeAutoLink = (link) => {
  if (link === null || link === undefined) return link;
  const trimmed = String(link).trim();
  return trimmed.toLowerCase() === 'null' ? '' : link;
};
/* ===== Helpers for edit preview (правки) ===== */
const prettyDate = (type, ts, tz) => {
  if (!ts) return '—';
  const d = dayjs(ts);
  const hasTime = d.hour() !== 0 || d.minute() !== 0;
  const base = type === 'Listing (TGE)'
    ? d.format(hasTime ? 'DD MMM YYYY, HH:mm' : 'DD MMM YYYY')
    : d.format('DD MMM YYYY, HH:mm');
  return tz ? `${base} ${tz}` : base;
};

const normEx = (arr = []) =>
  arr
    .map((x) => ({ name: (x?.name || '').trim(), time: (x?.time || '').trim() }))
    .filter((x) => x.name || x.time)
    .sort(
      (a, b) =>
        (a.name || '').localeCompare(b.name || '') ||
        (a.time || '').localeCompare(b.time || '')
    );

const sameExchanges = (a, b) => {
  const A = normEx(a), B = normEx(b);
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++)
    if (A[i].name !== B[i].name || A[i].time !== B[i].time) return false;
  return true;
};

const Chips = ({ list = [] }) => (
  <div className="chips flex flex-wrap gap-1.5">
    {normEx(list).map((x, i) => (
      <span key={`${x.name}-${x.time}-${i}`} className="exchange-chip">
        {x.name}{x.time ? ` • ${x.time}` : ''}
      </span>
    ))}
  </div>
);

const TypeBadge = ({ type }) => (
  <span className="badge-type badge-type--yellow">
    {type}
  </span>
);



const DiffRow = ({ label, oldVal, newVal, chips = false }) => (
  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
    <div className="text-xs font-medium text-amber-800">{label}</div>
    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
      <div className="text-sm text-amber-900 line-through decoration-2 decoration-amber-400">
        {chips ? <Chips list={oldVal || []} /> : oldVal ?? '—'}
      </div>
      <div className="text-sm font-semibold text-amber-900">
        {chips ? <Chips list={newVal || []} /> : newVal ?? '—'}
      </div>
    </div>
  </div>
);

/* ===== Компонент рядка довідника бірж ===== */
function ExchangeRow({ ex, onSave, onDelete }) {
  const [row, setRow] = useState(ex);
  useEffect(() => setRow(ex), [ex.id, ex.name, ex.segment, ex.active]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,120px,120px,auto] gap-2 items-center p-2 rounded-xl border border-gray-200">
      <input
        className="input"
        value={row.name}
        onChange={(e) => setRow((r) => ({ ...r, name: e.target.value }))}
        placeholder="Назва біржі"
      />
      <select
        className="input"
        value={row.segment}
        onChange={(e) => setRow((r) => ({ ...r, segment: e.target.value }))}
      >
        <option>Spot</option>
        <option>Futures</option>
      </select>

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!row.active}
          onChange={(e) => setRow((r) => ({ ...r, active: e.target.checked }))}
        />
        <span className="text-sm">Активна</span>
      </label>

      <div className="flex gap-2 justify-end">
        <button className="btn" onClick={() => onSave(row)}>
          Зберегти
        </button>
        <button className="btn-secondary" onClick={() => onDelete(row.id)}>
          Видалити
        </button>
      </div>
    </div>
  );
}

/* ===== Компонент рядка довідника типів ===== */
function TypeRow({ t, onSave, onDelete, moveType, isFirst, isLast }) {
  const [row, setRow] = useState(t);
  useEffect(
    () => setRow(t),
    [t.id, t.label, t.slug, t.active, t.is_tge, t.track_in_stats]
  );

  // автогенерація slug, якщо користувач міняє label і slug порожній або збігається із старим
  const slugify = (s) =>
    s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,220px,150px,auto] gap-2 items-center p-2 rounded-xl border border-gray-200">
      <input
        className="input"
        value={row.label}
        onChange={(e) => {
          const label = e.target.value;
          setRow((r) => ({
            ...r,
            label,
            slug: !r.slug || r.slug === slugify(r.label) ? slugify(label) : r.slug,
          }));
        }}
        placeholder="Напр., Binance Alpha"
      />

      <input
        className="input"
        value={row.slug || ''}
        onChange={(e) => setRow((r) => ({ ...r, slug: e.target.value }))}
        placeholder="slug (binance-alpha)"
      />

      <div className="flex items-center flex-wrap gap-4">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!row.active}
            onChange={(e) => setRow((r) => ({ ...r, active: e.target.checked }))}
          />
          <span className="text-sm">Активний</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!row.is_tge}
            onChange={(e) => setRow((r) => ({ ...r, is_tge: e.target.checked }))}
          />
          <span className="text-sm">TGE</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!row.track_in_stats}
            onChange={(e) => setRow((r) => ({ ...r, track_in_stats: e.target.checked }))}
          />
          <span className="text-sm">Статистика</span>
        </label>
      </div>

      <div className="flex gap-2 justify-end">
        {/* Рух вгору/вниз лише стрілками */}
        <button
          className="btn-secondary w-9 h-9 rounded-full"
          title="Вгору"
          onClick={() => moveType(t.id, 'up')}
          disabled={isFirst}
        >↑</button>

        <button
          className="btn-secondary w-9 h-9 rounded-full"
          title="Вниз"
          onClick={() => moveType(t.id, 'down')}
          disabled={isLast}
        >↓</button>

        <button className="btn" onClick={() => onSave(row)}>Зберегти</button>
        <button className="btn-secondary" onClick={() => onDelete(t.id)}>Видалити</button>
      </div>
    </div>
  );
}

export default function Admin() {
  const [pass, setPass] = useState('');
  const [ok, setOk] = useState(false);

  const [autoPending, setAutoPending] = useState([]);
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [edits, setEdits] = useState([]);
  const [stats, setStats] = useState([]);

  // довідник бірж
  const [exchanges, setExchanges] = useState([]);
  const [newEx, setNewEx] = useState({ name: '', segment: 'Spot', active: true });

  // довідник типів
  const [types, setTypes] = useState([]);
  const [newType, setNewType] = useState({
    label: '',
    slug: '',
    is_tge: false,
    active: true,
    track_in_stats: false,
  });

  const [editId, setEditId] = useState(null);
  const [editTable, setEditTable] = useState(null);
  const [toast, setToast] = useState('');
  const [showAllApproved, setShowAllApproved] = useState(false);
  const [showAllStats, setShowAllStats] = useState(false);
  const [approvedQuery, setApprovedQuery] = useState('');

  const approvedLimit = 5;
  const statsLimit = 5;
  const normalizedApprovedQuery = approvedQuery.trim().toLowerCase();
  const filteredApproved = normalizedApprovedQuery
    ? approved.filter((ev) => {
        const haystack = [
          ev?.title,
          ev?.description,
          ev?.type,
          ev?.nickname,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedApprovedQuery);
      })
    : approved;
  const approvedVisible =
    showAllApproved || normalizedApprovedQuery
      ? filteredApproved
      : filteredApproved.slice(0, approvedLimit);
  const statsVisible = showAllStats ? stats : stats.slice(0, statsLimit);

  useEffect(() => {
    if (ok) refresh();
  }, [ok]);

  useEffect(() => {
    if (!ok) return undefined;

    const channel = supabase
      .channel('admin-events-pending')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events_pending' },
        payload => {
          const title = (payload.new?.title || '').trim();
          setToast(title ? `Новий івент на підтвердження: ${title}` : 'Новий івент очікує підтвердження');
          refresh();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [ok]);

  const refresh = async () => {
    const [auto, p, a, e, x, t, s, excluded] = await Promise.all([
      supabase
        .from('auto_events_pending')
        .select('*')
        .order('created_at', { ascending: true }),
      supabase.from('events_pending').select('*').order('created_at', { ascending: true }),
      supabase.from('events_approved').select('*').order('created_at', { ascending: false }),
      supabase
        .from('event_edits_pending')
        .select(
          'id,event_id,payload,submitter_email,created_at,events_approved(id,title,start_at,timezone,type,tge_exchanges)'
        )
        .order('created_at', { ascending: true }),
      supabase
        .from('exchanges')
        .select('*')
        .order('segment', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('event_types')
        .select('*')
        .order('order_index', { ascending: true })
        .order('label', { ascending: true }),
      supabase
        .from('event_price_reaction')
        .select(
          'id,event_id,pair,exchange,t0_time,events_approved(id,title,start_at,timezone,type)'
        )
        .order('t0_time', { ascending: false }),
      supabase.from('event_price_reaction_exclusions').select('event_id'),
    ]);

    if (!auto.error) setAutoPending(auto.data || []);
    if (!p.error) setPending(p.data || []);
    if (!a.error) setApproved(a.data || []);
    if (!e.error) setEdits(e.data || []);
    if (!x.error) setExchanges(x.data || []);
    if (!t.error) setTypes(t.data || []);
    if (!s.error) {
      const excludedIds = new Set((excluded?.data || []).map((row) => row.event_id));
      setStats((s.data || []).filter((row) => !excludedIds.has(row.event_id)));
    }
  };

  // ====== Переміщення типів (order_index) ======
  // поміняти місцями order_index двох типів
  const swapTypeOrder = async (a, b) => {
    await Promise.all([
      supabase.from('event_types').update({ order_index: b.order_index }).eq('id', a.id),
      supabase.from('event_types').update({ order_index: a.order_index }).eq('id', b.id),
    ]);
  };

  // рух типу на 1 позицію вгору/вниз у відсортованому списку
  const moveType = async (id, dir) => {
    const list = [...types].sort(
      (x, y) => (x.order_index ?? 0) - (y.order_index ?? 0) || (x.label || '').localeCompare(y.label || '')
    );
    const i = list.findIndex(t => t.id === id);
    if (i < 0) return;

    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return; // межі

    await swapTypeOrder(list[i], list[j]);
    await refresh(); // перечитати список після апдейту
  };

  const formatPct = (p) => {
  if (p == null || !Number.isFinite(p)) return '';
  const abs = Math.abs(p);
  if (abs >= 1) return p.toFixed(2);
  if (abs >= 0.1) return p.toFixed(3);
  if (abs >= 0.01) return p.toFixed(4);
  return p.toExponential(2);
};

// ✅ беремо circulatingSupply через Edge Function (без CORS і без витоку ключа)
const fetchCircSupplyViaFn = async (coinName) => {
  const { data, error } = await supabase.functions.invoke('dropstab-circ', {
    body: { coinName },
  });

  // 🔎 тимчасово для дебагу (можеш залишити на час тесту)
  console.log('[dropstab-circ] response:', { coinName, data, error });

  if (error) return null;
  return typeof data?.circulatingSupply === 'number' ? data.circulatingSupply : null;
};
// Витягує MEXC-символ з price_link або з назви монети
const extractMexcSymbolForAdmin = (coinName, priceLink) => {
  // 1) З price_link: /futures/TOKEN_USDT або /exchange/TOKEN_USDT
  if (priceLink && typeof priceLink === 'string') {
    const m = priceLink.match(/\/(futures|exchange)\/([A-Z0-9]+)_([A-Z0-9]+)/i);
    if (m) {
      const base = (m[2] || '').toUpperCase();
      const isFutures = (m[1] || '').toLowerCase() === 'futures';
      return {
        symbol: isFutures ? `${base}_USDT` : `${base}USDT`,
        market: isFutures ? 'futures' : 'spot',
      };
    }
    // fallback: TOKEN_USDT десь у рядку
    const m2 = priceLink.match(/([A-Z0-9]{2,})_USDT/i);
    if (m2) {
      const base = (m2[1] || '').toUpperCase();
      const isFutures = /\/futures\//i.test(priceLink);
      return {
        symbol: isFutures ? `${base}_USDT` : `${base}USDT`,
        market: isFutures ? 'futures' : 'spot',
      };
    }
  }
 
  // 2) З назви монети: GWEI -> GWEIUSDT (spot)
  if (coinName) {
    const tok = String(coinName).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (tok) {
      return { symbol: `${tok}USDT`, market: 'spot' };
    }
  }
 
  return null;
};
// ✅ головний хелпер: рахує pct і ПИШЕ В БД КОРЕКТНО (coins = TEXT)
const enrichPayloadWithCircPct = async (payload) => {
  const entries = extractCoinEntries(payload);
  if (!entries.length) return payload;
 
  // ✅ Перевіряємо чи є кастомний MCAP
  const hasCustomMcap = payload.mcap_usd != null
    && Number.isFinite(Number(payload.mcap_usd))
    && Number(payload.mcap_usd) > 0;
  const customMcap = hasCustomMcap ? Number(payload.mcap_usd) : null;
 
  const circList = [];
  const pctList = [];
  const enrichedCoins = [];
 
  for (const entry of entries) {
    const name = (entry?.name || '').trim();
    const qty = parseQuantity(entry?.quantity);
 
    let circ = null;
    let pct = null;
 
    if (name && qty != null && qty > 0) {
      if (hasCustomMcap) {
        // ✅ КАСТОМНИЙ MCAP: отримуємо ціну з MEXC → рахуємо pct через mcap
        const priceLink = entry?.price_link || payload.coin_price_link || '';
        const mexcMeta = extractMexcSymbolForAdmin(name, priceLink);
 
        let price = null;
        if (mexcMeta?.symbol) {
          try {
            const result = await fetchMexcTickerPrice(mexcMeta.symbol, {
              market: mexcMeta.market || 'spot',
            });
            price = result?.price ?? null;
          } catch (e) {
            console.warn('[enrichPayloadWithCircPct] MEXC price fetch failed:', name, e?.message);
          }
        }
 
        if (price != null && Number.isFinite(price) && price > 0) {
          const eventUsd = qty * price;
          // pct = (вартість_івенту / кастомний_mcap) × 100
          pct = (eventUsd / customMcap) * 100;
          // Для довідки: ефективний circ_supply
          circ = customMcap / price;
          // Також зберігаємо event_usd_value
          payload.event_usd_value = eventUsd;
        } else {
          // Не вдалось отримати ціну — фолбек на Dropstab circ_supply
          console.warn('[enrichPayloadWithCircPct] Price not available, fallback to circ_supply for', name);
          circ = await fetchCircSupplyViaFn(name);
          if (circ != null && circ > 0) pct = (qty / circ) * 100;
        }
      } else {
        // ✅ АВТО MCAP: стандартний розрахунок через Dropstab API
        circ = await fetchCircSupplyViaFn(name);
        if (circ != null && circ > 0) pct = (qty / circ) * 100;
      }
    }
 
    enrichedCoins.push({
      ...entry,
      circ_supply: circ,
      pct_circ: pct,
    });
 
    circList.push(circ != null ? String(circ) : '');
    pctList.push(pct != null ? formatPct(pct) : '');
  }
 
  // ⚠️ coins у events_approved = TEXT → тільки JSON.stringify
  payload.coins = JSON.stringify(enrichedCoins);
 
  // текстові колонки
  payload.coin_circ_supply = circList.join('\n');
  payload.coin_pct_circ = pctList.join('\n');
 
  // Для першої монети — числова колонка circulating_supply
  const firstCoin = enrichedCoins[0];
  if (firstCoin?.circ_supply != null) {
    payload.coin_circulating_supply = firstCoin.circ_supply;
  }
 
  return payload;
};

  // ===== МОДЕРАЦІЯ ЗАЯВОК =====
const approve = async (ev, table = 'events_pending') => {
  const allowed = [
    'title','description','start_at','end_at','timezone','type','tge_exchanges','link','nickname','coins',
    'coin_name','coin_quantity','coin_price_link','show_mcap','mcap_usd',
  ];

  const payload = Object.fromEntries(Object.entries(ev).filter(([k]) => allowed.includes(k)));

  if (Array.isArray(ev.tge_exchanges)) {
    payload.tge_exchanges = [...ev.tge_exchanges].sort(
      (a, b) => toMinutes(a?.time) - toMinutes(b?.time)
    );
  }

  // якщо coins прийшов як масив — нормально, enrich сам перетворить у string
  if (Array.isArray(payload.coins)) {
    payload.coins = payload.coins.map((coin) => ({ ...coin }));
  }

  if (payload.end_at === '' || payload.end_at == null) delete payload.end_at;

  if ('nickname' in payload) {
    const trimmed = (payload.nickname || '').trim();
    if (trimmed) payload.nickname = trimmed;
    else delete payload.nickname;
  }

  // ✅ NEW: рахунок % + правильний формат coins (TEXT)
  await enrichPayloadWithCircPct(payload);

  console.log('INSERT payload:', payload); // дебаг (можеш прибрати потім)

  const { error } = await supabase.from('events_approved').insert(payload);
  if (error) return alert('Помилка: ' + error.message);

  await supabase.from(table).delete().eq('id', ev.id);
  await refresh();
};

  const reject = async (ev, table = 'events_pending') => {
    if (!confirm('Відхилити і видалити цю заявку?')) return;
    const { error } = await supabase.from(table).delete().eq('id', ev.id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  const updateRow = async (table, id, payload) => {
  const clean = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== '' && v !== undefined)
  );

  if (clean.end_at === '') delete clean.end_at;

  if ('nickname' in clean) {
    if (clean.nickname === null) {
      // allow clearing
    } else {
      const trimmed = (clean.nickname || '').trim();
      if (trimmed) clean.nickname = trimmed;
      else delete clean.nickname;
    }
  }

  if (Array.isArray(clean.coins)) {
    clean.coins = clean.coins.map((coin) => ({ ...coin }));
    if (clean.coins.length === 0) delete clean.coins;
  }

  const canHaveCoins =
    table === 'events_approved' || table === 'events_pending' || table === 'auto_events_pending';

  if (canHaveCoins) {
    await enrichPayloadWithCircPct(clean); // ✅ тут coins стане string
  }

  console.log('UPDATE payload:', clean); // дебаг

  const { error } = await supabase.from(table).update(clean).eq('id', id);
  if (error) return alert('Помилка: ' + error.message);

  setEditId(null);
  setEditTable(null);
  await refresh();
};
  const removeRow = async (table, id) => {
    if (!confirm('Видалити запис?')) return;
    if (table === 'events_approved') {
      const { error: exclusionsError } = await supabase
        .from('event_price_reaction_exclusions')
        .delete()
        .eq('event_id', id);
      if (exclusionsError) return alert('Помилка: ' + exclusionsError.message);

      const { error: reactionError } = await supabase
        .from('event_price_reaction')
        .delete()
        .eq('event_id', id);
      if (reactionError) return alert('Помилка: ' + reactionError.message);

      const { error: editsError } = await supabase
        .from('event_edits_pending')
        .delete()
        .eq('event_id', id);
      if (editsError) return alert('Помилка: ' + editsError.message);
    }
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  const removeStatsRow = async (row) => {
    if (!confirm('Видалити графік зі статистики? Подія залишиться у календарі.')) return;
    if (!row?.event_id) return alert('Не вдалося визначити подію для видалення.');
    const { error: excludeError } = await supabase
      .from('event_price_reaction_exclusions')
      .upsert({ event_id: row.event_id }, { onConflict: 'event_id' });
    if (excludeError) return alert('Помилка: ' + excludeError.message);
    const { error } = await supabase.from('event_price_reaction').delete().eq('id', row.id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };
  // ===== ПРАВКИ =====
const approveEdit = async (edit) => {
  const allowed = [
    'title','description','start_at','end_at','timezone','type','tge_exchanges','link','nickname','coins',
    'coin_name','coin_quantity','coin_price_link','show_mcap','mcap_usd',
  ];

  const patch = Object.fromEntries(
    Object.entries(edit.payload || {}).filter(([k]) => allowed.includes(k))
  );

  if (Array.isArray(patch.tge_exchanges)) {
    patch.tge_exchanges = [...patch.tge_exchanges].sort(
      (a, b) => toMinutes(a?.time) - toMinutes(b?.time)
    );
  }

  if (Array.isArray(patch.coins)) {
    patch.coins = patch.coins.map((coin) => ({ ...coin }));
  }

  if ('nickname' in patch) {
    if (patch.nickname === null) {
      // keep null to clear
    } else {
      const trimmed = (patch.nickname || '').trim();
      if (trimmed) patch.nickname = trimmed;
      else delete patch.nickname;
    }
  }

  if (patch.end_at === '' || patch.end_at == null) delete patch.end_at;

  const touchesCoins =
    'coins' in patch ||
    'coin_name' in patch ||
    'coin_quantity' in patch ||
    'coin_price_link' in patch;

  if (touchesCoins) {
    await enrichPayloadWithCircPct(patch); // ✅ coins стане string
  }

  console.log('APPROVE EDIT patch:', patch); // дебаг

  const { error } = await supabase.from('events_approved').update(patch).eq('id', edit.event_id);
  if (error) return alert('Помилка: ' + error.message);

  await supabase.from('event_edits_pending').delete().eq('id', edit.id);
  await refresh();
};

  const rejectEdit = async (id) => {
    const { error } = await supabase.from('event_edits_pending').delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== ДОВІДНИК БІРЖ =====
  const addExchange = async () => {
    const name = newEx.name.trim();
    if (!name) return alert('Вкажіть назву біржі');
    const payload = { name, segment: newEx.segment, active: !!newEx.active };
    const { error } = await supabase.from('exchanges').insert(payload);
    if (error) return alert('Помилка: ' + error.message);
    setNewEx({ name: '', segment: 'Spot', active: true });
    await refresh();
  };

  const saveExchange = async (row) => {
    const payload = {
      name: row.name.trim(),
      segment: row.segment,
      active: !!row.active,
    };
    const { error } = await supabase.from('exchanges').update(payload).eq('id', row.id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  const deleteExchange = async (id) => {
    if (!confirm('Видалити біржу? Це може вплинути на існуючі події.')) return;
    const { error } = await supabase.from('exchanges').delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== ДОВІДНИК ТИПІВ =====
  const slugify = (s) =>
    (s || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');


    const makeUniqueSlug = (raw, existingSlugs) => {
    let base = slugify((raw || '').trim() || 'type');
    if (!existingSlugs.has(base)) return base;
    let i = 2;
    while (existingSlugs.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  };
  // Додаємо тип — автоматично у кінець списку
  // додати тип
const addType = async () => {
    const label = newType.label.trim();
    if (!label) return alert('Вкажіть назву типу');

  const { data: all, error: e0 } = await supabase.from('event_types').select('slug');
    if (e0) return alert('Помилка: ' + e0.message);

  const existing = new Set((all || []).map((x) => (x.slug || '').trim()));
    const slug = makeUniqueSlug(newType.slug || label, existing);

// зберегти тип
const payload = {
      label,
      slug,
      is_tge: !!newType.is_tge,
      active: !!newType.active,
      track_in_stats: !!newType.track_in_stats,
      order_index: Number(newType.order_index || 0),
    };

  const { error } = await supabase.from('event_types').insert(payload);
    if (error) return alert('Помилка: ' + error.message);

  setNewType({
    label: '',
    slug: '',
    is_tge: false,
    active: true,
    track_in_stats: false,
    order_index: 0,
  });
    await refresh();
  };

  const saveType = async (row) => {
    const label = row.label.trim();

  const { data: all, error: e0 } = await supabase.from('event_types').select('id, slug');
    if (e0) return alert('Помилка: ' + e0.message);

  const existing = new Set(
      (all || []).filter((x) => x.id !== row.id).map((x) => (x.slug || '').trim())
    );

    const desired = (row.slug || label).trim();
    const slug = makeUniqueSlug(desired, existing);

    const payload = {
      label,
      slug,
      is_tge: !!row.is_tge,
      active: !!row.active,
      track_in_stats: !!row.track_in_stats,
      order_index: Number(row.order_index || 0),
    };
    const { error } = await supabase.from('event_types').update(payload).eq('id', row.id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };


  const deleteType = async (id) => {
    if (
      !confirm(
        'Видалити тип? Якщо він використовується в подіях — спершу змініть тип подій або відключіть цей тип (active=false).'
      )
    )
      return;
    const { error } = await supabase.from('event_types').delete().eq('id', id);
    if (error) return alert('Помилка: ' + error.message);
    await refresh();
  };

  // ===== РЕДАГУВАЛКА КАРТКИ =====
  const EditingCard = ({ table, ev }) => {
    const isTGE = ev?.type === 'Listing (TGE)';
    const startLocal = isTGE
      ? toLocalInput(ev.start_at, ev.timezone, 'date')
      : toLocalInput(ev.start_at, ev.timezone, 'datetime');
    const startLocalTime = isTGE
      ? toLocalInput(ev.start_at, ev.timezone, 'time')
      : '';
    const normalizedLink = table === 'auto_events_pending' ? normalizeAutoLink(ev?.link) : ev?.link;
    const initial = {
      ...ev,
      link: normalizedLink,
      // важливо: передаємо в інпут ЛОКАЛЬНИЙ рядок без 'Z'
      start_at: startLocal,
      ...(isTGE && startLocalTime ? { start_time: startLocalTime === '00:00' ? '' : startLocalTime } : {}),
      end_at: ev.end_at
        ? toLocalInput(ev.end_at, ev.timezone, 'datetime')
        : '',
    };

    return (
      <div className="card p-4">
        <div className="text-sm text-gray-500 mb-2">Редагування ({table})</div>
        <EventForm
          initial={initial}
          onSubmit={(payload)=> updateRow(table, ev.id, payload)}
          loading={false}
        />
        <div className="flex gap-2 mt-3">
          <button
            className="btn-secondary px-4 py-2 rounded-xl"
            onClick={()=>{ setEditId(null); setEditTable(null); }}
          >
            Скасувати
          </button>
        </div>
      </div>
    );
  };

  // ===== ЛОГІН =====
  if (!ok) {
    return (
      <div className="max-w-sm mx-auto">
        <h1 className="text-xl font-semibold mb-2">Вхід в адмін-панель</h1>
        <div className="card p-4">
          <input
            autoFocus
            type="password"
            className="input"
            placeholder="Пароль"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button className="btn w-full mt-3" onClick={() => setOk(pass === import.meta.env.VITE_ADMIN_PASS)}>
            Увійти
          </button>
          <p className="text-xs text-gray-500 mt-2">Пароль знає лише адміністратор.</p>
        </div>
      </div>
    );
  }

  // Відсортований список для коректної роботи стрілок
  const sortedTypes = [...types].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || (a.label || '').localeCompare(b.label || '')
  );

  return (
   <>
      <Toast text={toast} onClose={() => setToast('')} />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Адмін-панель</h1>
          <div className="flex items-center gap-2">
            <Link className="btn-secondary px-3 py-2 rounded-xl" to="/add" state={{ fromAdmin: true }}>
              + Додати івент
            </Link>
            <button className="btn-secondary px-3 py-2 rounded-xl" onClick={refresh}>
              Оновити
            </button>
          </div>
        </div>

       {/* Автоматичні заявки */}
        <section>
          <h2 className="font-semibold mb-2">Автоматичні заявки</h2>
          {autoPending.length === 0 && (
            <p className="text-sm text-gray-600">Немає автоматично зібраних подій.</p>
          )}
          <div className="space-y-3">
            {autoPending.map((ev) => {
              const coins = extractCoinEntries(ev);
              const normalizedLink = normalizeAutoLink(ev?.link);
              return (
                <article key={ev.id} className="card p-4">
                  {editId === ev.id && editTable === 'auto_events_pending' ? (
                    <EditingCard table="auto_events_pending" ev={ev} />
                  ) : (
                    <>
                      <div className="text-xs text-gray-500">
                        {dayjs(ev.created_at).format('DD MMM HH:mm')}
                      </div>
                      <h3 className="font-semibold">{ev.title}</h3>
                      {ev.description && (
                        <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{ev.description}</p>
                      )}
                      <div className="text-sm mt-2 flex flex-wrap items-center gap-2">
                        <TypeBadge type={ev.type} />
                        <span className="event-when">🕒 {formatEventDate(ev)}</span>
                        {normalizedLink && (
                          <a className="underline" href={normalizedLink} target="_blank" rel="noreferrer">
                            Лінк
                          </a>
                        )}
                      </div>
                      {coins.length > 0 && (
                        <CoinList coins={coins} className="mt-2 text-xs text-gray-600" />
                    )}

                    <RowActions>
                        <button className="btn" onClick={() => approve(ev, 'auto_events_pending')}>
                          Схвалити
                        </button>
                        <button className="btn-secondary" onClick={() => reject(ev, 'auto_events_pending')}>
                          Відхилити
                        </button>
                      <div className="flex gap-2">
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              setEditId(ev.id);
                              setEditTable('auto_events_pending');
                            }}
                          >
                            Редагувати
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => removeRow('auto_events_pending', ev.id)}
                          >
                            Видалити
                          </button>
                        </div>
                      </RowActions>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>

      {/* Заявки на модерації */}
      <section>
        <h2 className="font-semibold mb-2">Заявки на модерації</h2>
        {pending.length === 0 && <p className="text-sm text-gray-600">Немає заявок.</p>}
        <div className="space-y-3">
          {pending.map((ev) => {
            const coins = extractCoinEntries(ev);
            return (
              <article key={ev.id} className="card p-4">
                {editId === ev.id && editTable === 'events_pending' ? (
                  <EditingCard table="events_pending" ev={ev} />
                ) : (
                  <>
                    <div className="text-xs text-gray-500">
                      {dayjs(ev.created_at).format('DD MMM HH:mm')}
                    </div>
                    <h3 className="font-semibold">{ev.title}</h3>
                    {ev.description && (
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{ev.description}</p>
                    )}
                    <div className="text-sm mt-2 flex flex-wrap items-center gap-2">
                      <TypeBadge type={ev.type} />
                      <span className="event-when">🕒 {formatEventDate(ev)}</span>
                      {ev.link && (
                        <a className="underline" href={ev.link} target="_blank" rel="noreferrer">
                          Лінк
                        </a>
                      )}
                    </div>
                    {coins.length > 0 && (
                      <CoinList coins={coins} className="mt-2 text-xs text-gray-600" />
                    )}

                    <RowActions>
                      <button className="btn" onClick={() => approve(ev)}>
                        Схвалити
                      </button>
                      <button className="btn-secondary" onClick={() => reject(ev)}>
                        Відхилити
                      </button>
                    <div className="flex gap-2">
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setEditId(ev.id);
                            setEditTable('events_pending');
                          }}
                        >
                          Редагувати
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => removeRow('events_pending', ev.id)}
                        >
                          Видалити
                        </button>
                      </div>
                    </RowActions>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Запропоновані правки (з підсвіткою змін) */}
      <section>
        <h2 className="font-semibold mb-2">Запропоновані правки</h2>
        {edits.length === 0 && <p className="text-sm text-gray-600">Поки що немає.</p>}
        <div className="space-y-3">
          {edits.map((ed) => {
            const base = ed.events_approved || {};
            const patch = ed.payload || {};
            const next = { ...base, ...patch };

            const changed = [];
            if (patch.title && patch.title !== base.title)
              changed.push(
                <DiffRow key="title" label="Заголовок" oldVal={base.title} newVal={patch.title} />
              );
            if (patch.description !== undefined && patch.description !== base.description)
              changed.push(
                <DiffRow
                  key="desc"
                  label="Опис"
                  oldVal={base.description || '—'}
                  newVal={patch.description || '—'}
                />
              );
            if (patch.type && patch.type !== base.type)
              changed.push(<DiffRow key="type" label="Тип" oldVal={base.type} newVal={patch.type} />);
            if (patch.timezone && patch.timezone !== base.timezone)
              changed.push(
                <DiffRow
                  key="tz"
                  label="Часова зона"
                  oldVal={base.timezone || 'UTC'}
                  newVal={patch.timezone || 'UTC'}
                />
              );

            const baseStart = prettyDate(base.type, base.start_at, base.timezone);
            const nextStart = prettyDate(next.type, next.start_at, next.timezone);
            if (patch.start_at !== undefined || patch.type !== undefined || patch.timezone !== undefined)
              if (baseStart !== nextStart)
                changed.push(
                  <DiffRow key="start" label="Початок" oldVal={baseStart} newVal={nextStart} />
                );

            const baseEnd = prettyDate(base.type, base.end_at, base.timezone);
            const nextEnd = prettyDate(next.type, next.end_at, next.timezone);
            if (patch.end_at !== undefined || patch.type !== undefined || patch.timezone !== undefined)
              if (baseEnd !== nextEnd)
                changed.push(<DiffRow key="end" label="Кінець" oldVal={baseEnd} newVal={nextEnd} />);

            if (
              patch.tge_exchanges !== undefined &&
              !sameExchanges(base.tge_exchanges, patch.tge_exchanges)
            )
              changed.push(
                <DiffRow
                  key="ex"
                  label="Біржі (TGE)"
                  oldVal={base.tge_exchanges}
                  newVal={patch.tge_exchanges}
                  chips
                />
              );

            if (patch.link !== undefined && patch.link !== base.link)
              changed.push(
                <DiffRow key="link" label="Посилання" oldVal={base.link || '—'} newVal={patch.link || '—'} />
              );
            if (patch.nickname !== undefined && patch.nickname !== base.nickname)
              changed.push(
                <DiffRow
                  key="nickname"
                  label="Нікнейм"
                  oldVal={formatNickname(base.nickname) || '—'}
                  newVal={
                    patch.nickname === null
                      ? '—'
                      : formatNickname(patch.nickname) || '—'
                  }
                />
              );
            const baseCoins = extractCoinEntries(base);
            const nextCoins = extractCoinEntries(next);
            if (!coinEntriesEqual(baseCoins, nextCoins)) {
              changed.push(
                <CoinsDiffRow key="coins" oldCoins={baseCoins} newCoins={nextCoins} />
              );
            }
            return (
              <article key={ed.id} className="card p-4">
                <div className="text-xs text-gray-500 mb-2">
                  Для івенту <span className="font-medium">#{ed.event_id}</span>
                  {base?.title ? <> • {base.title}</> : null}
                  {' • '}
                  {dayjs(ed.created_at).format('DD MMM HH:mm')}
                </div>

                {changed.length === 0 ? (
                  <div className="text-sm text-gray-600">Зміни не відрізняються від поточного стану.</div>
                ) : (
                  <div className="space-y-2">{changed}</div>
                )}

                <div className="mt-3 flex gap-2">
                  <button className="btn" onClick={() => approveEdit(ed)}>
                    Застосувати
                  </button>
                  <button className="btn-secondary" onClick={() => rejectEdit(ed.id)}>
                    Відхилити
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Схвалені події */}
      <section>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold">Схвалені події</h2>
          <div className="text-xs text-gray-500">
            {normalizedApprovedQuery
              ? `Знайдено: ${filteredApproved.length}`
              : `Всього: ${approved.length}`}
          </div>
        </div>
        <div className="card p-4 mt-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-xs text-gray-500">Пошук по схвалених івентах</span>
              <input
                className="input"
                placeholder="Введіть назву, тип або нікнейм"
                value={approvedQuery}
                onChange={(e) => setApprovedQuery(e.target.value)}
              />
            </label>
            {approvedQuery && (
              <button
                className="btn-secondary w-full sm:w-auto"
                onClick={() => setApprovedQuery('')}
              >
                Очистити
              </button>
            )}
          </div>
        </div>
        {approved.length === 0 && <p className="text-sm text-gray-600">Поки що немає.</p>}
        {approved.length > 0 && filteredApproved.length === 0 && (
          <p className="text-sm text-gray-600 mt-3">Нічого не знайдено за запитом.</p>
        )}
        <div className="space-y-3">
          {approvedVisible.map((ev) => {
            const coins = extractCoinEntries(ev);
            return (
              <article key={ev.id} className="card p-4">
                {editId === ev.id && editTable === 'events_approved' ? (
                  <EditingCard table="events_approved" ev={ev} />
                ) : (
                  <>
                    <div className="font-semibold">{ev.title}</div>
                    <div className="text-sm mt-1 flex flex-wrap items-center gap-2">
                      <span className="event-when">{formatEventDate(ev)}</span>
                      <TypeBadge type={ev.type} />
                    </div>
                  {formatNickname(ev.nickname) && (
                      <div className="mt-2 text-xs text-gray-500">
                        Нікнейм: {formatNickname(ev.nickname)}
                      </div>
                    )}
                    {coins.length > 0 && (
                      <CoinList coins={coins} className="mt-2 text-xs text-gray-600" />
                    )}

                    <RowActions>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setEditId(ev.id);
                          setEditTable('events_approved');
                        }}
                      >
                        Редагувати
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => removeRow('events_approved', ev.id)}
                      >
                        Видалити
                      </button>
                    </RowActions>
                  </>
                )}
              </article>
            );
          })}
        </div>
        {!normalizedApprovedQuery && approved.length > approvedLimit && (
          <div className="mt-3 flex justify-start">
            <button
              className="btn-secondary"
              onClick={() => setShowAllApproved((prev) => !prev)}
            >
              {showAllApproved ? 'Згорнути' : 'Показати всі'}
            </button>
          </div>
        )}
      </section>
      
      {/* Статистика */}
      <section>
        <h2 className="font-semibold mb-2">Статистика (графіки)</h2>
        <p className="text-sm text-gray-600 mb-3">
          Видалення прибирає графік лише зі сторінки статистики та не видаляє саму подію.
        </p>
        {stats.length === 0 && <p className="text-sm text-gray-600">Поки що немає графіків.</p>}
        <div className="space-y-3">
          {statsVisible.map((row) => {
            const event = row.events_approved || {};
            return (
              <article key={row.id} className="card p-4">
                <div className="font-semibold">
                  {event.title || `Подія #${row.event_id}`}
                </div>
                <div className="text-sm mt-1 flex flex-wrap items-center gap-2">
                  {event.start_at && <span className="event-when">{formatEventDate(event)}</span>}
                  {event.type && <TypeBadge type={event.type} />}
                  {row.pair && <span className="text-xs text-gray-500">Пара: {row.pair}</span>}
                  {row.exchange && (
                    <span className="text-xs text-gray-500">Біржа: {row.exchange}</span>
                  )}
                </div>
                {row.t0_time && (
                  <div className="text-xs text-gray-500 mt-2">
                    T0: {dayjs(row.t0_time).format('DD MMM HH:mm')}
                  </div>
                )}
                <RowActions>
                  <button
                    className="btn-secondary"
                    onClick={() => removeStatsRow(row)}
                  >
                    Видалити зі статистики
                  </button>
                </RowActions>
              </article>
            );
          })}
        </div>
        {stats.length > statsLimit && (
          <div className="mt-3 flex justify-start">
            <button
              className="btn-secondary"
              onClick={() => setShowAllStats((prev) => !prev)}
            >
              {showAllStats ? 'Згорнути' : 'Показати всі'}
            </button>
          </div>
        )}
      </section>

      {/* ===== ДОВІДНИК БІРЖ ===== */}
      <section>
        <h2 className="font-semibold mb-2">Довідник бірж</h2>

        {/* Форма додавання */}
        <div className="card p-4 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px,120px,auto] gap-2">
            <input
              className="input"
              placeholder="Назва (напр., Binance Spot)"
              value={newEx.name}
              onChange={(e) => setNewEx((s) => ({ ...s, name: e.target.value }))}
            />
            <select
              className="input"
              value={newEx.segment}
              onChange={(e) => setNewEx((s) => ({ ...s, segment: e.target.value }))}
            >
              <option>Spot</option>
              <option>Futures</option>
            </select>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={newEx.active}
                onChange={(e) => setNewEx((s) => ({ ...s, active: e.target.checked }))}
              />
              <span className="text-sm">Активна</span>
            </label>
            <div className="flex justify-end">
              <button className="btn" onClick={addExchange}>
                + Додати біржу
              </button>
            </div>
          </div>
        </div>

        {/* Список бірж */}
        {exchanges.length === 0 ? (
          <p className="text-sm text-gray-600">Поки що немає записів.</p>
        ) : (
          <div className="space-y-2">
            {exchanges.map((ex) => (
              <ExchangeRow key={ex.id} ex={ex} onSave={saveExchange} onDelete={deleteExchange} />
            ))}
          </div>
        )}
      </section>

      {/* ===== ДОВІДНИК ТИПІВ ===== */}
      <section>
        <h2 className="font-semibold mb-2">Довідник типів</h2>

        {/* Додавання типу (без інпуту порядку) */}
        <div className="card p-4 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,220px,auto] gap-2">
            <input
              className="input"
              placeholder="Напр., Binance Alpha"
              value={newType.label}
              onChange={(e) => setNewType((s) => ({ ...s, label: e.target.value }))}
            />
            <input
              className="input"
              placeholder="slug (авто з назви)"
              value={newType.slug}
              onChange={(e) => setNewType((s) => ({ ...s, slug: e.target.value }))}
            />
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center flex-wrap gap-4">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newType.active}
                    onChange={(e) => setNewType((s) => ({ ...s, active: e.target.checked }))}
                  />
                  <span className="text-sm">Активний</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newType.is_tge}
                    onChange={(e) => setNewType((s) => ({ ...s, is_tge: e.target.checked }))}
                  />
                  <span className="text-sm">TGE</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newType.track_in_stats}
                    onChange={(e) => setNewType((s) => ({ ...s, track_in_stats: e.target.checked }))}
                  />
                  <span className="text-sm">Статистика</span>
                </label>
              </div>
              <button className="btn" onClick={addType}>
                + Додати тип
              </button>
            </div>
          </div>
        </div>

        {/* Список типів (відсортований) */}
        {sortedTypes.length === 0 ? (
          <p className="text-sm text-gray-600">Поки що немає записів.</p>
        ) : (
          <div className="space-y-2">
            {sortedTypes.map((t, idx) => (
              <TypeRow
                key={t.id}
                t={t}
                onSave={saveType}
                onDelete={deleteType}
                moveType={moveType}
                isFirst={idx === 0}
                isLast={idx === sortedTypes.length - 1}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-2">
          Порада: познач «TGE» лише для типу <b>Listing (TGE)</b>. Інші типи (Binance Alpha, OKX
          Alpha, Token Sales, Claim / Airdrop, Unlocks тощо) залишай як звичайні — для них час
          опційний у формах і відображенні.
        </p>
      </section>
    </div>
    </>
  );
}
