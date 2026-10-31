import crypto from 'crypto';
export const CUR = ['TON', 'BTC', 'ETH', 'USDT', 'SOL'];
export const ADMIN = String(process.env.ADMIN_ID || '7128871752');
export const R = async (...c) => (await (await fetch(process.env.KV_REST_API_URL, {
  method: 'POST', headers: { Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN }, body: JSON.stringify(c)
})).json()).result;
export const tg = (m, b) => fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json());

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
  await save(u); await R('SADD', 'users', id);
  return u;
}
export const save = u => R('SET', 'user:' + u.id, JSON.stringify(u));
export const log = (u, t) => { u.tx.unshift({ ...t, ts: Date.now() }); u.tx = u.tx.slice(0, 40); };
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
  if (!(await R('SET', 'claimed:' + code, user.id, 'NX'))) return { err: 'Чек уже активирован' };
  if (ch.o !== ADMIN) {
    const o = await getUser(ch.o);
    if ((o.bal[ch.c] || 0) < ch.a) { await R('DEL', 'claimed:' + code); return { err: 'У автора чека недостаточно средств' }; }
    add(o, ch.c, -ch.a); log(o, { t: 'check_out', c: ch.c, a: -ch.a }); await save(o);
  }
  const fresh = await getUser(user.id);
  add(fresh, ch.c, ch.a); log(fresh, { t: 'check_in', c: ch.c, a: ch.a }); await save(fresh);
  return { ok: ch };
}
