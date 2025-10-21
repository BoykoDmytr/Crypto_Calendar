import { useCallback, useEffect, useRef, useState } from 'react';
import { AIRDROP_CONFIG } from '../config';
import { fetchAirdropProgress } from '../utils/airdropClient';
import { clearAirdropState, loadAirdropState, persistAirdropState } from '../utils/airdropStorage';
import { formatPercent, formatTokenAmount } from '../utils/tokenAmount';

const DEFAULT_TRACKER_STATE = {
  claimed: 0n,
  lastProcessedBlock: AIRDROP_CONFIG.startBlock - 1,
  lastProcessedLogIndex: -1,
  lastScannedBlock: AIRDROP_CONFIG.startBlock - 1,
  lastUpdated: null,
  history: [],
};

function createInitialState() {
  const baseState = {
    ...DEFAULT_TRACKER_STATE,
    history: [],
  };
  const cached = typeof window !== 'undefined' ? loadAirdropState(AIRDROP_CONFIG.id) : null;
  if (!cached) {
    return baseState;
  }
  return {
    ...baseState,
    ...cached,
    claimed: cached.claimed ?? baseState.claimed,
    lastProcessedBlock: cached.lastProcessedBlock ?? baseState.lastProcessedBlock,
    lastProcessedLogIndex: cached.lastProcessedLogIndex ?? baseState.lastProcessedLogIndex,
    lastScannedBlock: cached.lastScannedBlock ?? baseState.lastScannedBlock,
    lastUpdated: cached.lastUpdated ?? baseState.lastUpdated,
    history: Array.isArray(cached.history) ? cached.history : [],
  };
}

function shortenAddress(address) {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '—';
  const diffMs = Date.now() - timestamp;
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return new Date(timestamp).toLocaleString();
  }
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return new Date(timestamp).toLocaleString();
}

function SummaryCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {helper ? <div className="mt-1 text-xs text-gray-500">{helper}</div> : null}
    </div>
  );
}

function HistoryChart({ history }) {
  if (!history || history.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-500">
        Not enough data yet. Keep the page open to accumulate snapshots.
      </div>
    );
  }

  const width = 640;
  const height = 200;
  const padding = 16;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const points = history.map((entry, index) => {
    const percentClaimed = entry.percentClaimed ?? (100 - (entry.percentLeft ?? 0));
    const safePercent = Math.min(100, Math.max(0, percentClaimed));
    const x = history.length === 1 ? plotWidth / 2 : (index / (history.length - 1)) * plotWidth;
    const y = plotHeight - (safePercent / 100) * plotHeight;
    return {
      x: padding + x,
      y: padding + y,
      percent: safePercent,
      timestamp: entry.timestamp,
    };
  });

  const pathData = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const areaPath = `M ${points[0].x} ${height - padding} ${pathData.replace(/M/, 'L')} L ${points[points.length - 1].x} ${height - padding} Z`;

  const startTimestamp = points[0].timestamp;
  const endTimestamp = points[points.length - 1].timestamp;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div>Progress history (claimed %)</div>
        <div>
          {new Date(startTimestamp).toLocaleString()} → {new Date(endTimestamp).toLocaleString()}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img" aria-label="Airdrop claimed percentage over time">
        <defs>
          <linearGradient id="claimedGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <rect x={padding} y={padding} width={plotWidth} height={plotHeight} fill="#f9fafb" rx={8} />
        <path d={areaPath} fill="url(#claimedGradient)" stroke="none" />
        <path d={pathData} fill="none" stroke="#10b981" strokeWidth={2} strokeLinecap="round" />
        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r={3} fill="#10b981" />
        ))}
        <g fontSize="10" fill="#6b7280">
          <text x={padding} y={height - 4}>{formatRelativeTime(startTimestamp)}</text>
          <text x={width - padding} y={height - 4} textAnchor="end">
            {formatRelativeTime(endTimestamp)}
          </text>
        </g>
      </svg>
    </div>
  );
}

function RecentEventsTable({ events, tokenSymbol, explorerBaseUrl }) {
  if (!events || events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
        No claim transactions detected yet.
      </div>
    );
  }

  const explorerBase = explorerBaseUrl ? explorerBaseUrl.replace(/\/$/, '') : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left">
            <th className="px-4 py-3 font-medium text-gray-500">Block</th>
            <th className="px-4 py-3 font-medium text-gray-500">Claimer</th>
            <th className="px-4 py-3 font-medium text-gray-500">Amount</th>
            <th className="px-4 py-3 font-medium text-gray-500">Detected</th>
            <th className="px-4 py-3 font-medium text-gray-500">Explorer</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {events.map((event) => {
            const timestamp = event.blockTimestamp ?? event.detectedAt;
            const explorerLink = explorerBase && event.transactionHash
              ? `${explorerBase}/tx/${event.transactionHash}`
              : null;
            return (
              <tr key={`${event.blockNumber}-${event.logIndex}-${event.transactionHash}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{event.blockNumber}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{shortenAddress(event.claimer)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {formatTokenAmount(event.amount, AIRDROP_CONFIG.tokenDecimals, { maximumFractionDigits: 4 })} {tokenSymbol}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{formatRelativeTime(timestamp)}</td>
                <td className="px-4 py-3 text-xs">
                  {explorerLink ? (
                    <a
                      href={explorerLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-600 hover:text-emerald-700"
                    >
                      View tx
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AirdropTracker() {
  const [trackerState, setTrackerState] = useState(() => createInitialState());
  const [recentEvents, setRecentEvents] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastScanRange, setLastScanRange] = useState({ from: AIRDROP_CONFIG.startBlock, to: AIRDROP_CONFIG.startBlock });
  const [latestBlock, setLatestBlock] = useState(null);
  const trackerStateRef = useRef(trackerState);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    trackerStateRef.current = trackerState;
  }, [trackerState]);

  const totalAllocation = AIRDROP_CONFIG.totalAllocation;
  const hasTotalAllocation = typeof totalAllocation === 'bigint';
  const tokenSymbol = AIRDROP_CONFIG.tokenSymbol;

  const claimedRaw = trackerState.claimed ?? 0n;
  const totalValue = hasTotalAllocation ? totalAllocation : null;
  const claimedValue = totalValue && claimedRaw > totalValue ? totalValue : claimedRaw;
  const remainingValue = totalValue != null ? (totalValue > claimedValue ? totalValue - claimedValue : 0n) : null;
  let percentClaimedValue = null;
  let percentLeftValue = null;
  if (totalValue && totalValue > 0n) {
    percentClaimedValue = Number((claimedValue * 10_000n) / totalValue) / 100;
    percentLeftValue = Math.max(0, 100 - percentClaimedValue);
  }

  const refresh = useCallback(
    async ({ manual = false } = {}) => {
      if (!AIRDROP_CONFIG.enabled || !AIRDROP_CONFIG.isConfigured) {
        return;
      }
      if (isFetchingRef.current) {
        return;
      }
      isFetchingRef.current = true;
        if (manual) {
          setIsRefreshing(true);
        }
      setError(null);
      try {
        const currentState = trackerStateRef.current ?? createInitialState();
        const progress = await fetchAirdropProgress(currentState);
        setLatestBlock(progress.latestBlock ?? null);
        setLastScanRange({ from: progress.scannedFromBlock, to: progress.scannedToBlock });

        let nextClaimed = currentState.claimed + progress.deltaClaimed;
        if (nextClaimed < 0n) {
          nextClaimed = 0n;
        }
        const total = AIRDROP_CONFIG.totalAllocation;
        if (typeof total === 'bigint' && total >= 0n && nextClaimed > total) {
          nextClaimed = total;
        }
        const remaining = typeof total === 'bigint' ? (total > nextClaimed ? total - nextClaimed : 0n) : 0n;
        const percentClaimed = typeof total === 'bigint' && total > 0n ? Number((nextClaimed * 10_000n) / total) / 100 : 0;
        const percentLeft = typeof total === 'bigint' && total > 0n ? Math.max(0, 100 - percentClaimed) : 0;
        const timestamp = Date.now();

        const historyEntry = {
          timestamp,
          claimed: nextClaimed,
          remaining,
          percentLeft,
          percentClaimed,
        };
        const historyBase = Array.isArray(currentState.history) ? [...currentState.history] : [];
        historyBase.push(historyEntry);
        const nextHistory = historyBase.slice(-AIRDROP_CONFIG.historyLimit);

        const nextState = {
          ...currentState,
          claimed: nextClaimed,
          lastProcessedBlock: progress.lastProcessedBlock ?? currentState.lastProcessedBlock,
          lastProcessedLogIndex: progress.lastProcessedLogIndex ?? currentState.lastProcessedLogIndex,
          lastScannedBlock: progress.lastScannedBlock ?? currentState.lastScannedBlock,
          lastUpdated: timestamp,
          history: nextHistory,
        };
        trackerStateRef.current = nextState;
        setTrackerState(nextState);
        persistAirdropState(AIRDROP_CONFIG.id, nextState);

        if (progress.events?.length) {
          setRecentEvents((prev) => {
            const incoming = [...progress.events].reverse();
            const combined = [...incoming, ...prev];
            const seen = new Set();
            const unique = [];
            for (const event of combined) {
              const key = `${event.blockNumber}:${event.logIndex}:${event.transactionHash}`;
              if (seen.has(key)) continue;
              seen.add(key);
              unique.push(event);
              if (unique.length >= 25) break;
            }
            return unique;
          });
        }
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to refresh airdrop progress');
      } finally {
        isFetchingRef.current = false;
        if (manual) {
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!AIRDROP_CONFIG.enabled || !AIRDROP_CONFIG.isConfigured) {
      return;
    }
    let mounted = true;
    const performInitialRefresh = async () => {
      if (!mounted) return;
      await refresh();
    };
    performInitialRefresh();
    const interval = window.setInterval(() => {
      refresh();
    }, AIRDROP_CONFIG.refreshIntervalMs);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  const handleReset = useCallback(() => {
    clearAirdropState(AIRDROP_CONFIG.id);
    const resetState = createInitialState();
    trackerStateRef.current = resetState;
    setTrackerState(resetState);
    setRecentEvents([]);
    setError(null);
    setLastScanRange({ from: AIRDROP_CONFIG.startBlock, to: AIRDROP_CONFIG.startBlock });
    setLatestBlock(null);
  }, []);

  const lastUpdated = trackerState.lastUpdated ? new Date(trackerState.lastUpdated).toLocaleString() : '—';
  const claimedDisplay = formatTokenAmount(claimedValue ?? 0n, AIRDROP_CONFIG.tokenDecimals, {
    maximumFractionDigits: 2,
  });
  const remainingDisplay =
    remainingValue != null
      ? `${formatTokenAmount(remainingValue, AIRDROP_CONFIG.tokenDecimals, { maximumFractionDigits: 2 })}`
      : '—';
  const totalDisplay =
    totalValue != null
      ? `${formatTokenAmount(totalValue, AIRDROP_CONFIG.tokenDecimals, { maximumFractionDigits: 2 })}`
      : '—';
  const percentClaimedDisplay =
    percentClaimedValue != null ? formatPercent(percentClaimedValue, { maximumFractionDigits: 2 }) : '—';
  const percentLeftDisplay =
    percentLeftValue != null ? formatPercent(percentLeftValue, { maximumFractionDigits: 2 }) : '—';

  const claimedProgress = percentClaimedValue != null ? Math.min(100, Math.max(0, percentClaimedValue)) : 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-900">{AIRDROP_CONFIG.name}</h1>
        {AIRDROP_CONFIG.description ? (
          <p className="text-sm text-gray-600">{AIRDROP_CONFIG.description}</p>
        ) : null}
        <p className="text-xs text-gray-500">
          Tracking smart contract {AIRDROP_CONFIG.contractAddress || '—'} from block {AIRDROP_CONFIG.startBlock}.
        </p>
      </header>

      {!AIRDROP_CONFIG.enabled ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Airdrop tracker is disabled via configuration.
        </div>
      ) : null}

      {AIRDROP_CONFIG.enabled && !AIRDROP_CONFIG.isConfigured ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Missing configuration values: {AIRDROP_CONFIG.missingFields.join(', ')}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard label="Total allocation" value={`${totalDisplay} ${tokenSymbol}`} />
        <SummaryCard label="Claimed" value={`${claimedDisplay} ${tokenSymbol}`} helper={percentClaimedDisplay} />
        <SummaryCard label="Remaining" value={`${remainingDisplay} ${tokenSymbol}`} helper={percentLeftDisplay} />
        <SummaryCard label="Last updated" value={lastUpdated} helper={`Latest block processed: ${latestBlock ?? '—'}`} />
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{percentClaimedDisplay} claimed</span>
          <span>{percentLeftDisplay} remaining</span>
        </div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-700"
            style={{ width: `${claimedProgress}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Last scan range: blocks {lastScanRange.from} → {lastScanRange.to} (latest on chain: {latestBlock ?? '—'})
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => refresh({ manual: true })}
          disabled={isRefreshing || !AIRDROP_CONFIG.enabled || !AIRDROP_CONFIG.isConfigured}
          className="inline-flex items-center rounded-full border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
        >
          Reset cache
        </button>
      </div>

      <HistoryChart history={trackerState.history} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Most recent claims</h2>
          <span className="text-xs text-gray-500">Showing last {recentEvents.length} transactions</span>
        </div>
        <RecentEventsTable events={recentEvents} tokenSymbol={tokenSymbol} explorerBaseUrl={AIRDROP_CONFIG.explorerBaseUrl} />
      </section>
    </div>
  );
}