export default async function handler(req, res) {
  const { symbol, market = 'spot' } = req.query || {};

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing symbol' });
  }

  const m = market === 'futures' ? 'futures' : 'spot';
  const sym = symbol.trim().toUpperCase();

  let url = '';
  let fallbackUrl = '';

  if (m === 'spot') {
    // spot: BTCUSDT
    url = `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`;
  } else {
    // futures: BTC_USDT
    url = `https://api.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(sym)}`;
    fallbackUrl = `https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(sym)}`;
  }

  const fetchJson = async (u) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let r;
    try {
      r = await fetch(u, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (e) {
      const isAbort = e?.name === 'AbortError';
      const err = new Error(isAbort ? 'timeout' : (e?.message || 'network_error'));
      err.status = isAbort ? 'timeout' : 'network';
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (!r.ok || !json) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      err.body = text?.slice?.(0, 300) || '';
      throw err;
    }
    return json;
  };

  const fetchWithRetry = async (u) => {
    try {
      return await fetchJson(u);
    } catch (e) {
      const retryable =
        e?.status === 'timeout' ||
        e?.status === 'network' ||
        (typeof e?.status === 'number' && e.status >= 500);
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 200));
      return await fetchJson(u);
    }
  };

  let json;
  try {
    try {
      json = await fetchWithRetry(url);
    } catch (e) {
      if (!fallbackUrl) throw e;
      json = await fetchWithRetry(fallbackUrl);
    }
  } catch (e) {
    // 4xx from MEXC means the symbol isn't listed (pre-TGE / typo), not a server fault
    if (typeof e?.status === 'number' && (e.status === 400 || e.status === 404)) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({
        ok: false,
        error: 'symbol_not_found',
        status: e.status,
        market: m,
        symbol: sym,
      });
    }
    console.error(JSON.stringify({
      evt: 'mexc_ticker_fail',
      symbol: sym,
      market: m,
      status: e?.status,
      body: e?.body || e?.message,
    }));
    return res.status(500).json({
      ok: false,
      error: e?.message || 'Unknown error',
      status: e?.status,
      body: e?.body,
    });
  }

  // Парсимо ціну
  let price = null;

  if (m === 'spot') {
    // { symbol, price: "..." }
    price = Number(json?.price);
  } else {
    // { data: { lastPrice } } або data: [ ... ]
    const data = json?.data;
    if (Array.isArray(data)) {
      const found = data.find((x) => String(x?.symbol || '').toUpperCase() === sym);
      price = Number(found?.lastPrice);
    } else {
      price = Number(data?.lastPrice);
    }
  }

  if (!Number.isFinite(price)) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      ok: false,
      error: 'symbol_not_found',
      status: 'parse_error',
      market: m,
      symbol: sym,
    });
  }

  // кеш на CDN Vercel (щоб було швидше і менше запитів)
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  return res.status(200).json({ ok: true, price });
}
