import { useEffect, useMemo, useState } from 'react';
import { fetchTrackedTokens, eventDate } from '../lib/claimsApi';
import './Claims.css';

// ---- formatting helpers (all UTC, on-chain truth) ----
const pad = (n) => String(n).padStart(2, '0');

function fmtAmount(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x >= 1e6) return `${(x / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return new Intl.NumberFormat('en-US').format(x);
}
function fmtDateUTC(d) {
  if (!d) return '—';
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
function fmtTimeUTC(ev) {
  if (!ev?.actual_start_utc) return '';
  const d = new Date(ev.actual_start_utc);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
function fmtPromised(promised) {
  if (!promised) return '—';
  const d = new Date(`${promised}T00:00:00Z`);
  return fmtDateUTC(d);
}

const LOGO_COLORS = { SOSO: '#d8602e', OFC: '#7c3aed', OPG: '#2563eb' };
const logoColor = (sym) => LOGO_COLORS[sym] || '#475569';
// Логотипи токенів: OFC/OPG — з OKX-CDN, SOSO (SoSoValue) — з CoinGecko.
const CLAIM_LOGOS = {
  OFC: 'https://static.coinall.ltd/cdn/oksupport/asset/currency/icon/ofc20260409083807.png',
  OPG: 'https://static.coinall.ltd/cdn/oksupport/asset/currency/icon/opg20260423155408.png',
  SOSO: 'https://coin-images.coingecko.com/coins/images/53919/large/soso.jpg',
};

// Логотип токена клейму: справжня іконка з фолбеком на кольорове коло з літерою.
function ClaimLogo({ symbol }) {
  const [failed, setFailed] = useState(false);
  const url = CLAIM_LOGOS[symbol];
  if (url && !failed) {
    return (
      <img
        className="claim-logo claim-logo--img"
        src={url}
        alt={symbol}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="claim-logo" style={{ background: logoColor(symbol) }}>
      {symbol[0]}
    </span>
  );
}

const STATUS_LABEL = {
  completed: 'завершено',
  verified: 'триває',
  late: 'очікується',
  announced: 'анонс',
};
function statusColor(status) {
  if (status === 'verified') return '#f87171';
  if (status === 'completed') return '#34d399';
  if (status === 'late') return '#f59e0b';
  return 'var(--brand)';
}

function pctOf(ev) {
  if (ev.pct_claimed != null) return Math.max(0, Math.min(100, Number(ev.pct_claimed)));
  if (ev.amount_pool && ev.amount_claimed != null) {
    return Math.max(0, Math.min(100, (Number(ev.amount_claimed) / Number(ev.amount_pool)) * 100));
  }
  return 0;
}

function isLive(ev) {
  return ev.status === 'verified' && pctOf(ev) < 100;
}

export default function Claims() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const tracked = await fetchTrackedTokens();
        setTokens(tracked);
        if (tracked.length) setActive((prev) => prev || tracked[0].symbol);
      } catch (e) {
        console.error('[claims] load failed', e);
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const token = useMemo(
    () => tokens.find((t) => t.symbol === active) || tokens[0] || null,
    [tokens, active],
  );

  const events = useMemo(() => token?.claim_events || [], [token]);
  const liveEvent = events.find(isLive);
  const lastCompleted = events.find((e) => e.status === 'completed');
  const nextPredicted = useMemo(() => {
    const dates = events.map((e) => e.next_predicted).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [events]);

  return (
    <div className="claims">
      <div className="claims-head">
        <div className="claims-title">Community Claims</div>
        <div className="claims-sub">
          Календар клеймів токенів (MEXC/BingX ф'ючерси), де кожен розлок{' '}
          <b>верифікований on-chain</b> через Blockscout: точний час старту (UTC), скільки
          гаманців заклеймили та скільки роздано. Не плутати з vesting-анлоками інсайдерів.
        </div>
      </div>

      {loading && <div className="claims-state">Завантаження клеймів…</div>}
      {error && <div className="claims-state claims-state--error">Помилка: {error}</div>}

      {!loading && !error && tokens.length === 0 && (
        <div className="claims-state">Поки що немає відстежуваних токенів.</div>
      )}

      {!loading && !error && token && (
        <>
          {/* token tabs */}
          <div className="claim-tabs">
            {tokens.map((t) => {
              const live = (t.claim_events || []).some(isLive);
              return (
                <button
                  key={t.symbol}
                  className={`claim-tab ${t.symbol === token.symbol ? 'on' : ''}`}
                  onClick={() => setActive(t.symbol)}
                >
                  <ClaimLogo symbol={t.symbol} />
                  {t.symbol}
                  {live && <span className="claim-live-dot" />}
                </button>
              );
            })}
          </div>

          {/* next-unlock banner */}
          <NextBanner
            token={token}
            liveEvent={liveEvent}
            nextPredicted={nextPredicted}
            lastCompleted={lastCompleted}
          />

          {/* campaign history */}
          <div className="claims-section-title">
            Усі розлоки · {events.length} {events.length === 1 ? 'кампанія' : 'кампаній'}
          </div>

          {events.length === 0 && (
            <div className="claims-state">
              Кампаній ще не зафіксовано. Watcher додасть їх після першого on-chain клейму.
            </div>
          )}

          {events.map((ev) => {
            const d = eventDate(ev);
            const pct = pctOf(ev);
            const color = isLive(ev) ? '#f87171' : statusColor(ev.status);
            const claims = ev.claims_count ? `${new Intl.NumberFormat('en-US').format(ev.claims_count)} клеймів` : null;
            const subParts = [ev.label, ev.chain && cap(ev.chain), claims].filter(Boolean);
            const src = (ev.claim_event_sources || [])[0];
            return (
              <div className="card claim-row" key={ev.id}>
                <div className="claim-row-top">
                  <div className="date">
                    {ev.actual_start_utc ? fmtDateUTC(d) : fmtPromised(ev.promised_date)}
                    <span className="time">{fmtTimeUTC(ev)}</span>
                  </div>
                  <div className="claimed">
                    {fmtAmount(ev.amount_claimed)}{' '}
                    {ev.amount_pool != null && <span className="of">/ {fmtAmount(ev.amount_pool)}</span>}
                  </div>
                </div>
                <div className="claim-bar">
                  <div className="claim-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
                <div className="claim-row-sub">
                  <span>{subParts.join(' · ')}</span>
                  <span className="claim-pct" style={{ color }}>
                    {pct ? `${pct.toFixed(1).replace(/\.0$/, '')}% · ` : ''}
                    {isLive(ev) ? 'триває' : STATUS_LABEL[ev.status] || ev.status}
                  </span>
                </div>
                {src && (
                  <div className="claim-sources">
                    <a href={src.url} target="_blank" rel="noreferrer">
                      ⛓ on-chain доказ ↗
                    </a>
                  </div>
                )}
              </div>
            );
          })}

          <div className="claims-foot">
            Усі дані верифіковані on-chain через Blockscout · watcher оновлює автоматично
            <br />
            Не є фінансовою порадою. Інформація з відкритих on-chain джерел.
          </div>
        </>
      )}
    </div>
  );
}

function NextBanner({ token, liveEvent, nextPredicted, lastCompleted }) {
  if (liveEvent) {
    const pct = pctOf(liveEvent);
    return (
      <div className="card claim-next">
        <div>
          <div className="lab">Наступний розлок</div>
          <div className="d">Клеймиться зараз</div>
          <div className="meta">
            {[liveEvent.label, `старт ${fmtDateUTC(eventDate(liveEvent))} ${fmtTimeUTC(liveEvent)}`,
              liveEvent.chain && cap(liveEvent.chain)].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="amt">
          <div className="v">{fmtAmount(liveEvent.amount_claimed)}</div>
          <div className="meta">з {fmtAmount(liveEvent.amount_pool)} роздано · {pct.toFixed(1).replace(/\.0$/, '')}%</div>
        </div>
        <span className="claim-badge claim-badge--live">● LIVE</span>
      </div>
    );
  }

  if (nextPredicted) {
    const est = lastCompleted?.amount_claimed;
    return (
      <div className="card claim-next">
        <div>
          <div className="lab">Наступний розлок</div>
          <div className="d">{fmtPromised(nextPredicted)}</div>
          <div className="meta">Прогноз за on-chain циклом · {token.cadence || 'розклад уточнюється'}</div>
        </div>
        <div className="amt">
          <div className="v">{est ? `≈${fmtAmount(est)}` : token.symbol}</div>
          <div className="meta">очікується</div>
        </div>
        <span className="claim-badge claim-badge--soon">ОЧІКУЄТЬСЯ</span>
      </div>
    );
  }

  return (
    <div className="card claim-next">
      <div>
        <div className="lab">Наступний розлок</div>
        <div className="d">{cadenceLabel(token.cadence)}</div>
        <div className="meta">Дата визначиться за on-chain сигналом (фандинг дистриб'ютора)</div>
      </div>
      <div className="amt">
        <div className="v">TBD</div>
        <div className="meta">за деплоєм контракту</div>
      </div>
      <span className="claim-badge claim-badge--soon">ОЧІКУЄТЬСЯ</span>
    </div>
  );
}

function cap(s) {
  if (!s) return s;
  const map = { valuechain: 'ValueChain', ethereum: 'Ethereum', base: 'Base', solana: 'Solana', vana: 'Vana' };
  return map[s] || s.charAt(0).toUpperCase() + s.slice(1);
}
function cadenceLabel(c) {
  if (c === 'monthly') return 'Щомісячний транш';
  if (c === 'per-epoch') return 'Наступна епоха';
  if (c === 'per-tranche') return 'Наступний транш';
  return 'Наступний розлок';
}
