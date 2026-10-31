import { CUR, ADMIN, R, verify, getUser, save, log, clean, add, makeCheck } from '../lib/core.js';

async function find(q) {
  q = String(q || '').trim().toUpperCase();
  if (/^\d+$/.test(q)) return (await R('EXISTS', 'user:' + q)) ? getUser(q) : null;
  const id = await R('GET', 'wid:' + q);
  return id ? getUser(id) : null;
}
export default async function handler(req, res) {
  const b = req.body || {}, tu = verify(b.initData);
  if (!tu) return res.status(401).json({ err: 'Открой приложение через Telegram' });
  const me = await getUser(tu.id, tu.first_name || tu.username || ''), isAdmin = String(tu.id) === ADMIN;
  const ok = (extra = {}) => res.json({ me, isAdmin, ...extra });
  const fail = err => res.status(400).json({ err });
  if (me.banned) return fail('Аккаунт заблокирован');
  const cur = String(b.cur || '').toUpperCase(), amt = clean(b.amt);
  try {
    switch (b.action) {
      case 'me': return ok();
      case 'send': {
        const to = await find(b.to);
        if (!to || to.id === me.id) return fail('Получатель не найден');
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно средств');
        add(me, cur, -amt); log(me, { t: 'out', c: cur, a: -amt, w: to.wid });
        add(to, cur, amt); log(to, { t: 'in', c: cur, a: amt, w: me.wid });
        await save(me); await save(to); return ok();
      }
      case 'mkcheck': {
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if (!isAdmin && (me.bal[cur] || 0) < amt) return fail('Недостаточно средств');
        const code = await makeCheck(me.id, cur, amt);
        return ok({ link: `https://t.me/${process.env.BOT_USERNAME || 'NexiumWallet_bot'}?start=c_${code}` });
      }
    }
    if (!isAdmin) return fail('Нет доступа');
    switch (b.action) {
      case 'a_stats': {
        const ids = await R('SMEMBERS', 'users'), tot = {};
        const us = await Promise.all(ids.slice(0, 300).map(i => getUser(i)));
        us.forEach(u => Object.entries(u.bal).forEach(([c, a]) => tot[c] = (tot[c] || 0) + a));
        return ok({ users: us.map(u => ({ id: u.id, name: u.name, wid: u.wid, bal: u.bal, banned: u.banned })), tot });
      }
      case 'a_give': {
        const u = await find(b.to), n = Number(String(b.amt).replace(',', '.'));
        if (!u) return fail('Пользователь не найден');
        if (!CUR.includes(cur) || !n) return fail('Проверь сумму и монету');
        add(u, cur, n); log(u, { t: 'admin', c: cur, a: n }); await save(u);
        return ok({ done: `${u.wid}: ${n > 0 ? '+' : ''}${n} ${cur}` });
      }
      case 'a_setwid': {
        const u = await find(b.to), w = String(b.wid || '').toUpperCase();
        if (!u) return fail('Пользователь не найден');
        if (!/^[A-Z0-9_]{3,16}$/.test(w)) return fail('ID: 3–16 символов, A–Z, 0–9, _');
        if (!(await R('SET', 'wid:' + w, u.id, 'NX'))) return fail('Этот ID занят');
        await R('DEL', 'wid:' + u.wid); u.wid = w; await save(u); return ok({ done: `Новый ID: ${w}` });
      }
      case 'a_ban': {
        const u = await find(b.to);
        if (!u || u.id === ADMIN) return fail('Пользователь не найден');
        u.banned = !!b.on; await save(u); return ok({ done: u.banned ? 'Заблокирован' : 'Разблокирован' });
      }
    }
  } catch (e) { console.error(e); return fail('Ошибка сервера'); }
  fail('Неизвестное действие');
}
