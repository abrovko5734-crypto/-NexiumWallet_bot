import { getRates, getFx, bget, PAIRS } from '../lib/core.js';
// Публичный прокси курсов: кэш на краю 3 сек, чтобы не упереться в лимиты Binance и обойти блокировки у клиента
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10');
  try {
    if (req.query.sp) { // спарклайны за 24ч
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      const out = {};
      await Promise.all(Object.keys(PAIRS).map(async c => { try { out[c] = (await bget(`/api/v3/klines?symbol=${PAIRS[c]}&interval=1h&limit=24`)).map(k => +k[4]); } catch {} }));
      return res.json({ s: out });
    }
    const kl = String(req.query.kl || '').toUpperCase(), iv = String(req.query.iv || '1m');
    if (kl) {
      if (!PAIRS[kl] || !['1m', '5m', '15m', '1h'].includes(iv)) return res.status(400).json({ err: 'bad' });
      const j = await bget(`/api/v3/klines?symbol=${PAIRS[kl]}&interval=${iv}&limit=60`);
      return res.json({ k: j.map(k => [+k[1], +k[2], +k[3], +k[4]]) });
    }
    const [p, fx] = await Promise.all([getRates(), getFx()]);
    res.json({ t: Date.now(), p, fx });
  } catch (e) { res.status(502).json({ err: 'rates' }); }
}
