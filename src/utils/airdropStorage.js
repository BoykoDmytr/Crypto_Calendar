const STORAGE_PREFIX = 'airdrop-tracker';

function getStorageKey(id) {
  return `${STORAGE_PREFIX}:${id}`;
}

export function loadAirdropState(id) {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(id));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return {
      claimed: parsed.claimed ? BigInt(parsed.claimed) : 0n,
      lastProcessedBlock: Number.isFinite(parsed.lastProcessedBlock) ? parsed.lastProcessedBlock : null,
      lastProcessedLogIndex: Number.isFinite(parsed.lastProcessedLogIndex) ? parsed.lastProcessedLogIndex : null,
      lastScannedBlock: Number.isFinite(parsed.lastScannedBlock) ? parsed.lastScannedBlock : null,
      lastUpdated: Number.isFinite(parsed.lastUpdated) ? parsed.lastUpdated : null,
      history: Array.isArray(parsed.history)
        ? parsed.history.map((entry) => ({
            ...entry,
            claimed: entry.claimed ? BigInt(entry.claimed) : 0n,
            remaining: entry.remaining ? BigInt(entry.remaining) : 0n,
          }))
        : [],
    };
  } catch (error) {
    console.warn('Failed to load cached airdrop state', error);
    return null;
  }
}

export function persistAirdropState(id, state) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const payload = {
      claimed: state.claimed?.toString() ?? '0',
      lastProcessedBlock: state.lastProcessedBlock ?? null,
      lastProcessedLogIndex: state.lastProcessedLogIndex ?? null,
      lastScannedBlock: state.lastScannedBlock ?? null,
      lastUpdated: state.lastUpdated ?? null,
      history: Array.isArray(state.history)
        ? state.history.map((entry) => ({
            ...entry,
            claimed: entry.claimed?.toString() ?? '0',
            remaining: entry.remaining?.toString() ?? '0',
          }))
        : [],
    };
    window.localStorage.setItem(getStorageKey(id), JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist airdrop state', error);
  }
}

export function clearAirdropState(id) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(getStorageKey(id));
  } catch (error) {
    console.warn('Failed to clear airdrop state', error);
  }
}