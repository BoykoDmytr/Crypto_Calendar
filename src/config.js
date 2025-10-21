import { toBaseUnits } from './utils/tokenAmount';

export const TG_OWNER_URL = 'https://t.me/romasya06';
export const TG_DEV_URL   = 'https://t.me/BoychikTheBest';
export const TG_chanel_URL = 'https://t.me/cryptohornettg';

function parseIntegerEnv(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = `${value}`.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseJsonEnv(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to parse VITE_AIRDROP_RPC_HEADERS. Expected valid JSON object.', error);
  }
  return {};
}

function normalizeAddress(address) {
  if (!address) return undefined;
  return `0x${address.toLowerCase().replace(/^0x/, '')}`;
}

function parseTopic(topicValue) {
  if (!topicValue && topicValue !== '') {
    return undefined;
  }
  const value = topicValue.trim();
  if (value === '' || value.toLowerCase() === 'null' || value === '*') {
    return null;
  }
  if (value.toLowerCase().startsWith('address:')) {
    const address = normalizeAddress(value.slice(8));
    if (!address) return null;
    return `0x${address.replace(/^0x/, '').padStart(64, '0')}`;
  }
  return value;
}

const dropEnabled = parseBooleanEnv(import.meta.env.VITE_AIRDROP_ENABLED, true);
const tokenDecimals = parseIntegerEnv(import.meta.env.VITE_AIRDROP_TOKEN_DECIMALS, 18);
const totalAllocationInput = import.meta.env.VITE_AIRDROP_TOTAL_ALLOCATION;
let totalAllocation = null;
try {
  if (totalAllocationInput !== undefined && totalAllocationInput !== null && totalAllocationInput !== '') {
    totalAllocation = toBaseUnits(totalAllocationInput, tokenDecimals);
  }
} catch (error) {
  console.warn('Failed to parse VITE_AIRDROP_TOTAL_ALLOCATION. Provide a decimal number.', error);
}

const topic0 = parseTopic(import.meta.env.VITE_AIRDROP_TOPIC0 ?? '');
const topic1Raw = import.meta.env.VITE_AIRDROP_TOPIC1;
const topic2Raw = import.meta.env.VITE_AIRDROP_TOPIC2;
const topic3Raw = import.meta.env.VITE_AIRDROP_TOPIC3;

const topics = [];
if (topic0) topics.push(topic0);
if (topic1Raw !== undefined) topics.push(parseTopic(topic1Raw));
if (topic2Raw !== undefined) topics.push(parseTopic(topic2Raw));
if (topic3Raw !== undefined) topics.push(parseTopic(topic3Raw));

const requiredMissing = [];
if (!import.meta.env.VITE_AIRDROP_RPC_URL) requiredMissing.push('VITE_AIRDROP_RPC_URL');
if (!import.meta.env.VITE_AIRDROP_CONTRACT) requiredMissing.push('VITE_AIRDROP_CONTRACT');
if (!topic0) requiredMissing.push('VITE_AIRDROP_TOPIC0');
if (totalAllocation === null) requiredMissing.push('VITE_AIRDROP_TOTAL_ALLOCATION');

export const AIRDROP_CONFIG = {
  enabled: dropEnabled,
  id: import.meta.env.VITE_AIRDROP_ID || 'default',
  name: import.meta.env.VITE_AIRDROP_NAME || 'Airdrop campaign',
  description: import.meta.env.VITE_AIRDROP_DESCRIPTION || '',
  tokenSymbol: import.meta.env.VITE_AIRDROP_TOKEN_SYMBOL || 'TOKEN',
  rpcUrl: import.meta.env.VITE_AIRDROP_RPC_URL,
  rpcHeaders: parseJsonEnv(import.meta.env.VITE_AIRDROP_RPC_HEADERS),
  contractAddress: normalizeAddress(import.meta.env.VITE_AIRDROP_CONTRACT),
  distributorAddress: normalizeAddress(import.meta.env.VITE_AIRDROP_DISTRIBUTOR),
  topics,
  claimerTopicIndex: parseIntegerEnv(import.meta.env.VITE_AIRDROP_CLAIMER_TOPIC_INDEX, 1),
  amountDataIndex: parseIntegerEnv(import.meta.env.VITE_AIRDROP_AMOUNT_DATA_INDEX, 0),
  startBlock: parseIntegerEnv(import.meta.env.VITE_AIRDROP_START_BLOCK, 0),
  confirmationBlocks: Math.max(0, parseIntegerEnv(import.meta.env.VITE_AIRDROP_CONFIRMATION_BLOCKS, 5)),
  reorgBufferBlocks: Math.max(0, parseIntegerEnv(import.meta.env.VITE_AIRDROP_REORG_BUFFER, 12)),
  blockChunkSize: Math.max(1, parseIntegerEnv(import.meta.env.VITE_AIRDROP_BLOCK_CHUNK, 2000)),
  historyLimit: Math.max(10, parseIntegerEnv(import.meta.env.VITE_AIRDROP_HISTORY_LIMIT, 720)),
  refreshIntervalMs: Math.max(30_000, parseIntegerEnv(import.meta.env.VITE_AIRDROP_REFRESH_INTERVAL, 60_000)),
  rpcTimeoutMs: Math.max(5_000, parseIntegerEnv(import.meta.env.VITE_AIRDROP_RPC_TIMEOUT, 15_000)),
  fetchBlockTimestamps: parseBooleanEnv(import.meta.env.VITE_AIRDROP_FETCH_BLOCK_TIMESTAMPS, false),
  explorerBaseUrl: import.meta.env.VITE_AIRDROP_EXPLORER_BASE_URL,
  totalAllocation,
  tokenDecimals,
  missingFields: requiredMissing,
  isConfigured: requiredMissing.length === 0,
};