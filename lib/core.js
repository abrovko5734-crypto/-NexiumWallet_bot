import crypto from 'crypto';
export const CUR = ['GRAM', 'BTC', 'ETH', 'USDT', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX', 'LTC'];
export const ADMIN = String(process.env.ADMIN_ID || '7128871752');
export const LIVE = process.env.LIVE_MODE === '1'; // боевой режим: реальные пополнения/выводы через Crypto Pay
export const PAY_ON = LIVE && !!process.env.CRYPTOPAY_TOKEN;
// монета кошелька -> актив Crypto Pay (GRAM_ASSET: как называется бывший Toncoin в Crypto Pay)
export const ASSETS = { USDT: 'USDT', GRAM: process.env.GRAM_ASSET || 'TON', BTC: 'BTC', ETH: 'ETH', LTC: 'LTC', BNB: 'BNB', TRX: 'TRX', DOGE: 'DOGE' };
export const OPERATOR = process.env.OPERATOR_NAME || 'Администрация Nexium Wallet';
export const CONTACT = '@' + (process.env.CONTACT_USERNAME || 'Keldisqq');
export const FEE = 0.003; // комиссия обмена по умолчанию 0.3%
export const CHANNEL = process.env.CHANNEL_ID || '@NexiumWallet_News';
export const CHAT = process.env.CHAT_ID || '@NexiumWalletNews_Chat';
export const CHANNEL_URL = 'https://t.me/NexiumWallet_News';
export const CHAT_URL = 'https://t.me/NexiumWalletNews_Chat';

export const R = async (...c) => (await (await fetch(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, {
  method: 'POST', headers: { Authorization: 'Bearer ' + (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN) }, body: JSON.stringify(c)
})).json()).result;
export const tg = (m, b) => fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json());
export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---- Роли и права ----
export const ROLES = { owner: 'Владелец', admin: 'Администратор', moderator: 'Модератор', support: 'Поддержка', coder: 'Кодер', tester: 'Тестировщик', user: 'Пользователь' };
export const PERMS = {
  owner: ['wd', 'users', 'ban', 'msg', 'bc', 'ads', 'tickets', 'news', 'stats', 'audit', 'roles', 'cfg', 'logs', 'bugs', 'give', 'reset', 'wid'],
  admin: ['wd', 'users', 'ban', 'msg', 'bc', 'ads', 'tickets', 'news', 'stats', 'audit', 'roles', 'cfg', 'logs', 'bugs', 'reset', 'wid'],
  moderator: ['users', 'ban', 'msg', 'tickets', 'news', 'bugs'],
  support: ['users', 'msg', 'tickets'],
  coder: ['stats', 'cfg', 'logs', 'bugs', 'audit'],
  tester: ['stats', 'bugs', 'logs'],
  user: []
};
export async function roleOf(id) {
  id = String(id); if (id === ADMIN) return 'owner';
  const r = await R('HGET', 'roles', id); return ROLES[r] ? r : 'user';
}
export const audit = (by, act, d = '') => R('LPUSH', 'audit', JSON.stringify({ by: String(by), act, d: String(d).slice(0, 200), ts: Date.now() })).then(() => R('LTRIM', 'audit', 0, 299)).catch(() => {});
export const errlog = (act, e, uid) => R('LPUSH', 'errs', JSON.stringify({ act, m: String(e?.message || e).slice(0, 200), uid: String(uid || ''), ts: Date.now() })).then(() => R('LTRIM', 'errs', 0, 99)).catch(() => {});

// ---- Настройки (хранятся в базе, кэш 5 сек) ----
export const DEF = { fee: FEE, maint: false, maintMsg: 'Технические работы. Скоро вернёмся.', maxSend: 0, wdMin: 1, wdFee: 0, wdAutoMax: 50, wdDaily: 1000, depMin: 1, flags: { send: true, swap: true, p2p: true, checks: true, requests: true, support: true, deposit: true, withdraw: true } };
let CF = { t: 0, d: null };
export async function cfg() {
  if (CF.d && Date.now() - CF.t < 5000) return CF.d;
  let o = {}; try { const raw = await R('GET', 'cfg'); if (raw) o = JSON.parse(raw); } catch {}
  CF = { t: Date.now(), d: { ...DEF, ...o, flags: { ...DEF.flags, ...(o.flags || {}) } } };
  return CF.d;
}
export async function setCfg(p) {
  const c = await cfg(), n = { ...c, flags: { ...c.flags } };
  const num = (v, a, b) => { v = Number(String(v).replace(',', '.')); return Number.isFinite(v) && v >= a && v <= b ? v : null; };
  if (p.fee !== undefined && p.fee !== '') { const x = num(p.fee, 0, 10); if (x === null) return { err: 'Комиссия обмена: 0–10 %' }; n.fee = x / 100; }
  if (p.maxSend !== undefined && p.maxSend !== '') { const x = num(p.maxSend, 0, 1e7); if (x === null) return { err: 'Лимит перевода: 0–10 000 000 USD (0 = без лимита)' }; n.maxSend = x; }
  for (const [k, a, b, m] of [['wdMin', 0, 1e6, 'Мин. вывод'], ['wdAutoMax', 0, 1e7, 'Порог ручной проверки'], ['wdDaily', 0, 1e7, 'Дневной лимит вывода'], ['depMin', 0, 1e6, 'Мин. пополнение']]) if (p[k] !== undefined && p[k] !== '') { const x = num(p[k], a, b); if (x === null) return { err: m + ': некорректное значение (USD)' }; n[k] = x; }
  if (p.wdFee !== undefined && p.wdFee !== '') { const x = num(p.wdFee, 0, 20); if (x === null) return { err: 'Комиссия вывода: 0–20 %' }; n.wdFee = x / 100; }
  if (typeof p.maint === 'boolean') n.maint = p.maint;
  if (typeof p.maintMsg === 'string') n.maintMsg = p.maintMsg.trim().slice(0, 200) || DEF.maintMsg;
  if (p.flags && typeof p.flags === 'object') for (const k of Object.keys(DEF.flags)) if (typeof p.flags[k] === 'boolean') n.flags[k] = p.flags[k];
  await R('SET', 'cfg', JSON.stringify(n)); CF = { t: 0, d: null };
  return { cfg: await cfg() };
}
export const pubCfg = c => ({ live: LIVE, pay: PAY_ON, assets: Object.keys(ASSETS), wdMin: c.wdMin, wdFee: c.wdFee, wdAutoMax: c.wdAutoMax, wdDaily: c.wdDaily, depMin: c.depMin, fee: c.fee, maint: c.maint, maintMsg: c.maintMsg, maxSend: c.maxSend, flags: c.flags });
export const bump = (...c) => Promise.all(c.map(x => R(...x))).catch(() => {}); // счётчики статистики

// Блокировка на пользователя: защита от двойных кликов и параллельных запросов (двойное списание/начисление)
export const lock = async id => (await R('SET', 'lock:' + id, '1', 'NX', 'PX', 6000)) === 'OK';
export const unlock = id => R('DEL', 'lock:' + id).catch(() => {});

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
  if (u) { u = JSON.parse(u); let ch = migrate(u); if (LIVE && !u.live) { u.live = true; u.bal = {}; u.tx = []; u.stakes = []; u.open = []; ch = true; } if (ch) await save(u); return u; }
  u = { id, name, wid: '', bal: {}, tx: [], banned: false, at: Date.now(), live: LIVE };
  for (let i = 0; i < 8 && !u.wid; i++) {
    const w = 'NX' + (1000000 + Math.floor(Math.random() * 8999999));
    if (await R('SET', 'wid:' + w, id, 'NX')) u.wid = w;
  }
  await save(u); await R('SADD', 'users', id);
  return u;
}
function migrate(u) { // старые данные с монетой TON переносим на GRAM
  let ch = false;
  if (u.bal && u.bal.TON !== undefined) { u.bal.GRAM = Math.round(((u.bal.GRAM || 0) + u.bal.TON) * 1e8) / 1e8; delete u.bal.TON; ch = true; }
  const fix = o => { if (o && o.c === 'TON') { o.c = 'GRAM'; ch = true; } };
  (u.tx || []).forEach(fix); (u.stakes || []).forEach(fix); (u.gh || []).forEach(fix);
  if (u.g?.p?.TON !== undefined) { u.g.p.GRAM = (u.g.p.GRAM || 0) + u.g.p.TON; delete u.g.p.TON; ch = true; }
  (u.open || []).concat(u.done || []).forEach(t => { if (t.coin === 'TON') { t.coin = 'GRAM'; ch = true; } });
  if ((u.fav || []).includes('TON')) { u.fav = [...new Set(u.fav.map(nc))]; ch = true; }
  return ch;
}
export const save = u => R('SET', 'user:' + u.id, JSON.stringify(u));
export const log = (u, t) => { u.tx.unshift({ ...t, ts: Date.now() }); u.tx = u.tx.slice(0, 100); };
export const clean = x => { x = Number(String(x).replace(',', '.')); return Number.isFinite(x) && x > 0 ? Math.round(x * 1e8) / 1e8 : 0; };
export const add = (u, c, a) => { u.bal[c] = Math.round(((u.bal[c] || 0) + a) * 1e8) / 1e8; };
export const nc = c => String(c ?? '').toUpperCase() === 'TON' ? 'GRAM' : c; // монета TON переименована в GRAM
export const floor8 = x => Math.floor(x * 1e8 + 1e-6) / 1e8;
// Криптостойкий random [0,1)
export const rnd = () => crypto.randomInt(0, 2 ** 47) / 2 ** 47;

export async function makeCheck(owner, cur, amt) {
  const code = crypto.randomBytes(6).toString('hex');
  await R('SET', 'check:' + code, JSON.stringify({ o: String(owner), c: cur, a: amt }));
  return code;
}
// Чек одноразовый: SET NX гарантирует, что активировать его сможет только один человек
export async function claim(code, user) {
  const raw = await R('GET', 'check:' + code);
  if (!raw) return { err: 'Чек не найден' };
  const ch = JSON.parse(raw); ch.c = nc(ch.c);
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

// ---- Реальные курсы: несколько независимых источников, пока не соберём все монеты ----
export const PAIRS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', GRAM: 'GRAMUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', TRX: 'TRXUSDT', LTC: 'LTCUSDT' };
export const PAYOUTS = { 30: 1.8, 60: 1.85, 300: 1.9, 900: 1.92 };
const COINS = Object.keys(PAIRS);
// Gram (бывш. Toncoin): на биржах пара называется GRAMUSDT, старая TONUSDT может быть заморожена на прежней цене,
// поэтому берём её только как запасной вариант, а итоговую цену выбираем по медиане нескольких источников.
const SYMS = c => c === 'GRAM' ? ['GRAMUSDT', 'TONUSDT'] : [PAIRS[c]];
const CG = { BTC: 'bitcoin', ETH: 'ethereum', GRAM: 'the-open-network', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple', DOGE: 'dogecoin', TRX: 'tron', LTC: 'litecoin' };
const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com', 'https://api.binance.us'];
const num = x => { x = Number(x); return Number.isFinite(x) ? x : 0; };
const jget = async (url, ms = 4000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Mozilla/5.0 NexiumWallet' } });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
};
export async function bget(path) {
  let e;
  for (const h of HOSTS) { try { return await jget(h + path); } catch (x) { e = x; } }
  throw e || new Error('binance');
}
// Берём первую существующую пару из списка кандидатов
const byFirst = (c, get) => { for (const sym of SYMS(c)) { const t = get(sym); if (t) return t; } return null; };
const memo = (fn, ttl) => { let t = 0, d = null; return async () => { if (d && Date.now() - t < ttl) return d; d = await fn(); t = Date.now(); return d; }; };
const SOURCES = [
  ['Binance', async () => {
    const o = {}, rows = {};
    const rest = COINS.filter(c => c !== 'GRAM').map(c => PAIRS[c]);
    const put = t => { rows[t.symbol] = t; };
    await Promise.all([
      bget('/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(rest))).then(j => j.forEach(put)).catch(() => {}),
      ...SYMS('GRAM').map(sym => bget('/api/v3/ticker/24hr?symbol=' + sym).then(put).catch(() => {}))
    ]);
    for (const c of COINS) { const t = byFirst(c, sym => rows[sym]); if (t) o[c] = { p: num(t.lastPrice), d: num(t.priceChangePercent), h: num(t.highPrice), l: num(t.lowPrice), v: num(t.quoteVolume) }; }
    return o;
  }],
  ['Bybit', async () => {
    const j = await jget('https://api.bybit.com/v5/market/tickers?category=spot'), m = {}; for (const t of j.result.list) m[t.symbol] = t;
    const o = {}; for (const c of COINS) { const t = byFirst(c, sym => m[sym]); if (t) o[c] = { p: num(t.lastPrice), d: num(t.price24hPcnt) * 100, h: num(t.highPrice24h), l: num(t.lowPrice24h), v: num(t.turnover24h) }; }
    return o;
  }],
  ['OKX', async () => {
    const j = await jget('https://www.okx.com/api/v5/market/tickers?instType=SPOT'), m = {}; for (const t of j.data) m[t.instId.replace('-', '')] = t;
    const o = {}; for (const c of COINS) { const t = byFirst(c, sym => m[sym]); if (t) { const p = num(t.last), op = num(t.open24h); o[c] = { p, d: op ? (p / op - 1) * 100 : 0, h: num(t.high24h), l: num(t.low24h), v: num(t.volCcy24h) }; } }
    return o;
  }],
  ['CoinGecko', memo(async () => {
    const j = await jget(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${Object.values(CG).join(',')}&price_change_percentage=24h`, 5000);
    const o = {}; for (const t of j) { const c = COINS.find(k => CG[k] === t.id); if (c) o[c] = { p: num(t.current_price), d: num(t.price_change_percentage_24h), h: num(t.high_24h), l: num(t.low_24h), v: num(t.total_volume) }; }
    return o;
  }, 20000)]
];
let RC = { t: 0, d: null, src: '' };
export const rateSource = () => RC.src;
export async function getRates() {
  if (RC.d && Date.now() - RC.t < 3000) return RC.d;
  const got = await Promise.allSettled(SOURCES.map(([, fn]) => fn()));
  const out = { USDT: { p: 1, d: 0, h: 1, l: 1, v: 0 } }, used = new Set();
  got.forEach((g, i) => { if (g.status === 'rejected') console.error('rates', SOURCES[i][0], g.reason?.message); });
  for (const c of COINS) {
    const cand = [];
    got.forEach((g, i) => { const x = g.status === 'fulfilled' && g.value[c]; if (x && x.p > 0) cand.push({ ...x, src: SOURCES[i][0] }); });
    if (!cand.length) continue;
    // Медиана отсекает источник с замороженной/устаревшей ценой
    const ps = cand.map(x => x.p).sort((a, b) => a - b), n = ps.length;
    let med = n % 2 ? ps[(n - 1) / 2] : (ps[n / 2 - 1] + ps[n / 2]) / 2;
    if (n % 2 === 0 && ps[n / 2] / ps[n / 2 - 1] > 1.03) { const cg = cand.find(x => x.src === 'CoinGecko'); med = cg ? cg.p : ps[n / 2 - 1]; }
    const good = cand.filter(x => Math.abs(x.p / med - 1) <= 0.03); // источники, которые согласуются с медианой
    good.forEach(x => used.add(x.src));
    const best = good.sort((x, y) => Math.abs(x.p / med - 1) - Math.abs(y.p / med - 1))[0] || cand[0];
    out[c] = { p: best.p, d: best.d, h: Math.max(best.h || best.p, best.p), l: Math.min(best.l || best.p, best.p), v: best.v };
  }
  if (Object.keys(out).length > 1) RC = { t: Date.now(), d: out, src: [...used].join(' · ') };
  return RC.d || out;
}
let FC = { t: 0, d: null };
export async function getFx() {
  if (FC.d && Date.now() - FC.t < 36e5) return FC.d;
  try {
    const j = await jget('https://open.er-api.com/v6/latest/USD');
    if (j.rates) FC = { t: Date.now(), d: { USD: 1, EUR: j.rates.EUR, UAH: j.rates.UAH, RUB: j.rates.RUB, KZT: j.rates.KZT, PLN: j.rates.PLN, TRY: j.rates.TRY } };
  } catch {}
  return FC.d || { USD: 1, EUR: .92, UAH: 41.5, RUB: 90, KZT: 480, PLN: 4, TRY: 34 };
}
export async function lastPrice(c) {
  if (c === 'USDT') return 1;
  return (await getRates())[c]?.p;
}
export async function priceAt(c, ts) { // цена на момент экспирации, а не на момент запроса
  for (const sym of SYMS(c)) {
    try { const j = await bget(`/api/v3/klines?symbol=${sym}&interval=1s&startTime=${Math.floor(ts / 1000) * 1000}&limit=1`); const px = Number(j[0]?.[1]); const ref = (await getRates())[c]?.p; if (px && (!ref || Math.abs(px / ref - 1) < 0.1)) return px; } catch {}
  }
  return lastPrice(c);
}
// Свечи [open, high, low, close] с запасным источником (Bybit); отбрасываем пару, если её цена расходится с рынком (заморожена)
export async function klines(c, iv, limit) {
  const ref = (await getRates())[c]?.p, okK = k => k.length && (!ref || Math.abs(k[k.length - 1][3] / ref - 1) < 0.1);
  const m = { '1m': '1', '5m': '5', '15m': '15', '1h': '60' }[iv];
  for (const sym of SYMS(c)) {
    try { const k = (await bget(`/api/v3/klines?symbol=${sym}&interval=${iv}&limit=${limit}`)).map(k => [+k[1], +k[2], +k[3], +k[4]]); if (okK(k)) return k; } catch {}
    try { const j = await jget(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${m}&limit=${limit}`); const k = j.result.list.reverse().map(k => [+k[1], +k[2], +k[3], +k[4]]); if (okK(k)) return k; } catch {}
  }
  throw new Error('klines');
}

// Блокировка пользователя для фоновых операций (вебхук, cron, решения персонала) с ожиданием
export async function withLock(id, fn) {
  for (let i = 0; i < 12; i++) { if (await lock(id)) { try { return await fn(); } finally { await unlock(id); } } await new Promise(r => setTimeout(r, 400)); }
  throw new Error('busy');
}
