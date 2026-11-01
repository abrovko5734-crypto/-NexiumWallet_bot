import crypto from 'crypto';
import { R, add, log, save, clean, rnd, floor8, checkSubs, cfg, bump } from './core.js';

const crypto_int = n => crypto.randomInt(0, n);
const STATS = []; // обещания записи статистики; дожидаемся их в конце запроса (иначе serverless может оборвать запись)

// ================= Ежедневный кейс =================
export const DAILY = [[0.01, 600], [0.02, 440], [0.03, 300], [0.04, 200], [0.05, 140], [0.06, 100], [0.07, 70], [0.08, 50], [0.09, 36], [0.1, 24],
  [0.15, 14], [0.2, 10], [0.3, 6], [0.4, 4], [0.5, 3], [0.6, 2], [0.7, 1.4], [0.8, 1], [0.9, 0.7], [1, 0.5]];
export function pick(table) {
  const total = table.reduce((s, x) => s + x[1], 0); let r = rnd() * total;
  for (let i = 0; i < table.length; i++) { r -= table[i][1]; if (r < 0) return i; }
  return table.length - 1;
}
export const dailyPublic = () => { const t = DAILY.reduce((s, x) => s + x[1], 0); return DAILY.map(([a, w]) => ({ a, p: Math.round(w / t * 10000) / 100 })); };
const cdMs = cf => Math.round(cf.caseHours * 36e5);
// Сколько осталось ждать: кулдаун задаёт админ; «сброс всем» делает кейс доступным у тех, кто открывал его до сброса
export const cdLeft = (me, cf) => { const last = me.case?.t || 0; if (last < cf.resetAt) return 0; return Math.max(0, last + cdMs(cf) - Date.now()); };

export async function caseInfo(me, cf) {
  const subs = await checkSubs(me.id), last = me.case?.t || 0;
  return { subs, left: cf.cases ? cdLeft(me, cf) : 864e5, off: !cf.cases, hours: cf.caseHours, streak: Date.now() - last < cdMs(cf) * 2 ? (me.case?.s || 0) : 0, total: me.case?.n || 0, sum: me.case?.sum || 0, prizes: dailyPublic(), hist: me.ch || [] };
}
export async function caseOpen(me, cf) {
  if (!cf.cases) return { err: 'Кейсы временно отключены администратором' };
  const l = cdLeft(me, cf);
  if (l > 0) return { err: 'Кейс уже открыт. Следующий через ' + hrs(l) };
  const s = await checkSubs(me.id);
  if (s.bad) return { err: 'Бот не может проверить подписку (' + (s.badCh ? 'канал' : 'чат') + '). Админу: добавь бота администратором' };
  if (!s.ch || !s.chat) return { err: s.ch ? 'Вступи в чат, чтобы открыть кейс' : 'Подпишись на канал, чтобы открыть кейс', subs: s };
  // атомарный замок на конкретное открытие: параллельные запросы не откроют кейс дважды
  if (!(await R('SET', `casecd:${me.id}:${me.ep || 0}:${me.case?.n || 0}`, '1', 'NX', 'PX', Math.max(cdMs(cf), 6e4)))) return { err: 'Кейс уже открыт' };
  const i = pick(DAILY), prize = DAILY[i][0], now = Date.now(), last = me.case?.t || 0;
  const streak = now - last < cdMs(cf) * 2 ? (me.case?.s || 0) + 1 : 1;
  add(me, 'GRAM', prize); log(me, { t: 'case', c: 'GRAM', a: prize });
  me.case = { t: now, s: streak, n: (me.case?.n || 0) + 1, sum: Math.round(((me.case?.sum || 0) + prize) * 1e8) / 1e8 };
  me.ch = [{ a: prize, ts: now }, ...(me.ch || [])].slice(0, 8);
  STATS.push(bump(['INCR', 'st:case:n'], ['INCRBYFLOAT', 'st:case:sum', prize]));
  await save(me);
  return { ok: true, prize, i, streak };
}
const hrs = ms => { const m = Math.ceil(ms / 6e4); return m >= 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин' : m + ' мин'; };

// ================= Общие параметры игр =================
const MINB = { GRAM: 0.01, USDT: 0.1 };
export const limits = cf => ({ GRAM: { min: MINB.GRAM, max: cf.maxBet.GRAM }, USDT: { min: MINB.USDT, max: cf.maxBet.USDT } });
function bet(me, b, cf) {
  const cur = String(b.cur || '').toUpperCase().replace(/^TON$/, 'GRAM'), L = limits(cf), a = clean(b.bet);
  if (!L[cur]) return { err: 'Играть можно в GRAM или USDT' };
  if (!a || a < L[cur].min) return { err: `Минимальная ставка ${L[cur].min} ${cur}` };
  if (a > L[cur].max) return { err: `Максимальная ставка ${L[cur].max} ${cur}` };
  if ((me.bal[cur] || 0) < a) return { err: 'Недостаточно ' + cur };
  return { cur, a };
}
function take(me, cur, a, game) { add(me, cur, -a); log(me, { t: 'game_bet', c: cur, a: -a, g: game }); }
function finish(me, game, cur, a, pay, info = '') {
  if (pay > 0) { add(me, cur, pay); log(me, { t: 'game_win', c: cur, a: pay, g: game }); }
  const g = me.g = me.g || { n: 0, w: 0, p: {} };
  g.n++; if (pay > a) g.w++; if (a > 0 && pay >= a * 10) me.big = 1;
  g.p[cur] = Math.round(((g.p[cur] || 0) + pay - a) * 1e8) / 1e8;
  me.gh = me.gh || []; me.gh.unshift({ g: game, c: cur, b: a, pay, i: info, ts: Date.now() }); me.gh = me.gh.slice(0, 15);
  STATS.push(bump(['INCRBYFLOAT', 'st:in:' + cur, a], ['INCRBYFLOAT', 'st:out:' + cur, pay], ['INCR', 'st:rounds'], ['INCR', 'st:g:' + game]));
}
const dbl = (key, d) => R('GET', key).then(r => r ? JSON.parse(r) : d);

// ================= Crash =================
// Множитель растёт по формуле e^(0.08·t). Точка краха задаётся при старте и хранится только на сервере.
const CR_K = 0.00008;
export const crashMult = ms => Math.floor(Math.exp(CR_K * ms) * 100) / 100;
export const crashPoint = () => { const r = rnd(); if (r < 0.03) return 1; return Math.min(1000, Math.floor(0.97 / (1 - r) * 100) / 100); };
const crashMs = cp => Math.log(cp) / CR_K;
async function crashResolve(me, st, force) {
  const el = Date.now() - st.t, m = crashMult(el);
  if (st.auto && m >= st.auto) return st.cp >= st.auto ? { r: 'win', mult: st.auto } : { r: 'lose', cp: st.cp };
  if (force === 'cash') return st.cp > m ? { r: 'win', mult: m } : { r: 'lose', cp: st.cp };
  if (el >= crashMs(st.cp)) return { r: 'lose', cp: st.cp };
  return null;
}
async function crashClose(me, st, res) {
  await R('DEL', 'g:crash:' + me.id);
  if (res.r === 'win') { const pay = floor8(st.bet * res.mult); finish(me, 'crash', st.cur, st.bet, pay, 'x' + res.mult.toFixed(2)); await save(me); return { over: true, r: 'win', mult: res.mult, pay, cp: st.cp }; }
  finish(me, 'crash', st.cur, st.bet, 0, 'крах x' + st.cp.toFixed(2)); await save(me);
  return { over: true, r: 'lose', cp: st.cp };
}

// ================= Mines =================
const MN = 25;
export const minesMult = (m, k) => { let x = 0.97; for (let i = 0; i < k; i++) x *= (MN - i) / (MN - m - i); return Math.floor(x * 100) / 100; };
const minesPublic = st => ({ bet: st.bet, cur: st.cur, m: st.m, open: st.open, mult: st.open.length ? minesMult(st.m, st.open.length) : 1, next: minesMult(st.m, st.open.length + 1) });

// ================= Колесо удачи =================
export const WHEEL = [[0, 27], [0.5, 24], [1, 20], [1.5, 15], [2, 8], [3, 4], [5, 1.6], [10, 0.4]];

// ================= Платные кейсы =================
export const CASES = {
  bronze: { name: 'Бронзовый', cur: 'GRAM', price: 0.1, t: [[0.2, 2000], [0.5, 2400], [0.8, 2300], [1, 1500], [1.5, 900], [2, 500], [5, 260], [10, 70], [25, 8]] },
  silver: { name: 'Серебряный', cur: 'GRAM', price: 0.5, t: [[0.1, 2200], [0.4, 2600], [0.8, 2200], [1.2, 1300], [2, 800], [4, 330], [8, 140], [20, 25], [50, 3]] },
  gold: { name: 'Золотой', cur: 'GRAM', price: 2, t: [[0, 3200], [0.3, 3000], [0.7, 1800], [1.5, 950], [3, 520], [6, 240], [15, 90], [40, 22], [100, 5]] }
};
export const casesPublic = () => Object.fromEntries(Object.entries(CASES).map(([k, c]) => {
  const tot = c.t.reduce((s, x) => s + x[1], 0);
  return [k, { name: c.name, cur: c.cur, price: c.price, prizes: c.t.map(([m, w]) => ({ m, p: Math.round(w / tot * 1000) / 10 })) }];
}));

// ================= Задания (разовые награды) =================
const QUESTS = [
  { id: 'subs', t: 'Подписаться на канал и вступить в чат', r: 0.05, n: 2, async p(me) { const s = await checkSubs(me.id); return (s.ch ? 1 : 0) + (s.chat ? 1 : 0); } },
  { id: 'case3', t: 'Открыть 3 ежедневных кейса', r: 0.05, n: 3, p: me => me.case?.n || 0 },
  { id: 'case7', t: 'Серия кейсов 7 дней подряд', r: 0.2, n: 7, p: me => me.case?.s || 0 },
  { id: 'g10', t: 'Сыграть 10 раундов', r: 0.05, n: 10, p: me => me.g?.n || 0 },
  { id: 'g50', t: 'Сыграть 50 раундов', r: 0.2, n: 50, p: me => me.g?.n || 0 },
  { id: 'big', t: 'Выиграть x10 и больше в любой игре', r: 0.1, n: 1, p: me => me.big ? 1 : 0 },
  { id: 'ref1', t: 'Пригласить 1 друга', r: 0.05, n: 1, p: me => me.refs || 0 },
  { id: 'ref5', t: 'Пригласить 5 друзей', r: 0.25, n: 5, p: me => me.refs || 0 }
];
async function questList(me) {
  return Promise.all(QUESTS.map(async q => { const p = Math.min(q.n, await q.p(me)); return { id: q.id, t: q.t, r: q.r, n: q.n, p, claimed: !!me.quests?.[q.id] }; }));
}

export async function gameStats() {
  const keys = ['st:rounds', 'st:in:GRAM', 'st:out:GRAM', 'st:in:USDT', 'st:out:USDT', 'st:case:n', 'st:case:sum', 'st:quest:n', 'st:quest:sum', ...['crash', 'mines', 'dice', 'flip', 'wheel', 'upgrade', 'case'].map(g => 'st:g:' + g)];
  const v = await Promise.all(keys.map(k => R('GET', k))), o = {}; keys.forEach((k, i) => { o[k.slice(3)] = +v[i] || 0; });
  return o;
}

// ================= Обработчик действий =================
const FINISHERS = new Set(['crash_state', 'crash_cash', 'mines_pick', 'mines_cash']);
export async function game(action, me, b) {
  const cf = await cfg();
  try { return await run(action, me, b, cf); } finally { await Promise.all(STATS.splice(0)); }
}
async function run(action, me, b, cf) {
  if (!cf.games && !FINISHERS.has(action) && !['g_state', 'case_info', 'case_open', 'quests_list', 'quest_claim'].includes(action)) return { err: 'Игры временно отключены администратором' };
  switch (action) {
    case 'g_state': {
      const cs = await dbl('g:crash:' + me.id, null), mn = await dbl('g:mines:' + me.id, null);
      return { g: { crash: cs ? { t: cs.t, now: Date.now(), bet: cs.bet, cur: cs.cur, auto: cs.auto } : null, mines: mn ? minesPublic(mn) : null, cases: casesPublic(), limits: limits(cf), wheel: WHEEL.map(([m, w]) => ({ m, p: w })), off: !cf.games } };
    }
    case 'case_info': return { case: await caseInfo(me, cf) };
    case 'case_open': {
      const r = await caseOpen(me, cf); if (r.err) return { err: r.err };
      return { done: `🎁 Ты выиграл ${r.prize} GRAM!`, win: { prize: r.prize, i: r.i, streak: r.streak }, case: await caseInfo(me, cf) };
    }
    case 'quests_list': return { quests: await questList(me) };
    case 'quest_claim': {
      const q = QUESTS.find(x => x.id === b.id); if (!q) return { err: 'Задание не найдено' };
      if (me.quests?.[q.id]) return { err: 'Награда уже получена' };
      if ((await q.p(me)) < q.n) return { err: 'Задание ещё не выполнено' };
      if (!(await R('SET', `quest:${me.id}:${q.id}`, '1', 'NX'))) return { err: 'Награда уже получена' };
      me.quests = { ...(me.quests || {}), [q.id]: Date.now() }; add(me, 'GRAM', q.r); log(me, { t: 'quest', c: 'GRAM', a: q.r });
      STATS.push(bump(['INCR', 'st:quest:n'], ['INCRBYFLOAT', 'st:quest:sum', q.r])); await save(me);
      return { done: `✅ Награда за задание: +${q.r} GRAM`, quests: await questList(me) };
    }
    case 'case_buy': {
      const c = CASES[b.id]; if (!c) return { err: 'Кейс не найден' };
      if ((me.bal[c.cur] || 0) < c.price) return { err: 'Недостаточно ' + c.cur };
      take(me, c.cur, c.price, 'case'); const i = pick(c.t), m = c.t[i][0], pay = floor8(c.price * m);
      finish(me, 'case', c.cur, c.price, pay, c.name + ' x' + m); await save(me);
      return { win: { i, m, pay, cur: c.cur, price: c.price }, done: pay > 0 ? `${c.name} кейс: +${pay} ${c.cur}` : `${c.name} кейс: пусто` };
    }
    case 'wheel': {
      const x = bet(me, b, cf); if (x.err) return x;
      take(me, x.cur, x.a, 'wheel'); const i = pick(WHEEL), m = WHEEL[i][0], pay = floor8(x.a * m);
      finish(me, 'wheel', x.cur, x.a, pay, 'x' + m); await save(me);
      return { wheel: { i, m, pay, win: pay > x.a }, done: pay > 0 ? `Колесо: x${m} · +${pay} ${x.cur}` : 'Колесо: 0, повезёт в следующий раз' };
    }
    case 'upgrade': { // Апгрейдер: выбираешь множитель, шанс = 97% / множитель; стрелка попадает в зелёный сектор или нет
      const x = bet(me, b, cf); if (x.err) return x;
      const mult = Math.round(Number(b.mult) * 100) / 100; if (!(mult >= 1.1 && mult <= 100)) return { err: 'Множитель от x1.1 до x100' };
      const chance = Math.floor(97 / mult * 100) / 100;
      take(me, x.cur, x.a, 'upgrade');
      const roll = crypto_int(10000) / 100, win = roll < chance, pay = win ? floor8(x.a * mult) : 0;
      finish(me, 'upgrade', x.cur, x.a, pay, `x${mult} (${chance}%)`); await save(me);
      return { up: { roll, win, pay, mult, chance }, done: win ? `Апгрейд x${mult} удался: +${pay} ${x.cur}` : `Апгрейд x${mult} не удался` };
    }
    case 'dice': {
      const x = bet(me, b, cf); if (x.err) return x;
      const ch = Math.floor(Number(b.chance)), over = b.dir === 'over';
      if (!(ch >= 1 && ch <= 95)) return { err: 'Шанс от 1% до 95%' };
      take(me, x.cur, x.a, 'dice');
      const roll = crypto_int(10000) / 100, win = over ? roll >= 100 - ch : roll < ch, mult = Math.floor(97 / ch * 10000) / 10000;
      const pay = win ? floor8(x.a * mult) : 0; finish(me, 'dice', x.cur, x.a, pay, `${roll.toFixed(2)} (${over ? '>' : '<'} ${over ? (100 - ch).toFixed(2) : ch.toFixed(2)})`); await save(me);
      return { roll, win, pay, mult, done: win ? `Выпало ${roll.toFixed(2)} · +${pay} ${x.cur}` : `Выпало ${roll.toFixed(2)} · проигрыш` };
    }
    case 'flip': {
      const x = bet(me, b, cf); if (x.err) return x; if (!['h', 't'].includes(b.side)) return { err: 'Выбери сторону' };
      take(me, x.cur, x.a, 'flip');
      const res = crypto_int(2) ? 'h' : 't', win = res === b.side, pay = win ? floor8(x.a * 1.94) : 0;
      finish(me, 'flip', x.cur, x.a, pay, res === 'h' ? 'орёл' : 'решка'); await save(me);
      return { res, win, pay, done: win ? `Угадал! +${pay} ${x.cur}` : 'Не угадал' };
    }
    case 'crash_start': {
      const x = bet(me, b, cf); if (x.err) return x;
      const old = await dbl('g:crash:' + me.id, null);
      if (old) { const res = await crashResolve(me, old); if (!res) return { err: 'Раунд уже идёт' }; await crashClose(me, old, res); }
      let auto = Number(b.auto) || 0; if (auto && (auto < 1.01 || auto > 1000)) return { err: 'Авто-вывод от x1.01 до x1000' };
      if (auto) auto = Math.round(auto * 100) / 100;
      take(me, x.cur, x.a, 'crash');
      const st = { t: Date.now(), cp: crashPoint(), bet: x.a, cur: x.cur, auto };
      await R('SET', 'g:crash:' + me.id, JSON.stringify(st), 'EX', 3600); await save(me);
      return { g: { crash: { t: st.t, now: Date.now(), bet: st.bet, cur: st.cur, auto } } };
    }
    case 'crash_state': case 'crash_cash': {
      const st = await dbl('g:crash:' + me.id, null);
      if (!st) return { crash: { none: true } };
      const res = await crashResolve(me, st, action === 'crash_cash' ? 'cash' : '');
      if (!res) return { crash: { run: true, t: st.t, now: Date.now() } };
      const out = await crashClose(me, st, res);
      return { crash: out, done: out.r === 'win' ? `Crash: x${out.mult.toFixed(2)} · +${out.pay} ${st.cur}` : undefined };
    }
    case 'mines_start': {
      const x = bet(me, b, cf); if (x.err) return x;
      if (await R('EXISTS', 'g:mines:' + me.id)) return { err: 'Сначала закончи текущую игру' };
      const m = Math.floor(Number(b.m)); if (!(m >= 1 && m <= 24)) return { err: 'Мин от 1 до 24' };
      take(me, x.cur, x.a, 'mines');
      const cells = [...Array(MN).keys()]; for (let i = MN - 1; i > 0; i--) { const j = crypto_int(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
      const st = { bet: x.a, cur: x.cur, m, mines: cells.slice(0, m), open: [] };
      await R('SET', 'g:mines:' + me.id, JSON.stringify(st), 'EX', 86400); await save(me);
      return { mines: minesPublic(st) };
    }
    case 'mines_pick': {
      const st = await dbl('g:mines:' + me.id, null); if (!st) return { err: 'Игра не начата' };
      const i = Math.floor(Number(b.i)); if (!(i >= 0 && i < MN) || st.open.includes(i)) return { err: 'Клетка недоступна' };
      if (st.mines.includes(i)) {
        await R('DEL', 'g:mines:' + me.id); finish(me, 'mines', st.cur, st.bet, 0, `${st.m} мин, мина`); await save(me);
        return { mines: { over: true, r: 'lose', hit: i, mines: st.mines, open: st.open, bet: st.bet, cur: st.cur } };
      }
      st.open.push(i);
      if (st.open.length === MN - st.m) {
        const mult = minesMult(st.m, st.open.length), pay = floor8(st.bet * mult);
        await R('DEL', 'g:mines:' + me.id); finish(me, 'mines', st.cur, st.bet, pay, `${st.m} мин, x${mult}`); await save(me);
        return { mines: { over: true, r: 'win', mult, pay, mines: st.mines, open: st.open, bet: st.bet, cur: st.cur }, done: `Mines: x${mult} · +${pay} ${st.cur}` };
      }
      await R('SET', 'g:mines:' + me.id, JSON.stringify(st), 'EX', 86400);
      return { mines: minesPublic(st) };
    }
    case 'mines_cash': {
      const st = await dbl('g:mines:' + me.id, null); if (!st) return { err: 'Игра не начата' };
      if (!st.open.length) return { err: 'Открой хотя бы одну клетку' };
      const mult = minesMult(st.m, st.open.length), pay = floor8(st.bet * mult);
      await R('DEL', 'g:mines:' + me.id); finish(me, 'mines', st.cur, st.bet, pay, `${st.m} мин, x${mult}`); await save(me);
      return { mines: { over: true, r: 'win', mult, pay, mines: st.mines, open: st.open, bet: st.bet, cur: st.cur }, done: `Mines: x${mult} · +${pay} ${st.cur}` };
    }
  }
  return null;
}
