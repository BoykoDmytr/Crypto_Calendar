export default async function handler(req, res) {
  try {
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
      const r = await fetch(u, {
        headers: { accept: 'application/json' },
      });
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

    let json;
    try {
      json = await fetchJson(url);
    } catch (e) {
      if (!fallbackUrl) throw e;
      json = await fetchJson(fallbackUrl);
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
      return res.status(502).json({ ok: false, error: 'Cannot parse price', raw: json });
    }

    // кеш на CDN Vercel (щоб було швидше і менше запитів)
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=55');
    return res.status(200).json({ ok: true, price });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || 'Unknown error',
      status: e?.status,
      body: e?.body,
    });
  }
}
