import { CUR, ADMIN, R, verify, getUser, save, log, clean, add, makeCheck, tg, getRates, lock, unlock, nc, cfg, setCfg, pubCfg, ROLES, PERMS, roleOf, audit, errlog, LIVE, PAY_ON, TON_ON, ASSETS, CONTACT, withLock } from '../lib/core.js';
import { tonInfo, scanTon, creditDeposit, createClaim, TON_COINS } from '../lib/ton.js';
import { cp, createDeposit, settleInvoice, payout, refundWd } from '../lib/pay.js';
import { resetUser, resetAll, clearOffers, userCard } from '../lib/admin.js';
import { checkAlerts } from '../lib/alerts.js';

async function find(q) {
  q = String(q || '').trim().toUpperCase();
  if (/^\d+$/.test(q)) return (await R('EXISTS', 'user:' + q)) ? getUser(q) : null;
  const id = await R('GET', 'wid:' + q);
  return id ? getUser(id) : null;
}
const okUrl = u => /^https?:\/\/[^\s]+$/i.test(u);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const jl = async (key, from = 0, to = 99) => ((await R('LRANGE', key, from, to)) || []).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
const getJ = async k => { const r = await R('GET', k); return r ? JSON.parse(r) : null; };
const many = async (prefix, ids) => (await Promise.all(ids.map(i => getJ(prefix + i)))).filter(Boolean);
const allAds = async () => {
  const ids = (await R('SMEMBERS', 'ads')) || [];
  const rows = await Promise.all(ids.map(async i => { const r = await R('GET', 'ad:' + i); if (!r) { await R('SREM', 'ads', i); return null; } return JSON.parse(r); }));
  return rows.filter(Boolean).sort((a, b) => b.ts - a.ts);
};
const READ_ONLY = new Set(['me', 'p2p_list', 'ad_list', 'ad_click', 'news_list', 'req_list', 'tk_list', 'a_dash', 'a_users', 'a_cfg_get', 'a_audit', 'a_errs', 'a_health', 'a_roles', 'a_tk_list', 'a_bug_list', 'a_ad_list', 'a_src', 'a_user', 'dep_list', 'wd_list', 'ton_info', 'a_wd_list', 'a_solv', 'a_dep_list']);
// какие действия можно отключить флагом
const FLAG = { send: 'send', swap: 'swap', dep_new: 'deposit', ton_claim: 'deposit', wd_new: 'withdraw', p2p_make: 'p2p', p2p_buy: 'p2p', mkcheck: 'checks', req_make: 'requests', req_pay: 'requests', tk_new: 'support', tk_reply: 'support' };

export default async function handler(req, res) {
  const b0 = req.body || {}, tu0 = verify(b0.initData);
  if (!tu0) return res.status(401).json({ err: 'Открой приложение через Telegram' });
  const need = !READ_ONLY.has(b0.action);
  if (need && !(await lock(tu0.id))) return res.status(429).json({ err: 'Слишком быстро, подожди секунду' });
  try { return await run(req, res); } finally { if (need) await unlock(tu0.id); }
}

async function run(req, res) {
  const b = req.body || {}, tu = verify(b.initData);
  const me0 = await getUser(tu.id, tu.first_name || tu.username || '');
  let me = me0; const role = await roleOf(tu.id), perms = PERMS[role], staff = role !== 'user';
  const can = p => perms.includes(p);
  const CFG = await cfg();
  const ok = (extra = {}) => res.json({ me, role, roleName: ROLES[role], perms, cfg: pubCfg(CFG), ...extra });
  const fail = err => res.status(400).json({ err });
  if (me.banned) return fail('Аккаунт заблокирован');
  if (CFG.maint && !staff) return res.status(503).json({ err: CFG.maintMsg, maint: true });
  const act = String(b.action || '');
  if (FLAG[act] && CFG.flags[FLAG[act]] === false && !staff) return fail('Раздел временно отключён администратором');
  const FREE = new Set(['me', 'consent', 'news_list', 'ad_list', 'ad_click']);
  if (!me.consent && !FREE.has(act)) return fail('Сначала прими Условия и Политику конфиденциальности');
  const cur = nc(String(b.cur || '').toUpperCase()), amt = clean(b.amt);
  const staffName = () => (me.name || me.wid) + ' (' + ROLES[role] + ')';
  try {
    switch (act) {
      case 'me': return ok();
      case 'send': {
        const to = await find(b.to);
        if (!to || to.id === me.id) return fail('Получатель не найден');
        if (to.banned) return fail('Получатель заблокирован');
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно средств');
        if (CFG.maxSend > 0) { const rt = await getRates(); if (amt * (rt[cur]?.p || 0) > CFG.maxSend) return fail(`Лимит перевода: $${CFG.maxSend}`); }
        const note = txt(b.note, 80);
        add(me, cur, -amt); log(me, { t: 'out', c: cur, a: -amt, w: to.wid, n: note });
        add(to, cur, amt); log(to, { t: 'in', c: cur, a: amt, w: me.wid, n: note });
        await save(me); await save(to);
        tg('sendMessage', { chat_id: to.id, text: `💸 Вам перевод ${amt} ${cur} от ${me.wid}${note ? '\n💬 ' + note : ''}` }).catch(() => {}); return ok({ done: `Отправлено ${amt} ${cur} → ${to.wid}` });
      }
      case 'swap': {
        const f = nc(String(b.from || '').toUpperCase()), t = nc(String(b.to || '').toUpperCase());
        if (!CUR.includes(f) || !CUR.includes(t) || f === t || !amt) return fail('Проверь монеты и сумму');
        if ((me.bal[f] || 0) < amt) return fail('Недостаточно ' + f);
        const rt = await getRates(), pf = rt[f]?.p, pt = rt[t]?.p;
        if (!pf || !pt) return fail('Курс временно недоступен');
        const out = Math.round(amt * pf / pt * (1 - CFG.fee) * 1e8) / 1e8;
        if (out <= 0) return fail('Слишком маленькая сумма');
        add(me, f, -amt); add(me, t, out); log(me, { t: 'swap_out', c: f, a: -amt }); log(me, { t: 'swap_in', c: t, a: out }); await save(me);
        await R('INCR', 'st:swaps');
        return ok({ done: `${amt} ${f} → ${out} ${t}` });
      }
      case 'p2p_list': {
        const ids = (await R('SMEMBERS', 'offers')) || [], list = [];
        for (const i of ids.slice(0, 80)) { const r = await R('GET', 'offer:' + i); if (r) { const o = JSON.parse(r); o.sc = nc(o.sc); o.wc = nc(o.wc); list.push(o); } else await R('SREM', 'offers', i); }
        return ok({ offers: list.sort((x, y) => y.ts - x.ts) });
      }
      case 'p2p_make': {
        const sc = nc(String(b.sc).toUpperCase()), wc = nc(String(b.wc).toUpperCase()), sa = clean(b.sa), wa = clean(b.wa);
        if (!CUR.includes(sc) || !CUR.includes(wc) || sc === wc || !sa || !wa) return fail('Проверь монеты и суммы');
        if ((me.bal[sc] || 0) < sa) return fail('Недостаточно ' + sc);
        const rt = await getRates(), mk = rt[sc]?.p && rt[wc]?.p ? rt[sc].p / rt[wc].p : 0;
        if (mk && Math.abs(wa / sa / mk - 1) > 0.5) return fail('Цена отличается от рыночной более чем на 50%');
        add(me, sc, -sa); await save(me);
        const id = uid();
        await R('SET', 'offer:' + id, JSON.stringify({ id, o: me.id, ow: me.wid, sc, sa, wc, wa, ts: Date.now() })); await R('SADD', 'offers', id);
        return ok({ done: 'Объявление опубликовано' });
      }
      case 'p2p_buy': case 'p2p_cancel': {
        const raw = await R('GET', 'offer:' + b.id); if (!raw) return fail('Объявление уже недоступно');
        const o = JSON.parse(raw), buy = act === 'p2p_buy'; o.sc = nc(o.sc); o.wc = nc(o.wc);
        if (buy && o.o === me.id) return fail('Это твоё объявление');
        if (!buy && o.o !== me.id) return fail('Нет доступа');
        if (buy && (me.bal[o.wc] || 0) < o.wa) return fail('Недостаточно ' + o.wc);
        if ((await R('DEL', 'offer:' + b.id)) !== 1) return fail('Объявление уже недоступно');
        await R('SREM', 'offers', b.id);
        if (buy) {
          const ow = await getUser(o.o);
          add(me, o.wc, -o.wa); add(me, o.sc, o.sa); log(me, { t: 'p2p_buy', c: o.sc, a: o.sa, w: o.ow });
          add(ow, o.wc, o.wa); log(ow, { t: 'p2p_sell', c: o.wc, a: o.wa, w: me.wid }); await save(ow);
          tg('sendMessage', { chat_id: ow.id, text: `🤝 P2P: ${me.wid} купил ${o.sa} ${o.sc}. Вы получили ${o.wa} ${o.wc}` }).catch(() => {});
        } else add(me, o.sc, o.sa);
        await save(me); return ok({ done: buy ? 'Сделка завершена' : 'Объявление снято' });
      }
      case 'fav': {
        const c = nc(String(b.coin || '').toUpperCase()); if (!CUR.includes(c)) return fail('Монета не найдена');
        me.fav = me.fav || []; me.fav = me.fav.includes(c) ? me.fav.filter(x => x !== c) : [...me.fav, c].slice(-12);
        await save(me); return ok();
      }
      case 'notify': { me.nt = b.on !== false; await save(me); return ok({ done: me.nt ? 'Уведомления включены' : 'Уведомления выключены' }); }
      case 'mkcheck': {
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно ' + cur);
        const code = await makeCheck(me.id, cur, amt);
        return ok({ link: `https://t.me/${process.env.BOT_USERNAME || 'NexiumWallet_bot'}?start=c_${code}` });
      }
      case 'consent': { if (b.accept !== true) return fail('Нужно согласие'); me.consent = { v: 1, ts: Date.now() }; await save(me); return ok({ done: 'Спасибо!' }); }
      // ---- реальные пополнения и выводы (Crypto Pay) ----
      case 'ton_info': {
        if (!TON_ON) return fail('Пополнение переводом на Tonkeeper пока не настроено');
        return ok({ ton: tonInfo(me) });
      }
      case 'dep_new': {
        if (!PAY_ON) return fail('Пополнение через @CryptoBot не подключено. Используй перевод на Tonkeeper');
        if (!ASSETS[cur] || !amt) return fail('Проверь монету и сумму');
        const rt = await getRates(), usdv = amt * (rt[cur]?.p || 0);
        if (!usdv) return fail('Курс временно недоступен'); if (usdv < CFG.depMin) return fail(`Минимальное пополнение: $${CFG.depMin}`);
        if ((await R('SCARD', 'invu:' + me.id)) > 200) return fail('Слишком много счетов, обратись в поддержку');
        try { const d = await createDeposit(me, cur, amt); return ok({ pay: d, done: 'Счёт создан' }); }
        catch (e) { await errlog('dep_new', e, me.id); return fail(e.api ? 'Платёжный сервис отклонил счёт: ' + e.message : 'Платёжный сервис недоступен, попробуй позже'); }
      }
      case 'dep_check': { // проверяет и переводы на Tonkeeper, и счета @CryptoBot
        if (!PAY_ON && !TON_ON) return ok(); let paid = 0;
        if (TON_ON) { try { paid += (await scanTon(me.id)).credited || 0; } catch (e) { await errlog('dep_check_ton', e, me.id); } }
        if (PAY_ON) for (const id of ((await R('SMEMBERS', 'invu:' + me.id)) || []).slice(-30)) { const iv = await getJ('inv:' + id); if (iv && !iv.done) { try { if ((await settleInvoice(id, true)) === 'paid') paid++; } catch (e) { await errlog('dep_check', e, me.id); } } }
        me = await getUser(me.id); return ok({ done: paid ? `Зачислено платежей: ${paid}` : 'Новых поступлений пока нет' });
      }
      case 'ton_claim': { // «я перевёл»: заявка на ручную проверку (USDT и спорные случаи)
        if (!TON_ON) return fail('Пополнение переводом на Tonkeeper пока не настроено');
        if (!TON_COINS.includes(cur) || !amt) return fail('Проверь монету и сумму');
        const rt = await getRates(), usdv = amt * (rt[cur]?.p || 0);
        if (usdv && usdv < CFG.depMin) return fail(`Минимальное пополнение: $${CFG.depMin}`);
        const open = (await many('dclaim:', (await R('SMEMBERS', 'dcu:' + me.id)) || [])).filter(c => c.st === 'review');
        if (open.length >= 5) return fail('Уже есть 5 заявок на проверке, дождись ответа');
        const r = await createClaim(me, cur, amt, b.hash, txt(b.note, 100)); if (r.err) return fail(r.err);
        return ok({ done: 'Заявка отправлена. Зачислим после проверки перевода' });
      }
      case 'dep_list': {
        const [i1, i2, i3] = await Promise.all([R('SMEMBERS', 'invu:' + me.id), R('SMEMBERS', 'tonu:' + me.id), R('SMEMBERS', 'dcu:' + me.id)]);
        const [invs, tons, cls] = await Promise.all([many('inv:', (i1 || []).slice(-15)), many('tondep:', (i2 || []).slice(-15)), many('dclaim:', (i3 || []).slice(-15))]);
        const deps = [
          ...invs.map(x => ({ k: 'inv', c: x.c, a: x.a, ts: x.ts, st: x.done === 'paid' ? 'paid' : x.done ? 'rejected' : 'wait' })),
          ...tons.map(x => ({ k: 'ton', c: x.c, a: x.a, ts: x.ts, st: 'paid' })),
          ...cls.map(x => ({ k: 'claim', c: x.c, a: x.a, ts: x.ts, st: x.st, why: x.why || '' }))
        ].sort((x, y) => y.ts - x.ts).slice(0, 20);
        return ok({ deps });
      }
      case 'wd_new': {
        if (!LIVE) return fail('Вывод сейчас недоступен');
        if (!ASSETS[cur] || !amt) return fail('Проверь монету и сумму');
        const auto = b.method === 'auto' && PAY_ON, addr = txt(b.addr, 120);
        if (!auto && addr.length < 6) return fail('Укажи адрес кошелька (например, Tonkeeper), на который отправить выплату');
        if ((me.bal[cur] || 0) < amt) return fail('Недостаточно ' + cur);
        if ((await many('wd:', (await R('SMEMBERS', 'wdu:' + me.id)) || [])).filter(x => x.st === 'review').length >= 5) return fail('У тебя уже 5 активных заявок на вывод. Дождись обработки или отмени лишние');
        const rt = await getRates(), usdv = amt * (rt[cur]?.p || 0);
        if (!usdv) return fail('Курс временно недоступен'); if (usdv < CFG.wdMin) return fail(`Минимальный вывод: $${CFG.wdMin}`);
        const day = new Date().toISOString().slice(0, 10), spent = me.wdDay?.d === day ? me.wdDay.usd : 0;
        if (CFG.wdDaily > 0 && spent + usdv > CFG.wdDaily) return fail(`Дневной лимит вывода: $${CFG.wdDaily}`);
        const fee = Math.round(amt * CFG.wdFee * 1e8) / 1e8, net = Math.round((amt - fee) * 1e8) / 1e8; if (net <= 0) return fail('Слишком маленькая сумма');
        const wd = { id: uid(), u: me.id, w: me.wid, c: cur, a: amt, fee, net, usd: Math.round(usdv * 100) / 100, addr: auto ? '' : addr, method: auto ? 'auto' : 'manual', ts: Date.now(), st: auto && usdv <= CFG.wdAutoMax ? 'pending' : 'review' };
        add(me, cur, -amt); log(me, { t: 'withdraw', c: cur, a: -amt }); me.wdDay = { d: day, usd: spent + usdv };
        if (!auto) me.addrs = [addr, ...(me.addrs || []).filter(x => x !== addr)].slice(0, 5); // запоминаем адреса для быстрого выбора
        await save(me);
        await R('SET', 'wd:' + wd.id, JSON.stringify(wd)); await R('SADD', 'wds', wd.id); await R('SADD', 'wdu:' + me.id, wd.id);
        if (wd.st === 'review') {
          tg('sendMessage', { chat_id: ADMIN, text: `🔎 Заявка на вывод #${wd.id}\n${wd.net} ${wd.c} (≈$${wd.usd})\nПользователь: ${me.wid} (${me.id})\n${wd.addr ? 'Адрес: ' + wd.addr : 'На @CryptoBot пользователя'}\nStaff → Выводы` }).catch(() => {});
          return ok({ wd: { id: wd.id, net: wd.net, c: wd.c, addr: wd.addr, w: me.wid }, done: `Заявка создана. Напиши ${CONTACT}, чтобы получить выплату` });
        }
        const r = await payout(wd);
        if (r.ok) { me = await getUser(me.id); return ok({ done: `Выведено ${net} ${cur} на твой аккаунт @CryptoBot` }); }
        if (r.definite) { await refundWd(wd, '', true); me = await getUser(me.id); return fail(r.why === 'USER_NOT_FOUND' ? 'Открой @CryptoBot и нажми Start, затем повтори вывод' : 'Вывод отклонён: ' + r.why); }
        return ok({ done: 'Заявка принята и ожидает обработки' });
      }
      case 'wd_cancel': {
        const wd = await getJ('wd:' + b.id); if (!wd || wd.u !== me.id) return fail('Заявка не найдена');
        if (wd.st !== 'review') return fail('Эту заявку уже нельзя отменить');
        if ((await R('SET', 'wdbusy:' + wd.id, '1', 'NX', 'EX', 60)) !== 'OK') return fail('Заявка уже обрабатывается');
        await refundWd(wd, 'Отменено пользователем', true, 'cancelled');
        me = await getUser(me.id); const wday = new Date(wd.ts).toISOString().slice(0, 10);
        if (me.wdDay?.d === wday) { me.wdDay.usd = Math.max(0, me.wdDay.usd - (wd.usd || 0)); await save(me); } // отменённая заявка не съедает дневной лимит
        return ok({ done: 'Заявка отменена, монеты возвращены' });
      }
      case 'wd_list': { const ids = (await R('SMEMBERS', 'wdu:' + me.id)) || []; return ok({ wds: (await many('wd:', ids.slice(-15))).sort((x, y) => y.ts - x.ts) }); }
      // ---- адресная книга ----
      case 'ct_save': {
        const n = txt(b.n, 24), t = await find(b.w); if (!t || t.id === me.id) return fail('Пользователь не найден');
        if (!n) return fail('Введи имя контакта');
        me.contacts = (me.contacts || []).filter(c => c.w !== t.wid); if (me.contacts.length >= 30) return fail('Не больше 30 контактов');
        me.contacts.unshift({ n, w: t.wid }); await save(me); return ok({ done: 'Контакт сохранён' });
      }
      case 'ct_del': { me.contacts = (me.contacts || []).filter(c => c.w !== String(b.w)); await save(me); return ok({ done: 'Контакт удалён' }); }
      // ---- запросы платежа ----
      case 'req_make': {
        const to = await find(b.to), note = txt(b.note, 80);
        if (!to || to.id === me.id) return fail('Пользователь не найден');
        if (!CUR.includes(cur) || !amt) return fail('Проверь сумму и монету');
        if ((await R('SCARD', 'reqout:' + me.id)) >= 20) return fail('Слишком много активных запросов');
        const id = uid(); await R('SET', 'req:' + id, JSON.stringify({ id, f: me.id, fw: me.wid, fn: me.name, t: to.id, tw: to.wid, c: cur, a: amt, n: note, ts: Date.now() }), 'EX', 7 * 86400);
        await R('SADD', 'reqout:' + me.id, id); await R('SADD', 'reqin:' + to.id, id);
        tg('sendMessage', { chat_id: to.id, text: `📩 ${me.wid} просит оплатить ${amt} ${cur}${note ? '\n💬 ' + note : ''}`, reply_markup: { inline_keyboard: [[{ text: '💎 Открыть кошелёк', web_app: { url: process.env.APP_URL } }]] } }).catch(() => {});
        return ok({ done: `Запрос отправлен ${to.wid}` });
      }
      case 'req_list': {
        const [i, o] = await Promise.all([R('SMEMBERS', 'reqin:' + me.id), R('SMEMBERS', 'reqout:' + me.id)]);
        const inn = await many('req:', i || []), out = await many('req:', o || []);
        for (const [set, ids, got] of [['reqin:', i || [], inn], ['reqout:', o || [], out]]) for (const id of ids) if (!got.find(r => r.id === id)) await R('SREM', set + me.id, id);
        return ok({ reqIn: inn.sort((x, y) => y.ts - x.ts), reqOut: out.sort((x, y) => y.ts - x.ts) });
      }
      case 'req_pay': case 'req_decline': {
        const r = await getJ('req:' + b.id); if (!r) return fail('Запрос уже недоступен');
        const mine = r.f === me.id;
        if (act === 'req_pay' && r.t !== me.id) return fail('Нет доступа');
        if (act === 'req_decline' && r.t !== me.id && !mine) return fail('Нет доступа');
        if ((await R('DEL', 'req:' + b.id)) !== 1) return fail('Запрос уже недоступен');
        await R('SREM', 'reqin:' + r.t, r.id); await R('SREM', 'reqout:' + r.f, r.id);
        if (act === 'req_decline') { if (!mine) tg('sendMessage', { chat_id: r.f, text: `❌ ${me.wid} отклонил запрос на ${r.a} ${r.c}` }).catch(() => {}); return ok({ done: mine ? 'Запрос отозван' : 'Запрос отклонён' }); }
        if ((me.bal[r.c] || 0) < r.a) { await R('SET', 'req:' + r.id, JSON.stringify(r), 'EX', 86400); await R('SADD', 'reqin:' + r.t, r.id); await R('SADD', 'reqout:' + r.f, r.id); return fail('Недостаточно ' + r.c); }
        const to = await getUser(r.f);
        add(me, r.c, -r.a); log(me, { t: 'out', c: r.c, a: -r.a, w: to.wid, n: r.n }); add(to, r.c, r.a); log(to, { t: 'in', c: r.c, a: r.a, w: me.wid, n: r.n });
        await save(me); await save(to);
        tg('sendMessage', { chat_id: to.id, text: `✅ ${me.wid} оплатил запрос: ${r.a} ${r.c}` }).catch(() => {});
        return ok({ done: `Оплачено ${r.a} ${r.c}` });
      }
      // ---- ценовые оповещения ----
      case 'alert_add': {
        const c = nc(String(b.coin || '').toUpperCase()), p = Number(String(b.price).replace(',', '.'));
        if (!CUR.includes(c) || c === 'USDT' || !(p > 0)) return fail('Проверь монету и цену');
        me.alerts = me.alerts || []; if (me.alerts.length >= 10) return fail('Не больше 10 оповещений');
        const now = (await getRates())[c]?.p || 0; if (now && now === p) return fail('Цена уже равна текущей');
        me.alerts.push({ id: uid(), c, p, dir: p > now ? 'up' : 'down' }); await save(me); await R('SADD', 'alerts:users', me.id);
        return ok({ done: `Оповещение: ${c} ${p > now ? '≥' : '≤'} $${p}` });
      }
      case 'alert_del': { me.alerts = (me.alerts || []).filter(a => a.id !== b.id); await save(me); return ok({ done: 'Оповещение удалено' }); }
      case 'alerts_check': { const n = await checkAlerts(me.id); me = await getUser(me.id); return ok({ fired: n }); }
      // ---- новости и реклама (публично) ----
      case 'news_list': return ok({ news: await jl('news', 0, 19) });
      case 'ad_list': {
        const act2 = (await allAds()).filter(a => a.on && (!a.until || a.until > Date.now()));
        await Promise.all(act2.map(a => R('INCR', 'adv:' + a.id)));
        return ok({ ads: act2.map(({ id, title, text, btn }) => ({ id, title, text, btn })) });
      }
      case 'ad_click': {
        const raw = await R('GET', 'ad:' + b.id); if (!raw) return fail('Реклама недоступна');
        await R('INCR', 'adc:' + b.id); return ok({ url: JSON.parse(raw).url });
      }
      // ---- поддержка и баги (пользователь) ----
      case 'tk_new': {
        const subject = txt(b.subject, 60), text = txt(b.text, 1000); if (!subject || !text) return fail('Заполни тему и сообщение');
        if ((await R('SCARD', 'tk:' + me.id)) >= 15) return fail('Слишком много обращений. Закрой старые.');
        const id = uid(), t = { id, u: me.id, w: me.wid, n: me.name, subject, st: 'open', ts: Date.now(), upd: Date.now(), msgs: [{ f: 'user', t: text, ts: Date.now() }] };
        await R('SET', 'ticket:' + id, JSON.stringify(t)); await R('SADD', 'tickets', id); await R('SADD', 'tk:' + me.id, id);
        tg('sendMessage', { chat_id: ADMIN, text: `🎫 Новое обращение от ${me.wid}: ${subject}` }).catch(() => {});
        return ok({ done: 'Обращение создано' });
      }
      case 'tk_list': {
        const ids = (await R('SMEMBERS', 'tk:' + me.id)) || [], ts = await many('ticket:', ids);
        return ok({ tickets: ts.sort((x, y) => y.upd - x.upd) });
      }
      case 'tk_reply': {
        const t = await getJ('ticket:' + b.id), text = txt(b.text, 1000); if (!t || t.u !== me.id) return fail('Обращение не найдено');
        if (!text) return fail('Пустое сообщение'); if (t.st === 'closed') return fail('Обращение закрыто');
        t.msgs.push({ f: 'user', t: text, ts: Date.now() }); t.msgs = t.msgs.slice(-50); t.st = 'open'; t.upd = Date.now();
        await R('SET', 'ticket:' + t.id, JSON.stringify(t)); return ok({ done: 'Отправлено' });
      }
      case 'tk_close': {
        const t = await getJ('ticket:' + b.id); if (!t || t.u !== me.id) return fail('Обращение не найдено');
        t.st = 'closed'; t.upd = Date.now(); await R('SET', 'ticket:' + t.id, JSON.stringify(t)); return ok({ done: 'Обращение закрыто' });
      }
      case 'bug_new': {
        const title = txt(b.title, 80), text = txt(b.text, 1000); if (!title || !text) return fail('Заполни заголовок и описание');
        if (!(await R('SET', 'bugrl:' + me.id, '1', 'NX', 'EX', 60))) return fail('Подожди минуту перед следующим отчётом');
        const id = uid(); await R('SET', 'bug:' + id, JSON.stringify({ id, u: me.id, w: me.wid, title, text, st: 'new', ts: Date.now(), note: '' })); await R('SADD', 'bugs', id);
        return ok({ done: 'Спасибо! Баг-репорт отправлен' });
      }
    }
    // ---------- панель персонала ----------
    if (!staff) return fail('Нет доступа');
    const need2 = p => can(p) ? null : fail('Недостаточно прав для этого действия');
    const A = (a, d) => audit(me.id, a, d);
    switch (act) {
      case 'a_dash': {
        if (need2('stats')) return;
        const ids = (await R('SMEMBERS', 'users')) || [], day = Date.now() - 864e5;
        const us = await Promise.all(ids.slice(0, 300).map(i => getUser(i))), tot = {};
        us.forEach(u => Object.entries(u.bal).forEach(([c, a]) => tot[c] = (tot[c] || 0) + a));
        const [tk, bg, rl, off, sw] = await Promise.all([R('SMEMBERS', 'tickets'), R('SMEMBERS', 'bugs'), R('HLEN', 'roles'), R('SCARD', 'offers'), R('GET', 'st:swaps')]);
        const tks = await many('ticket:', tk || []), bgs = await many('bug:', bg || []);
        return ok({ dash: { users: ids.length, new24: us.filter(u => u.at > day).length, banned: us.filter(u => u.banned).length, tot, tickets: tks.filter(t => t.st !== 'closed').length, bugs: bgs.filter(x => x.st === 'new').length, staff: rl, offers: off, swaps: +sw || 0 } });
      }
      case 'a_users': {
        if (need2('users')) return;
        const ids = (await R('SMEMBERS', 'users')) || [], us = await Promise.all(ids.slice(0, 300).map(i => getUser(i)));
        const rl = (await R('HGETALL', 'roles')) || [], rm = {}; for (let i = 0; i < rl.length; i += 2) rm[rl[i]] = rl[i + 1];
        return ok({ users: us.sort((x, y) => y.at - x.at).map(u => ({ id: u.id, name: u.name, wid: u.wid, banned: u.banned, role: String(u.id) === ADMIN ? 'owner' : rm[u.id] || 'user', refs: u.refs || 0 })) });
      }
      case 'a_user': {
        if (need2('users')) return;
        const u = await find(b.to); if (!u) return fail('Пользователь не найден');
        return ok({ card: userCard(u, await roleOf(u.id)) });
      }
      case 'a_ban': {
        if (need2('ban')) return;
        const u = await find(b.to); if (!u || u.id === ADMIN) return fail('Пользователь не найден');
        const tr = await roleOf(u.id); if (tr !== 'user' && role !== 'owner') return fail('Нельзя блокировать сотрудников');
        u.banned = !!b.on; await save(u); await A(u.banned ? 'ban' : 'unban', u.wid);
        tg('sendMessage', { chat_id: u.id, text: u.banned ? '⛔ Ваш аккаунт заблокирован администрацией.' : '✅ Ваш аккаунт разблокирован.' }).catch(() => {});
        return ok({ done: u.banned ? 'Заблокирован' : 'Разблокирован' });
      }
      case 'a_msg': {
        if (need2('msg')) return;
        const u = await find(b.to), text = txt(b.text, 3000); if (!u || !text) return fail('Нужны пользователь и текст');
        const r = await tg('sendMessage', { chat_id: u.id, text }); if (!r.ok) return fail('Не удалось отправить (пользователь закрыл бота?)');
        await A('msg', u.wid); return ok({ done: 'Отправлено' });
      }
      case 'a_solv': {
        if (need2('wd')) return;
        const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 3000), liab = {};
        for (let i = 0; i < ids.length; i += 50) (await Promise.all(ids.slice(i, i + 50).map(x => getUser(x)))).forEach(u => Object.entries(u.bal).forEach(([c, a]) => liab[c] = (liab[c] || 0) + a));
        let bal = {}; if (PAY_ON) { try { for (const x of await cp('getBalance')) bal[x.currency_code] = Number(x.available); } catch (e) { return fail('Crypto Pay: ' + e.message); } }
        const pend = await many('wd:', (await R('SMEMBERS', 'wds')) || []);
        return ok({ pay: PAY_ON, solv: Object.keys(ASSETS).map(c => ({ c, liab: +(liab[c] || 0).toFixed(8), real: bal[ASSETS[c]] ?? 0 })), wdPending: pend.filter(x => x.st === 'review').length });
      }
      case 'a_wd_list': {
        if (need2('wd')) return;
        const ids = (await R('SMEMBERS', 'wds')) || [], ws = await many('wd:', ids.slice(-150));
        return ok({ wds: ws.sort((x, y) => (x.st === 'review') !== (y.st === 'review') ? (x.st === 'review' ? -1 : 1) : y.ts - x.ts) });
      }
      case 'a_wd_ok': {
        if (need2('wd')) return;
        if (!PAY_ON) return fail('Crypto Pay не подключён: переведи монеты вручную и нажми «Отметить выплаченным»');
        const wd = await getJ('wd:' + b.id); if (!wd || !['review', 'pending'].includes(wd.st)) return fail('Заявка уже обработана');
        if (!(await R('SET', 'wdbusy:' + wd.id, '1', 'NX', 'EX', 60))) return fail('Заявка уже обрабатывается');
        const r = await payout(wd); await A('wd_ok', `${wd.w} ${wd.net} ${wd.c} → ${r.ok ? 'ok' : r.why}`);
        if (r.ok) return ok({ done: 'Выплачено' }); if (r.definite) { await refundWd(wd, 'Отклонено платёжным сервисом: ' + r.why); return fail('Выплата отклонена (' + r.why + '), монеты возвращены пользователю'); }
        return fail('Выплата не прошла (' + r.why + '). Заявка осталась на проверке, можно повторить');
      }
      case 'a_wd_paid': { // выплата сделана вручную (например, с Tonkeeper)
        if (need2('wd')) return;
        const wd = await getJ('wd:' + b.id); if (!wd || !['review', 'pending'].includes(wd.st)) return fail('Заявка уже обработана');
        if ((await R('SET', 'wdbusy:' + wd.id, '1', 'NX', 'EX', 60)) !== 'OK') return fail('Заявка уже обрабатывается');
        wd.st = 'done'; wd.done = Date.now(); wd.tid = txt(b.tx, 100); wd.by = me.id; await R('SET', 'wd:' + wd.id, JSON.stringify(wd));
        await A('wd_paid', `${wd.w} ${wd.net} ${wd.c}${wd.tid ? ' ' + wd.tid : ''}`);
        tg('sendMessage', { chat_id: wd.u, text: `📤 Вывод выполнен: ${wd.net} ${wd.c}${wd.addr ? '\n→ ' + wd.addr : ''}${wd.tid ? '\n🔗 ' + wd.tid : ''}` }).catch(() => {});
        return ok({ done: 'Отмечено как выплаченное' });
      }
      case 'a_dep_list': {
        if (need2('wd')) return;
        const cls = await many('dclaim:', ((await R('SMEMBERS', 'dclaims')) || []).slice(-150));
        const unm = await many('tonum:', ((await R('SMEMBERS', 'ton:unm')) || []).slice(-50));
        return ok({ claims: cls.sort((x, y) => (x.st === 'review') !== (y.st === 'review') ? (x.st === 'review' ? -1 : 1) : y.ts - x.ts), unm: unm.sort((x, y) => y.ts - x.ts) });
      }
      case 'a_dep_ok': {
        if (need2('wd')) return;
        const cl = await getJ('dclaim:' + b.id); if (!cl || cl.st !== 'review') return fail('Заявка уже обработана');
        if ((await R('SET', 'dcbusy:' + cl.id, '1', 'NX', 'EX', 60)) !== 'OK') return fail('Заявка уже обрабатывается');
        const a = String(b.amt ?? '').trim() ? clean(b.amt) : cl.a;
        if (!a) { await R('DEL', 'dcbusy:' + cl.id); return fail('Некорректная сумма'); }
        try { await creditDeposit(cl.u, cl.c, a, { m: 'ton' }, String(cl.u) === String(me.id)); }
        catch (e) { await R('DEL', 'dcbusy:' + cl.id); throw e; }
        cl.st = 'paid'; cl.paid = a; cl.by = me.id; await R('SET', 'dclaim:' + cl.id, JSON.stringify(cl));
        await A('dep_ok', `${cl.w} ${a} ${cl.c}`); return ok({ done: `Зачислено ${a} ${cl.c}` });
      }
      case 'a_dep_no': {
        if (need2('wd')) return;
        const cl = await getJ('dclaim:' + b.id); if (!cl || cl.st !== 'review') return fail('Заявка уже обработана');
        if ((await R('SET', 'dcbusy:' + cl.id, '1', 'NX', 'EX', 60)) !== 'OK') return fail('Заявка уже обрабатывается');
        cl.st = 'rejected'; cl.why = txt(b.why, 100); cl.by = me.id; await R('SET', 'dclaim:' + cl.id, JSON.stringify(cl));
        tg('sendMessage', { chat_id: cl.u, text: `❌ Заявка на пополнение ${cl.a} ${cl.c} отклонена.${cl.why ? ' ' + cl.why : ''} Если это ошибка, напиши в поддержку.` }).catch(() => {});
        await A('dep_no', `${cl.w} ${cl.a} ${cl.c}`); return ok({ done: 'Заявка отклонена' });
      }
      case 'a_ton_assign': { // привязать неопознанный перевод к пользователю
        if (need2('wd')) return;
        const u = await find(b.to); if (!u) return fail('Пользователь не найден');
        const un = await getJ('tonum:' + b.id); if (!un) return fail('Перевод уже обработан');
        if ((await R('SREM', 'ton:unm', un.id)) !== 1) return fail('Перевод уже обработан');
        try { await creditDeposit(u.id, un.c, un.a, { m: 'ton' }, String(u.id) === String(me.id)); }
        catch (e) { await R('SADD', 'ton:unm', un.id); throw e; }
        await R('DEL', 'tonum:' + un.id); await R('SET', 'tondep:' + un.id, JSON.stringify({ id: un.id, u: u.id, c: un.c, a: un.a, ts: un.ts, st: 'paid', src: un.src })); await R('SADD', 'tonu:' + u.id, un.id);
        await A('ton_assign', `${u.wid} ${un.a} ${un.c}`); return ok({ done: `Зачислено ${un.a} ${un.c} → ${u.wid}` });
      }
      case 'a_wd_no': {
        if (need2('wd')) return;
        const wd = await getJ('wd:' + b.id); if (!wd || !['review', 'pending'].includes(wd.st)) return fail('Заявка уже обработана');
        if (!(await R('SET', 'wdbusy:' + wd.id, '1', 'NX', 'EX', 60))) return fail('Заявка уже обрабатывается');
        await refundWd(wd, txt(b.why, 100)); await A('wd_no', `${wd.w} ${wd.a} ${wd.c}`); return ok({ done: 'Отклонено, монеты возвращены' });
      }
      case 'a_bc': {
        if (need2('bc')) return;
        const text = txt(b.text, 3000); if (!text) return fail('Пустое сообщение');
        const btn = txt(b.btn, 30), url = txt(b.url, 300); if (btn && !okUrl(url)) return fail('Ссылка кнопки должна начинаться с https://');
        const rm = btn ? { inline_keyboard: [[{ text: btn, url }]] } : undefined;
        const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 500); let sent = 0;
        const send = async id => {
          let r = await tg('sendMessage', { chat_id: id, text, parse_mode: 'HTML', reply_markup: rm });
          if (!r.ok && /parse|entit/i.test(r.description || '')) r = await tg('sendMessage', { chat_id: id, text, reply_markup: rm });
          if (r.ok) sent++;
        };
        for (let i = 0; i < ids.length; i += 25) await Promise.all(ids.slice(i, i + 25).map(id => send(id).catch(() => {})));
        await A('broadcast', `${sent}/${ids.length}`); return ok({ done: `Отправлено: ${sent} из ${ids.length}` });
      }
      case 'a_give': {
        if (need2('give')) return;
        if (LIVE && Number(String(b.amt).replace(',', '.')) > 0) return fail('В боевом режиме выдача монет без обеспечения отключена (возможна только корректировка списанием)');
        const u = await find(b.to), n = Number(String(b.amt).replace(',', '.'));
        if (!u) return fail('Пользователь не найден'); if (!CUR.includes(cur) || !n) return fail('Проверь сумму и монету');
        add(u, cur, n); log(u, { t: 'admin', c: cur, a: n }); await save(u); await A('give', `${u.wid} ${n} ${cur}`);
        return ok({ done: `${u.wid}: ${n > 0 ? '+' : ''}${n} ${cur}` });
      }
      case 'a_reset': {
        if (need2('reset')) return;
        if (LIVE) return fail('В боевом режиме сброс счетов отключён: он уничтожил бы деньги пользователей');
        const mode = b.mode === 'full' ? 'full' : 'bal';
        if (!String(b.to || '').trim()) {
          if (b.confirm !== 'СБРОС') return fail('Для сброса ВСЕХ введи слово СБРОС'); if (role !== 'owner') return fail('Массовый сброс — только владелец');
          const n = await resetAll(mode); await A('reset_all', mode); return ok({ done: `Сброшено пользователей: ${n}` });
        }
        const u = await find(b.to); if (!u) return fail('Пользователь не найден');
        if (u.id === ADMIN && b.confirm !== 'СБРОС') return fail('Это аккаунт владельца. Для сброса введи СБРОС');
        await resetUser(u.id, mode); await clearOffers(u.id); await A('reset', u.wid + ' ' + mode);
        return ok({ done: `Сброшено: ${u.wid}` });
      }
      case 'a_setwid': {
        if (need2('wid')) return;
        const u = await find(b.to), w = String(b.wid || '').toUpperCase();
        if (!u) return fail('Пользователь не найден'); if (!/^[A-Z0-9_]{3,16}$/.test(w)) return fail('ID: 3–16 символов, A–Z, 0–9, _');
        if (!(await R('SET', 'wid:' + w, u.id, 'NX'))) return fail('Этот ID занят');
        await R('DEL', 'wid:' + u.wid); await A('setwid', `${u.wid} → ${w}`); u.wid = w; await save(u); return ok({ done: `Новый ID: ${w}` });
      }
      case 'a_note': {
        if (need2('users')) return;
        const u = await find(b.to); if (!u) return fail('Пользователь не найден');
        u.anote = txt(b.text, 300); await save(u); await A('note', u.wid); return ok({ done: 'Заметка сохранена' });
      }
      // ---- роли ----
      case 'a_roles': {
        if (need2('roles')) return;
        const rl = (await R('HGETALL', 'roles')) || [], rows = [];
        for (let i = 0; i < rl.length; i += 2) { const u = await getUser(rl[i]); rows.push({ id: rl[i], role: rl[i + 1], name: u.name, wid: u.wid }); }
        return ok({ staffList: rows });
      }
      case 'a_role_set': {
        if (need2('roles')) return;
        const u = await find(b.to), r = String(b.role || ''); if (!u) return fail('Пользователь не найден');
        if (u.id === ADMIN) return fail('Роль владельца изменить нельзя'); if (!ROLES[r] || r === 'owner') return fail('Неизвестная роль');
        const low = ['moderator', 'support', 'tester', 'user'];
        if (role !== 'owner' && (!low.includes(r) || !low.includes(await roleOf(u.id)))) return fail('Администратор может назначать только модераторов, поддержку и тестировщиков');
        if (r === 'user') await R('HDEL', 'roles', u.id); else await R('HSET', 'roles', u.id, r);
        await A('role', `${u.wid} → ${r}`);
        tg('sendMessage', { chat_id: u.id, text: r === 'user' ? '👤 Ваша роль в Nexium сброшена до пользователя.' : `🛡 Вам назначена роль: ${ROLES[r]}. Панель доступна во вкладке «Staff».` }).catch(() => {});
        return ok({ done: `${u.wid}: ${ROLES[r]}` });
      }
      // ---- новости ----
      case 'a_news_add': {
        if (need2('news')) return;
        const title = txt(b.title, 80), text = txt(b.text, 600); if (!title) return fail('Нужен заголовок');
        await R('LPUSH', 'news', JSON.stringify({ id: uid(), title, text, by: staffName(), ts: Date.now() })); await R('LTRIM', 'news', 0, 29);
        await A('news', title); return ok({ done: 'Новость опубликована', news: await jl('news', 0, 19) });
      }
      case 'a_news_del': {
        if (need2('news')) return;
        const raws = (await R('LRANGE', 'news', 0, 29)) || []; const hit = raws.find(x => { try { return JSON.parse(x).id === b.id; } catch { return false; } });
        if (hit) await R('LREM', 'news', 0, hit); await A('news_del', b.id); return ok({ done: 'Удалено', news: await jl('news', 0, 19) });
      }
      // ---- тикеты ----
      case 'a_tk_list': {
        if (need2('tickets')) return;
        const ids = (await R('SMEMBERS', 'tickets')) || [], ts = await many('ticket:', ids.slice(0, 150));
        return ok({ tickets: ts.sort((x, y) => (x.st === 'closed') - (y.st === 'closed') || y.upd - x.upd) });
      }
      case 'a_tk_reply': {
        if (need2('tickets')) return;
        const t = await getJ('ticket:' + b.id), text = txt(b.text, 1000); if (!t) return fail('Обращение не найдено'); if (!text) return fail('Пустое сообщение');
        t.msgs.push({ f: 'staff', by: staffName(), t: text, ts: Date.now() }); t.msgs = t.msgs.slice(-50); t.st = b.close ? 'closed' : 'answered'; t.upd = Date.now();
        await R('SET', 'ticket:' + t.id, JSON.stringify(t)); await A('ticket_reply', t.w);
        tg('sendMessage', { chat_id: t.u, text: `🎫 Ответ поддержки по «${t.subject}»:\n\n${text}`, reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: process.env.APP_URL } }]] } }).catch(() => {});
        return ok({ done: 'Ответ отправлен' });
      }
      case 'a_tk_close': {
        if (need2('tickets')) return;
        const t = await getJ('ticket:' + b.id); if (!t) return fail('Обращение не найдено');
        t.st = 'closed'; t.upd = Date.now(); await R('SET', 'ticket:' + t.id, JSON.stringify(t)); await A('ticket_close', t.w); return ok({ done: 'Закрыто' });
      }
      // ---- баг-трекер ----
      case 'a_bug_list': {
        if (need2('bugs')) return;
        const ids = (await R('SMEMBERS', 'bugs')) || [], bs = await many('bug:', ids.slice(0, 150));
        return ok({ bugs: bs.sort((x, y) => y.ts - x.ts) });
      }
      case 'a_bug_set': {
        if (need2('bugs')) return;
        const x = await getJ('bug:' + b.id); if (!x) return fail('Не найдено');
        if (['new', 'confirmed', 'fixed', 'wontfix'].includes(b.st)) x.st = b.st; if (b.note !== undefined) x.note = txt(b.note, 300);
        await R('SET', 'bug:' + x.id, JSON.stringify(x)); await A('bug', `${x.id} → ${x.st}`);
        if (b.st === 'fixed') tg('sendMessage', { chat_id: x.u, text: `🐞 Баг «${x.title}» исправлен. Спасибо за репорт!` }).catch(() => {});
        return ok({ done: 'Обновлено' });
      }
      // ---- настройки / система ----
      case 'a_cfg_get': { if (need2('cfg')) return; return ok({ conf: CFG }); }
      case 'a_cfg_set': {
        if (need2('cfg')) return;
        const r = await setCfg({ fee: b.fee, maxSend: b.maxSend, wdMin: b.wdMin, wdFee: b.wdFee, wdAutoMax: b.wdAutoMax, wdDaily: b.wdDaily, depMin: b.depMin, maint: typeof b.maint === 'boolean' ? b.maint : undefined, maintMsg: b.maintMsg, flags: b.flags });
        if (r.err) return fail(r.err); await R('DEL', 'cache:info'); await A('cfg', JSON.stringify({ fee: b.fee, maxSend: b.maxSend, maint: b.maint, flags: b.flags }).slice(0, 150));
        return ok({ conf: r.cfg, done: 'Настройки сохранены' });
      }
      case 'a_health': {
        if (need2('logs')) return;
        const t0 = Date.now(); let redis = false; try { redis = (await R('PING')) === 'PONG'; } catch {}
        const rdMs = Date.now() - t0, t1 = Date.now(); let rates = 0; try { rates = Object.keys(await getRates()).length - 1; } catch {}
        const wh = await tg('getWebhookInfo', {}).catch(() => ({}));
        return ok({ health: { redis, rdMs, rates, rtMs: Date.now() - t1, hook: !!wh.result?.url, hookErr: wh.result?.last_error_message || '', pending: wh.result?.pending_update_count || 0, node: process.version, region: process.env.VERCEL_REGION || '—', commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) } });
      }
      case 'a_errs': { if (need2('logs')) return; return ok({ errs: await jl('errs', 0, 49) }); }
      case 'a_errs_clear': { if (!can('logs') || role === 'tester') return fail('Недостаточно прав'); await R('DEL', 'errs'); await A('errs_clear'); return ok({ done: 'Журнал очищен', errs: [] }); }
      case 'a_audit': { if (need2('audit')) return; return ok({ audit: await jl('audit', 0, 79) }); }
      // ---- реклама ----
      case 'a_ad_list': {
        if (need2('ads')) return;
        const rows = await Promise.all((await allAds()).map(async a => ({ ...a, v: +(await R('GET', 'adv:' + a.id)) || 0, c: +(await R('GET', 'adc:' + a.id)) || 0 })));
        return ok({ ads: rows });
      }
      case 'a_ad_save': {
        if (need2('ads')) return;
        const title = txt(b.title, 60), text = txt(b.text, 160), btn = txt(b.btn || 'Открыть', 24), url = txt(b.url, 300);
        if (!title || !okUrl(url)) return fail('Нужны заголовок и ссылка https://');
        const days = Number(b.days) || 0, id = String(b.id || uid());
        await R('SET', 'ad:' + id, JSON.stringify({ id, title, text, btn, url, on: b.on !== false, until: days ? Date.now() + days * 864e5 : 0, ts: Date.now() }));
        await R('SADD', 'ads', id); await A('ad_save', title); return ok({ done: 'Реклама сохранена' });
      }
      case 'a_ad_toggle': {
        if (need2('ads')) return;
        const raw = await R('GET', 'ad:' + b.id); if (!raw) return fail('Не найдено');
        const a = JSON.parse(raw); a.on = !a.on; await R('SET', 'ad:' + a.id, JSON.stringify(a)); return ok({ done: a.on ? 'Включена' : 'Выключена' });
      }
      case 'a_ad_del': { if (need2('ads')) return; await R('DEL', 'ad:' + b.id); await R('SREM', 'ads', b.id); await A('ad_del', b.id); return ok({ done: 'Удалено' }); }
      case 'a_src': {
        if (need2('stats')) return;
        const tags = (await R('SMEMBERS', 'srcs')) || [];
        const rows = await Promise.all(tags.map(async t => ({ tag: t, n: +(await R('GET', 'src:' + t)) || 0 })));
        return ok({ srcs: rows.sort((x, y) => y.n - x.n) });
      }
    }
  } catch (e) { console.error(e); await errlog(act, e, me.id); return fail('Ошибка сервера'); }
  fail('Неизвестное действие');
}
