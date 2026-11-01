import { getRates, getFx, klines, rateSource, PAIRS } from '../lib/core.js';
// Публичный прокси курсов: кэш на краю 3 сек, чтобы не упереться в лимиты Binance и обойти блокировки у клиента
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10');
  try {
    if (req.query.sp) { // спарклайны за 24ч
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      const out = {};
      await Promise.all(Object.keys(PAIRS).map(async c => { try { out[c] = (await klines(c, '1h', 24)).map(k => k[3]); } catch {} }));
      return res.json({ s: out });
    }
    const kl = String(req.query.kl || '').toUpperCase(), iv = String(req.query.iv || '1m');
    if (kl) {
      if (!PAIRS[kl] || !['1m', '5m', '15m', '1h'].includes(iv)) return res.status(400).json({ err: 'bad' });
      return res.json({ k: await klines(kl, iv, 60) });
    }
    const [p, fx] = await Promise.all([getRates(), getFx()]);
    res.json({ t: Date.now(), p, fx, src: rateSource() });
  } catch (e) { res.status(502).json({ err: 'rates' }); }
}
