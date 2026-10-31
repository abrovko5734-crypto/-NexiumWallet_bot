import crypto from 'crypto';
export const CUR = ['TON', 'BTC', 'ETH', 'USDT', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX', 'LTC'];
export const ADMIN = String(process.env.ADMIN_ID || '7128871752');
export const WELCOME = Number(process.env.WELCOME_BONUS ?? 100);
export const FEE = 0.003; // комиссия обмена 0.3%
export const R = async (...c) => (await (await fetch(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, {
  method: 'POST', headers: { Authorization: 'Bearer ' + (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN) }, body: JSON.stringify(c)
})).json()).result;
export const tg = (m, b) => fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json());
export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function verify(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash'); p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  if (crypto.createHmac('sha256', key).update(str).digest('hex') !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
export async function getUser(id, name = '') {
  id = String(id);
  let u = await R('GET', 'user:' + id);
  if (u) return JSON.parse(u);
  u = { id, name, wid: '', bal: {}, tx: [], banned: false, at: Date.now() };
  for (let i = 0; i < 8 && !u.wid; i++) {
    const w = 'NX' + (1000000 + Math.floor(Math.random() * 8999999));
    if (await R('SET', 'wid:' + w, id, 'NX')) u.wid = w;
  }
  if (WELCOME > 0) { add(u, 'USDT', WELCOME); log(u, { t: 'bonus', c: 'USDT', a: WELCOME }); }
  await save(u); await R('SADD', 'users', id);
  return u;
}
export const save = u => R('SET', 'user:' + u.id, JSON.stringify(u));
export const log = (u, t) => { u.tx.unshift({ ...t, ts: Date.now() }); u.tx = u.tx.slice(0, 100); };
export const clean = x => { x = Number(String(x).replace(',', '.')); return Number.isFinite(x) && x > 0 ? Math.round(x * 1e8) / 1e8 : 0; };
export const add = (u, c, a) => { u.bal[c] = Math.round(((u.bal[c] || 0) + a) * 1e8) / 1e8; };

export async function makeCheck(owner, cur, amt) {
  const code = crypto.randomBytes(6).toString('hex');
  await R('SET', 'check:' + code, JSON.stringify({ o: String(owner), c: cur, a: amt }));
  return code;
}
// Чек одноразовый: SET NX гарантирует, что активировать его сможет только один человек
export async function claim(code, user) {
  const raw = await R('GET', 'check:' + code);
  if (!raw) return { err: 'Чек не найден' };
  const ch = JSON.parse(raw);
  if (user.banned) return { err: 'Аккаунт заблокирован' };
  if (ch.o === user.id) return { err: 'Свой чек забрать нельзя' };
  if (!(await R('SET', 'claimed:' + code, user.id, 'NX'))) return { err: 'Чек уже активирован' };
  {
    const o = await getUser(ch.o);
    if ((o.bal[ch.c] || 0) < ch.a) { await R('DEL', 'claimed:' + code); return { err: 'У автора чека недостаточно средств' }; }
    add(o, ch.c, -ch.a); log(o, { t: 'check_out', c: ch.c, a: -ch.a }); await save(o);
  }
  const fresh = await getUser(user.id);
  add(fresh, ch.c, ch.a); log(fresh, { t: 'check_in', c: ch.c, a: ch.a }); await save(fresh);
  tg('sendMessage', { chat_id: ch.o, text: `Ваш чек на ${ch.a} ${ch.c} активирован: ${user.name || 'пользователь'}` }).catch(() => {});
  return { ok: ch };
}

// ---- Промокоды ----
export async function redeemPromo(code, user) {
  code = String(code || '').trim().toUpperCase();
  const raw = code && await R('GET', 'promo:' + code);
  if (!raw) return { err: 'Промокод не найден' };
  const p = JSON.parse(raw);
  if (user.banned) return { err: 'Аккаунт заблокирован' };
  if ((await R('SADD', 'promou:' + code, user.id)) !== 1) return { err: 'Ты уже использовал этот промокод' };
  const n = await R('INCR', 'promon:' + code);
  if (p.max && n > p.max) { await R('DECR', 'promon:' + code); await R('SREM', 'promou:' + code, user.id); return { err: 'Промокод закончился' }; }
  const u = await getUser(user.id); add(u, p.c, p.a); log(u, { t: 'promo', c: p.c, a: p.a }); await save(u);
  return { ok: p, me: u };
}

// ---- Реальные курсы: Binance (с запасными источниками) ----
export const PAIRS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', TON: 'TONUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', TRX: 'TRXUSDT', LTC: 'LTCUSDT' };
export const PAYOUTS = { 30: 1.8, 60: 1.85, 300: 1.9, 900: 1.92 };
const CG = { BTC: 'bitcoin', ETH: 'ethereum', TON: 'the-open-network', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple', DOGE: 'dogecoin', TRX: 'tron', LTC: 'litecoin' };
const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com'];
export async function bget(path) {
  let e;
  for (const h of HOSTS) { try { const r = await fetch(h + path, { signal: AbortSignal.timeout(4000) }); if (r.ok) return await r.json(); } catch (x) { e = x; } }
  throw e || new Error('binance');
}
let RC = { t: 0, d: null };
export async function getRates() {
  if (RC.d && Date.now() - RC.t < 3000) return RC.d;
  const out = { USDT: { p: 1, d: 0, h: 1, l: 1, v: 0 } };
  try {
    const j = await bget('/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(Object.values(PAIRS))));
    for (const t of j) { const c = Object.keys(PAIRS).find(k => PAIRS[k] === t.symbol); if (c) out[c] = { p: +t.lastPrice, d: +t.priceChangePercent, h: +t.highPrice, l: +t.lowPrice, v: +t.quoteVolume }; }
  } catch {
    try {
      const j = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(CG).join(',')}&vs_currencies=usd&include_24hr_change=true`, { signal: AbortSignal.timeout(5000) })).json();
      for (const c in CG) { const x = j[CG[c]]; if (x) out[c] = { p: x.usd, d: x.usd_24h_change || 0, h: x.usd, l: x.usd, v: 0 }; }
    } catch {}
  }
  if (Object.keys(out).length > 1) RC = { t: Date.now(), d: out };
  return RC.d || out;
}
let FC = { t: 0, d: null };
export async function getFx() {
  if (FC.d && Date.now() - FC.t < 36e5) return FC.d;
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) })).json();
    if (j.rates) FC = { t: Date.now(), d: { USD: 1, EUR: j.rates.EUR, UAH: j.rates.UAH, RUB: j.rates.RUB, KZT: j.rates.KZT, PLN: j.rates.PLN, TRY: j.rates.TRY } };
  } catch {}
  return FC.d || { USD: 1, EUR: .92, UAH: 41.5, RUB: 90, KZT: 480, PLN: 4, TRY: 34 };
}
export async function lastPrice(c) {
  if (c === 'USDT') return 1;
  try { return Number((await bget('/api/v3/ticker/price?symbol=' + PAIRS[c])).price); } catch { return (await getRates())[c]?.p; }
}
export async function priceAt(c, ts) { // цена на момент экспирации, а не на момент запроса
  try { const j = await bget(`/api/v3/klines?symbol=${PAIRS[c]}&interval=1s&startTime=${Math.floor(ts / 1000) * 1000}&limit=1`); if (j[0]) return Number(j[0][1]); } catch {}
  return lastPrice(c);
}
