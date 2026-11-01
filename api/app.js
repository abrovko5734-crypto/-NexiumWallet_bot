import { CUR, ADMIN, FEE, R, verify, getUser, save, log, clean, add, makeCheck, PAIRS, PAYOUTS, lastPrice, priceAt, tg, getRates, redeemPromo, lock, unlock } from '../lib/core.js';
import { game } from '../lib/games.js';

const STAKE = { 7: 6, 30: 9, 90: 12 }; // дней -> % годовых
async function find(q) {
  q = String(q || '').trim().toUpperCase();
  if (/^\d+$/.test(q)) return (await R('EXISTS', 'user:' + q)) ? getUser(q) : null;
  const id = await R('GET', 'wid:' + q);
  return id ? getUser(id) : null;
}
const okUrl = u => /^https?:\/\/[^\s]+$/i.test(u);
const allAds = async () => {
  const ids = (await R('SMEMBERS', 'ads')) || [];
  const rows = await Promise.all(ids.map(async i => { const r = await R('GET', 'ad:' + i); if (!r) { await R('SREM', 'ads', i); return null; } return JSON.parse(r); }));
  return rows.filter(Boolean).sort((a, b) => b.ts - a.ts);
};
const READ_ONLY = new Set(['me', 'p2p_list', 'info', 'ad_list', 'ad_click', 'g_state', 'case_info']);
export default async function handler(req, res) {
  const b0 = req.body || {}, tu0 = verify(b0.initData);
  if (!tu0) return res.status(401).json({ err: 'Открой приложение через Telegram' });
  const need = !READ_ONLY.has(b0.action);
  if (need && !(await lock(tu0.id))) return res.status(429).json({ err: 'Слишком быстро, подожди секунду' });
  try { return await run(req, res); } finally { if (need) await unlock(tu0.id); }
}
async function run(req, res) {
  const b = req.body || {}, tu = verify(b.initData);
  if (!tu) return res.status(401).json({ err: 'Открой приложение через Telegram' });
  let me = await getUser(tu.id, tu.first_name || tu.username || ''); const isAdmin = String(tu.id) === ADMIN;
  const ok = (extra = {}) => res.json({ me, isAdmin, ...extra });
  const fail = err => res.status(400).json({ err });
  if (me.banned) return fail('Аккаунт заблокирован');
  const cur = String(b.cur || '').toUpperCase(), amt = clean(b.amt);
  try {
    if (/^(g_|case_|crash_|mines_|dice$|flip$)/.test(String(b.action))) {
      const r = await game(b.action, me, b);
      if (!r) return fail('Неизвестное действие');
      if (r.err) return fail(r.err);
      if (!isAdmin && r.case?.subs) delete r.case.subs.why;
      return ok(r);
    }
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
      case 'swap': { // мгновенный обмен по реальному курсу
        const f = String(b.from || '').toUpperCase(), t = String(b.to || '').toUpperCase();
        if (!CUR.includes(f) || !CUR.includes(t) || f === t || !amt) return fail('Проверь монеты и сумму');
        if ((me.bal[f] || 0) < amt) return fail('Недостаточно ' + f);
        const rt = await getRates(), pf = rt[f]?.p, pt = rt[t]?.p;
        if (!pf || !pt) return fail('Курс временно недоступен');
        const out = Math.round(amt * pf / pt * (1 - FEE) * 1e8) / 1e8;
        if (out <= 0) return fail('Слишком маленькая сумма');
        add(me, f, -amt); add(me, t, out); log(me, { t: 'swap_out', c: f, a: -amt }); log(me, { t: 'swap_in', c: t, a: out }); await save(me);
        return ok({ done: `${amt} ${f} → ${out} ${t}` });
      }
      case 'trade_open': {
        const sec = Number(b.sec), st = clean(b.amt), coin = String(b.coin || '').toUpperCase();
        if (!PAIRS[coin] || !PAYOUTS[sec] || !['up', 'down'].includes(b.dir)) return fail('Неверные параметры');
        if (st < 1) return fail('Минимальная ставка 1 USDT');
        if (st > 10000) return fail('Максимальная ставка 10 000 USDT');
        if ((me.bal.USDT || 0) < st) return fail('Недостаточно USDT');
        me.open = me.open || []; if (me.open.length >= 5) return fail('Не больше 5 открытых сделок');
        const px = await lastPrice(coin); if (!px) return fail('Курс временно недоступен');
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
        for (const i of ids.slice(0, 80)) { const r = await R('GET', 'offer:' + i); if (r) list.push(JSON.parse(r)); else await R('SREM', 'offers', i); }
        return ok({ offers: list.sort((x, y) => y.ts - x.ts) });
      }
      case 'p2p_make': {
        const sc = String(b.sc).toUpperCase(), wc = String(b.wc).toUpperCase(), sa = clean(b.sa), wa = clean(b.wa);
        if (!CUR.includes(sc) || !CUR.includes(wc) || sc === wc || !sa || !wa) return fail('Проверь монеты и суммы');
        if ((me.bal[sc] || 0) < sa) return fail('Недостаточно ' + sc);
        const rt = await getRates(), mk = rt[sc]?.p && rt[wc]?.p ? rt[sc].p / rt[wc].p : 0;
        if (mk && Math.abs(wa / sa / mk - 1) > 0.5) return fail('Цена отличается от рыночной более чем на 50%');
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
          tg('sendMessage', { chat_id: ow.id, text: `P2P: ${me.wid} купил ${o.sa} ${o.sc}. Вы получили ${o.wa} ${o.wc}` }).catch(() => {});
        } else add(me, o.sc, o.sa);
        await save(me); return ok();
      }
      case 'fav': {
        const c = String(b.coin || '').toUpperCase(); if (!CUR.includes(c)) return fail('Монета не найдена');
        me.fav = me.fav || []; me.fav = me.fav.includes(c) ? me.fav.filter(x => x !== c) : [...me.fav, c].slice(-12);
        await save(me); return ok();
      }
      case 'stake_open': { // стейкинг (виртуальный): фиксированный APY на срок
        const days = Number(b.days), apy = STAKE[days];
        if (!apy || !CUR.includes(cur) || !amt) return fail('Проверь монету, сумму и срок');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно ' + cur);
        me.stakes = me.stakes || []; if (me.stakes.length >= 10) return fail('Не больше 10 активных стейков');
        add(me, cur, -amt); log(me, { t: 'stake', c: cur, a: -amt });
        me.stakes.push({ id: Date.now().toString(36), c: cur, a: amt, apy, d: days, s: Date.now(), e: Date.now() + days * 864e5 });
        await save(me); return ok({ done: `Стейк ${amt} ${cur} на ${days} дн. · ${apy}% годовых` });
      }
      case 'stake_claim': {
        me.stakes = me.stakes || []; const st = me.stakes.find(x => x.id === b.id); if (!st) return fail('Стейк не найден');
        const full = Date.now() >= st.e, gain = full ? Math.round(st.a * st.apy / 100 * st.d / 365 * 1e8) / 1e8 : 0;
        me.stakes = me.stakes.filter(x => x.id !== b.id);
        add(me, st.c, st.a + gain); log(me, { t: full ? 'stake_win' : 'stake_back', c: st.c, a: st.a + gain }); await save(me);
        return ok({ done: full ? `+${gain} ${st.c} дохода` : 'Досрочно: возвращено тело без дохода' });
      }
      case 'promo': {
        const r = await redeemPromo(b.code, me); if (r.err) return fail(r.err);
        me = r.me; return ok({ done: `Промокод активирован: +${r.ok.a} ${r.ok.c}` });
      }
      case 'info': {
        const c = await R('GET', 'cache:info'); const contact = process.env.CONTACT_USERNAME || '';
        if (c) return ok({ info: { ...JSON.parse(c), contact } });
        const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 300), us = await Promise.all(ids.map(i => getUser(i))), tot = {}; let tr = 0;
        us.forEach(u => { Object.entries(u.bal).forEach(([k, v]) => tot[k] = (tot[k] || 0) + v); tr += u.st?.n || 0; });
        const top = us.filter(u => u.st?.n).sort((x, y) => y.st.pnl - x.st.pnl).slice(0, 10).map(u => ({ n: u.name || '—', w: u.wid, p: u.st.pnl, t: u.st.n, r: Math.round(u.st.w / u.st.n * 100) }));
        const refs = us.filter(u => u.refs).sort((x, y) => y.refs - x.refs).slice(0, 10).map(u => ({ n: u.name || '—', r: u.refs }));
        const info = { users: ids.length, tot, tr, top, refs }; await R('SET', 'cache:info', JSON.stringify(info), 'EX', 60);
        return ok({ info: { ...info, contact } });
      }
      case 'mkcheck': {
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно ' + cur);
        const code = await makeCheck(me.id, cur, amt);
        return ok({ link: `https://t.me/${process.env.BOT_USERNAME || 'NexiumWallet_bot'}?start=c_${code}` });
      }
      // ---- реклама (публично) ----
      case 'ad_list': {
        const act = (await allAds()).filter(a => a.on && (!a.until || a.until > Date.now()));
        await Promise.all(act.map(a => R('INCR', 'adv:' + a.id)));
        return ok({ ads: act.map(({ id, title, text, btn }) => ({ id, title, text, btn })) });
      }
      case 'ad_click': {
        const raw = await R('GET', 'ad:' + b.id); if (!raw) return fail('Реклама недоступна');
        await R('INCR', 'adc:' + b.id); return ok({ url: JSON.parse(raw).url });
      }
    }
    if (!isAdmin) return fail('Нет доступа');
    switch (b.action) {
      case 'a_stats': {
        const ids = await R('SMEMBERS', 'users'), tot = {};
        const us = await Promise.all(ids.slice(0, 300).map(i => getUser(i)));
        us.forEach(u => Object.entries(u.bal).forEach(([c, a]) => tot[c] = (tot[c] || 0) + a));
        return ok({ users: us.map(u => ({ id: u.id, name: u.name, wid: u.wid, bal: u.bal, banned: u.banned, refs: u.refs || 0 })), tot });
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
        const text = String(b.text || '').trim().slice(0, 3000); if (!text) return fail('Пустое сообщение');
        const btn = String(b.btn || '').trim().slice(0, 30), url = String(b.url || '').trim();
        if (btn && !okUrl(url)) return fail('Ссылка кнопки должна начинаться с https://');
        const rm = btn ? { inline_keyboard: [[{ text: btn, url }]] } : undefined;
        const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 500); let sent = 0;
        const send = async id => {
          let r = await tg('sendMessage', { chat_id: id, text, parse_mode: 'HTML', reply_markup: rm });
          if (!r.ok && /parse|entit/i.test(r.description || '')) r = await tg('sendMessage', { chat_id: id, text, reply_markup: rm });
          if (r.ok) sent++;
        };
        for (let i = 0; i < ids.length; i += 25) await Promise.all(ids.slice(i, i + 25).map(id => send(id).catch(() => {})));
        return ok({ done: `Отправлено: ${sent} из ${ids.length}` });
      }
      case 'a_ban': {
        const u = await find(b.to);
        if (!u || u.id === ADMIN) return fail('Пользователь не найден');
        u.banned = !!b.on; await save(u); return ok({ done: u.banned ? 'Заблокирован' : 'Разблокирован' });
      }
      // ---- реклама (админ) ----
      case 'a_ad_list': {
        const ads = await allAds();
        const rows = await Promise.all(ads.map(async a => ({ ...a, v: +(await R('GET', 'adv:' + a.id)) || 0, c: +(await R('GET', 'adc:' + a.id)) || 0 })));
        return ok({ ads: rows });
      }
      case 'a_ad_save': {
        const title = String(b.title || '').trim().slice(0, 60), text = String(b.text || '').trim().slice(0, 160), btn = String(b.btn || 'Открыть').trim().slice(0, 24), url = String(b.url || '').trim();
        if (!title || !okUrl(url)) return fail('Нужны заголовок и ссылка https://');
        const days = Number(b.days) || 0, id = String(b.id || Date.now().toString(36));
        await R('SET', 'ad:' + id, JSON.stringify({ id, title, text, btn, url, on: b.on !== false, until: days ? Date.now() + days * 864e5 : 0, ts: Date.now() }));
        await R('SADD', 'ads', id); return ok({ done: 'Реклама сохранена' });
      }
      case 'a_ad_toggle': {
        const raw = await R('GET', 'ad:' + b.id); if (!raw) return fail('Не найдено');
        const a = JSON.parse(raw); a.on = !a.on; await R('SET', 'ad:' + a.id, JSON.stringify(a)); return ok({ done: a.on ? 'Включена' : 'Выключена' });
      }
      case 'a_ad_del': { await R('DEL', 'ad:' + b.id); await R('SREM', 'ads', b.id); return ok({ done: 'Удалено' }); }
      // ---- промокоды ----
      case 'a_promo_new': {
        const code = String(b.code || '').trim().toUpperCase(), max = Math.floor(Number(b.max)) || 0, n = clean(b.amt);
        if (!/^[A-Z0-9_]{3,20}$/.test(code)) return fail('Код: 3–20 символов, A–Z, 0–9, _');
        if (!CUR.includes(cur) || !n) return fail('Проверь сумму и монету');
        if (!(await R('SET', 'promo:' + code, JSON.stringify({ c: cur, a: n, max }), 'NX'))) return fail('Такой код уже есть');
        await R('SADD', 'promos', code); return ok({ done: `Промокод ${code} создан` });
      }
      case 'a_promo_list': {
        const codes = (await R('SMEMBERS', 'promos')) || [];
        const rows = await Promise.all(codes.map(async c => { const r = await R('GET', 'promo:' + c); return r ? { code: c, ...JSON.parse(r), used: +(await R('GET', 'promon:' + c)) || 0 } : null; }));
        return ok({ promos: rows.filter(Boolean) });
      }
      case 'a_promo_del': { const c = String(b.code || '').toUpperCase(); await R('DEL', 'promo:' + c); await R('SREM', 'promos', c); return ok({ done: 'Удалён' }); }
      // ---- источники трафика ----
      case 'a_src': {
        const tags = (await R('SMEMBERS', 'srcs')) || [];
        const rows = await Promise.all(tags.map(async t => ({ tag: t, n: +(await R('GET', 'src:' + t)) || 0 })));
        return ok({ srcs: rows.sort((x, y) => y.n - x.n) });
      }
    }
  } catch (e) { console.error(e); return fail('Ошибка сервера'); }
  fail('Неизвестное действие');
}
