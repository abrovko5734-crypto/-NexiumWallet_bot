import { CUR, ADMIN, R, verify, getUser, save, log, clean, add, makeCheck, PAIRS, PAYOUTS, lastPrice, priceAt, tg } from '../lib/core.js';

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
        await save(me); await save(to);
        tg('sendMessage', { chat_id: to.id, text: `Вам перевод ${amt} ${cur} от ${me.wid}` }).catch(() => {}); return ok();
      }
      case 'trade_open': {
        const sec = Number(b.sec), st = clean(b.amt), coin = String(b.coin || '').toUpperCase();
        if (!PAIRS[coin] || !PAYOUTS[sec] || !['up', 'down'].includes(b.dir)) return fail('Неверные параметры');
        if (st < 1) return fail('Минимальная ставка 1 USDT');
        if (st > 10000) return fail('Максимальная ставка 10 000 USDT');
        if ((me.bal.USDT || 0) < st) return fail('Недостаточно USDT');
        me.open = me.open || []; if (me.open.length >= 5) return fail('Не больше 5 открытых сделок');
        const px = await lastPrice(coin);
        add(me, 'USDT', -st); log(me, { t: 'trade_bet', c: 'USDT', a: -st });
        me.open.push({ id: Date.now().toString(36), coin, dir: b.dir, st, px, k: PAYOUTS[sec], sec, exp: Date.now() + sec * 1000 });
        await save(me); return ok();
      }
      case 'settle': {
        me.open = me.open || []; me.done = me.done || []; me.st = me.st || { n: 0, w: 0, l: 0, pnl: 0 }; const keep = [];
        for (const t of me.open) {
          if (Date.now() < t.exp) { keep.push(t); continue; }
          const cl = await priceAt(t.coin, t.exp), win = t.dir === 'up' ? cl > t.px : cl < t.px, tie = cl === t.px;
          const pay = tie ? t.st : win ? Math.round(t.st * (t.k || 1.85) * 1e8) / 1e8 : 0;
          if (pay) { add(me, 'USDT', pay); log(me, { t: 'trade_win', c: 'USDT', a: pay }); }
          me.st.n++; if (!tie) { win ? me.st.w++ : me.st.l++; } me.st.pnl = Math.round((me.st.pnl + pay - t.st) * 1e8) / 1e8;
          me.done.unshift({ ...t, cl, r: tie ? 'tie' : win ? 'win' : 'lose', pay }); me.done = me.done.slice(0, 20);
        }
        me.open = keep; await save(me); return ok();
      }
      case 'p2p_list': {
        const ids = await R('SMEMBERS', 'offers'), list = [];
        for (const i of ids.slice(0, 60)) { const r = await R('GET', 'offer:' + i); if (r) list.push(JSON.parse(r)); else await R('SREM', 'offers', i); }
        return ok({ offers: list.sort((x, y) => y.ts - x.ts) });
      }
      case 'p2p_make': {
        const sc = String(b.sc).toUpperCase(), wc = String(b.wc).toUpperCase(), sa = clean(b.sa), wa = clean(b.wa);
        if (!CUR.includes(sc) || !CUR.includes(wc) || sc === wc || !sa || !wa) return fail('Проверь монеты и суммы');
        if ((me.bal[sc] || 0) < sa) return fail('Недостаточно ' + sc);
        add(me, sc, -sa); await save(me);
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await R('SET', 'offer:' + id, JSON.stringify({ id, o: me.id, ow: me.wid, sc, sa, wc, wa, ts: Date.now() })); await R('SADD', 'offers', id);
        return ok();
      }
      case 'p2p_buy': case 'p2p_cancel': {
        const raw = await R('GET', 'offer:' + b.id); if (!raw) return fail('Объявление уже недоступно');
        const o = JSON.parse(raw), buy = b.action === 'p2p_buy';
        if (buy && o.o === me.id) return fail('Это твоё объявление');
        if (!buy && o.o !== me.id) return fail('Нет доступа');
        if (buy && (me.bal[o.wc] || 0) < o.wa) return fail('Недостаточно ' + o.wc);
        if ((await R('DEL', 'offer:' + b.id)) !== 1) return fail('Объявление уже недоступно'); // одна сделка на объявление
        await R('SREM', 'offers', b.id);
        if (buy) {
          const ow = await getUser(o.o);
          add(me, o.wc, -o.wa); add(me, o.sc, o.sa); log(me, { t: 'p2p_buy', c: o.sc, a: o.sa, w: o.ow });
          add(ow, o.wc, o.wa); log(ow, { t: 'p2p_sell', c: o.wc, a: o.wa, w: me.wid }); await save(ow);
        } else add(me, o.sc, o.sa);
        await save(me); return ok();
      }
      case 'bonus': {
        const now = Date.now(), last = me.bonus?.t || 0;
        if (now - last < 864e5) return fail(`Бонус уже получен. Приходи через ${Math.ceil((864e5 - (now - last)) / 36e5)} ч`);
        const s = now - last < 1728e5 ? (me.bonus?.s || 0) + 1 : 1, g = Math.min(5 + s * 2, 25);
        add(me, 'USDT', g); log(me, { t: 'bonus', c: 'USDT', a: g }); me.bonus = { t: now, s }; await save(me);
        return ok({ done: `+${g} USDT · серия ${s} дн.` });
      }
      case 'info': {
        const c = await R('GET', 'cache:info'); if (c) return ok({ info: JSON.parse(c) });
        const ids = (await R('SMEMBERS', 'users')).slice(0, 300), us = await Promise.all(ids.map(i => getUser(i))), tot = {}; let tr = 0;
        us.forEach(u => { Object.entries(u.bal).forEach(([k, v]) => tot[k] = (tot[k] || 0) + v); tr += u.st?.n || 0; });
        const top = us.filter(u => u.st?.n).sort((x, y) => y.st.pnl - x.st.pnl).slice(0, 10).map(u => ({ n: u.name || '—', w: u.wid, p: u.st.pnl, t: u.st.n, r: Math.round(u.st.w / u.st.n * 100) }));
        const info = { users: ids.length, tot, tr, top }; await R('SET', 'cache:info', JSON.stringify(info), 'EX', 60);
        return ok({ info });
      }
      case 'mkcheck': {
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно ' + cur);
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
      case 'a_bc': {
        const text = String(b.text || '').trim().slice(0, 1000); if (!text) return fail('Пустое сообщение');
        const ids = (await R('SMEMBERS', 'users')).slice(0, 300); let sent = 0;
        for (let i = 0; i < ids.length; i += 25) await Promise.all(ids.slice(i, i + 25).map(id => tg('sendMessage', { chat_id: id, text }).then(r => { if (r.ok) sent++; }).catch(() => {})));
        return ok({ done: `Отправлено: ${sent} из ${ids.length}` });
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
