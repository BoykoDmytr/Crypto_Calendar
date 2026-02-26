import { extractCoinEntries, parseCoinQuantity as parseQuantity } from './coins';

export const formatPct = (p) => {
  if (p == null || !Number.isFinite(p)) return '';
  const abs = Math.abs(p);
  if (abs >= 1) return p.toFixed(2);
  if (abs >= 0.1) return p.toFixed(3);
  if (abs >= 0.01) return p.toFixed(4);
  return p.toExponential(2);
};

export const fetchCircSupplyViaFn = async (supabase, coinName) => {
  const { data, error } = await supabase.functions.invoke('dropstab-circ', {
    body: { coinName },
  });
  if (error) return null;
  return typeof data?.circulatingSupply === 'number' ? data.circulatingSupply : null;
};

export const enrichPayloadWithCircPct = async (supabase, payload) => {
  const entries = extractCoinEntries(payload);
  if (!entries.length) return payload;

  const circList = [];
  const pctList = [];
  const enrichedCoins = [];

  for (const entry of entries) {
    const name = (entry?.name || '').trim();
    const qty = parseQuantity(entry?.quantity);

    let circ = null;
    let pct = null;

    if (name && qty != null && qty > 0) {
      circ = await fetchCircSupplyViaFn(supabase, name);
      if (circ != null && circ > 0) pct = (qty / circ) * 100;
    }

    enrichedCoins.push({ ...entry, circ_supply: circ, pct_circ: pct });
    circList.push(circ != null ? String(circ) : '');
    pctList.push(pct != null ? formatPct(pct) : '');
  }

  payload.coins = JSON.stringify(enrichedCoins);
  payload.coin_circ_supply = circList.join('\n');
  payload.coin_pct_circ = pctList.join('\n');

  return payload;
};