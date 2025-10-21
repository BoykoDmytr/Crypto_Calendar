import { AIRDROP_CONFIG } from '../config';

const ZERO_ADDRESS_TOPIC = '0x' + '0'.repeat(64);

function toRpcHex(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('Invalid block number provided');
  }
  if (value < 0) {
    return '0x0';
  }
  return `0x${value.toString(16)}`;
}

function hexToNumber(hexValue) {
  if (!hexValue) return 0;
  return Number.parseInt(hexValue, 16);
}

function extractAmountFromData(data, index) {
  if (!data) return 0n;
  const clean = data.startsWith('0x') ? data.slice(2) : data;
  const chunkSize = 64;
  const start = index * chunkSize;
  const segment = clean.slice(start, start + chunkSize);
  if (!segment) return 0n;
  return BigInt(`0x${segment}`);
}

function topicToAddress(topic) {
  if (!topic || topic === ZERO_ADDRESS_TOPIC) return null;
  const normalized = topic.startsWith('0x') ? topic.slice(2) : topic;
  if (normalized.length < 40) return null;
  return `0x${normalized.slice(-40)}`;
}

async function rpcCall(method, params = []) {
  if (!AIRDROP_CONFIG.rpcUrl) {
    throw new Error('Missing RPC URL');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AIRDROP_CONFIG.rpcTimeoutMs);
  try {
    const response = await fetch(AIRDROP_CONFIG.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...AIRDROP_CONFIG.rpcHeaders,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RPC request failed with status ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      const error = new Error(payload.error.message || 'RPC call failed');
      error.code = payload.error.code;
      error.data = payload.error.data;
      throw error;
    }
    return payload.result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`RPC request timed out for method ${method}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestBlockNumber() {
  const latest = await rpcCall('eth_blockNumber');
  return hexToNumber(latest);
}

function buildTopics() {
  const topics = Array.isArray(AIRDROP_CONFIG.topics)
    ? AIRDROP_CONFIG.topics.map((topic) => (topic === undefined ? null : topic))
    : [];
  if (topics.length === 1 && AIRDROP_CONFIG.distributorAddress) {
    const paddedAddress = `0x${AIRDROP_CONFIG.distributorAddress.replace(/^0x/, '').padStart(64, '0')}`;
    topics.push(paddedAddress);
  }
  return topics;
}

async function fetchLogsInRange({ fromBlock, toBlock }) {
  const topics = buildTopics();
  const params = [
    {
      address: AIRDROP_CONFIG.contractAddress,
      fromBlock: toRpcHex(fromBlock),
      toBlock: toRpcHex(toBlock),
      topics,
    },
  ];
  return rpcCall('eth_getLogs', params);
}

async function fetchLogsChunked(fromBlock, toBlock) {
  const results = [];
  if (fromBlock > toBlock) {
    return results;
  }
  let current = fromBlock;
  let chunkSize = AIRDROP_CONFIG.blockChunkSize;
  while (current <= toBlock) {
    const target = Math.min(current + chunkSize - 1, toBlock);
    try {
      const logs = await fetchLogsInRange({ fromBlock: current, toBlock: target });
      results.push(...logs);
      current = target + 1;
    } catch (error) {
      const message = error.message?.toLowerCase?.() || '';
      const tooManyResults =
        error.code === -32005 ||
        message.includes('more than') ||
        message.includes('too many results') ||
        message.includes('response size exceeded');
      if (tooManyResults && chunkSize > 1) {
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));
        continue;
      }
      throw error;
    }
  }
  return results;
}

async function attachBlockTimestamps(events) {
  if (!AIRDROP_CONFIG.fetchBlockTimestamps || events.length === 0) {
    return events;
  }
  const uniqueBlocks = Array.from(new Set(events.map((event) => event.blockNumber)));
  const timestamps = new Map();
  for (const blockNumber of uniqueBlocks) {
    try {
      const block = await rpcCall('eth_getBlockByNumber', [toRpcHex(blockNumber), false]);
      if (block?.timestamp) {
        timestamps.set(blockNumber, hexToNumber(block.timestamp) * 1000);
      }
    } catch (error) {
      console.warn(`Failed to fetch block timestamp for block ${blockNumber}`, error);
    }
  }
  return events.map((event) => ({
    ...event,
    blockTimestamp: timestamps.get(event.blockNumber) ?? null,
  }));
}

export async function fetchAirdropProgress(previousState = {}) {
  if (!AIRDROP_CONFIG.enabled) {
    throw new Error('Airdrop tracker disabled');
  }
  if (!AIRDROP_CONFIG.isConfigured) {
    throw new Error(`Airdrop tracker is not configured. Missing: ${AIRDROP_CONFIG.missingFields.join(', ')}`);
  }
  if (!AIRDROP_CONFIG.contractAddress) {
    throw new Error('Airdrop contract address is missing');
  }
  const latestBlock = await fetchLatestBlockNumber();
  const safeToBlock = Math.max(AIRDROP_CONFIG.startBlock, latestBlock - AIRDROP_CONFIG.confirmationBlocks);
  const previousScanned = previousState.lastScannedBlock ?? (AIRDROP_CONFIG.startBlock - 1);
  const fromBlockBase = previousScanned >= AIRDROP_CONFIG.startBlock ? previousScanned - AIRDROP_CONFIG.reorgBufferBlocks : AIRDROP_CONFIG.startBlock;
  const fromBlock = Math.max(AIRDROP_CONFIG.startBlock, fromBlockBase);
  if (safeToBlock < fromBlock) {
    return {
      events: [],
      deltaClaimed: 0n,
      lastProcessedBlock: previousState.lastProcessedBlock ?? (AIRDROP_CONFIG.startBlock - 1),
      lastProcessedLogIndex: previousState.lastProcessedLogIndex ?? -1,
      lastScannedBlock: previousState.lastScannedBlock ?? (AIRDROP_CONFIG.startBlock - 1),
      scannedFromBlock: fromBlock,
      scannedToBlock: safeToBlock,
      latestBlock,
    };
  }

  const rawLogs = await fetchLogsChunked(fromBlock, safeToBlock);
  rawLogs.sort((a, b) => {
    const blockDiff = hexToNumber(a.blockNumber) - hexToNumber(b.blockNumber);
    if (blockDiff !== 0) return blockDiff;
    return hexToNumber(a.logIndex) - hexToNumber(b.logIndex);
  });

  const previousBlock = previousState.lastProcessedBlock ?? (AIRDROP_CONFIG.startBlock - 1);
  const previousLogIndex = previousState.lastProcessedLogIndex ?? -1;

  const detectionTimestamp = Date.now();
  let deltaClaimed = 0n;
  let lastProcessedBlock = previousBlock;
  let lastProcessedLogIndex = previousLogIndex;

  const events = [];
  for (const log of rawLogs) {
    const blockNumber = hexToNumber(log.blockNumber);
    const logIndex = hexToNumber(log.logIndex);
    if (blockNumber < AIRDROP_CONFIG.startBlock) {
      continue;
    }
    const alreadyProcessed =
      blockNumber < previousBlock || (blockNumber === previousBlock && logIndex <= previousLogIndex);
    if (alreadyProcessed) {
      continue;
    }
    const amount = extractAmountFromData(log.data, AIRDROP_CONFIG.amountDataIndex);
    if (amount <= 0n) {
      continue;
    }
    const claimer = AIRDROP_CONFIG.claimerTopicIndex != null
      ? topicToAddress(log.topics?.[AIRDROP_CONFIG.claimerTopicIndex])
      : null;
    events.push({
      amount,
      blockNumber,
      logIndex,
      claimer,
      transactionHash: log.transactionHash,
      detectedAt: detectionTimestamp,
    });
    deltaClaimed += amount;
    if (blockNumber > lastProcessedBlock || (blockNumber === lastProcessedBlock && logIndex > lastProcessedLogIndex)) {
      lastProcessedBlock = blockNumber;
      lastProcessedLogIndex = logIndex;
    }
  }

  const enrichedEvents = await attachBlockTimestamps(events);

  return {
    events: enrichedEvents,
    deltaClaimed,
    lastProcessedBlock,
    lastProcessedLogIndex,
    lastScannedBlock: safeToBlock,
    scannedFromBlock: fromBlock,
    scannedToBlock: safeToBlock,
    latestBlock,
  };
}