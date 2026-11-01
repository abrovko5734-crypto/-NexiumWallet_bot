import { R, tg, getUser, save, add, log, withLock, ASSETS, PAY_ON } from './core.js';
// Crypto Pay API (@CryptoBot). Токен: CRYPTOPAY_TOKEN. Тестовая сеть: CRYPTOPAY_TESTNET=1
const BASE = () => process.env.CRYPTOPAY_TESTNET === '1' ? 'https://testnet-pay.crypt.bot/api/' : 'https://pay.crypt.bot/api/';
export async function cp(method, params = {}) {
  const r = await fetch(BASE() + method, { method: 'POST', headers: { 'Crypto-Pay-API-Token': process.env.CRYPTOPAY_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.error?.name || j.error?.code || 'cryptopay'); e.api = true; throw e; } // определённый отказ API
  return j.result;
}
const ASSET_BACK = Object.fromEntries(Object.entries(ASSETS).map(([k, v]) => [v, k]));

// Создать счёт на пополнение
export async function createDeposit(user, cur, amt) {
  const inv = await cp('createInvoice', { asset: ASSETS[cur], amount: String(amt), description: 'Nexium Wallet: пополнение', payload: String(user.id), expires_in: 3600, allow_comments: false, allow_anonymous: false });
  await R('SET', 'inv:' + inv.invoice_id, JSON.stringify({ id: inv.invoice_id, u: String(user.id), c: cur, a: amt, ts: Date.now() }));
  await R('SADD', 'inv:pending', inv.invoice_id); await R('SADD', 'invu:' + user.id, inv.invoice_id);
  return { id: inv.invoice_id, url: inv.bot_invoice_url || inv.pay_url };
}
// Зачислить оплаченный счёт. Источник правды — API Crypto Pay (а не тело вебхука). Идемпотентно.
export async function settleInvoice(id, locked = false) {
  const raw = await R('GET', 'inv:' + id); if (!raw) return 'unknown';
  const iv = JSON.parse(raw); if (iv.done) return 'done';
  const res = await cp('getInvoices', { invoice_ids: String(id) }), inv = res.items?.[0];
  if (!inv) return 'none';
  if (inv.status === 'expired') { iv.done = 'expired'; await R('SET', 'inv:' + id, JSON.stringify(iv)); await R('SREM', 'inv:pending', id); return 'expired'; }
  if (inv.status !== 'paid') return 'wait';
  if (ASSET_BACK[inv.asset] !== iv.c || Math.abs(Number(inv.amount) - iv.a) > 1e-9) { iv.done = 'mismatch'; await R('SET', 'inv:' + id, JSON.stringify(iv)); await R('SREM', 'inv:pending', id); return 'mismatch'; }
  const credit = async () => {
    if (!(await R('SET', 'invpaid:' + id, '1', 'NX'))) return 'dup';
    try {
      const u = await getUser(iv.u); add(u, iv.c, iv.a); log(u, { t: 'deposit', c: iv.c, a: iv.a }); await save(u);
      iv.done = 'paid'; await R('SET', 'inv:' + id, JSON.stringify(iv)); await R('SREM', 'inv:pending', id);
      tg('sendMessage', { chat_id: iv.u, text: `✅ Пополнение: +${iv.a} ${iv.c}` }).catch(() => {}); return 'paid';
    } catch (e) { await R('DEL', 'invpaid:' + id); throw e; }
  };
  return locked ? credit() : withLock(iv.u, credit);
}
// Выплата на аккаунт @CryptoBot (spend_id = id заявки: повтор безопасен)
export async function payout(wd) {
  try {
    const t = await cp('transfer', { user_id: Number(wd.u), asset: ASSETS[wd.c], amount: String(wd.net), spend_id: wd.id, comment: 'Nexium Wallet: вывод' });
    wd.st = 'done'; wd.tid = t.transfer_id; wd.done = Date.now(); await R('SET', 'wd:' + wd.id, JSON.stringify(wd));
    tg('sendMessage', { chat_id: wd.u, text: `📤 Вывод выполнен: ${wd.net} ${wd.c} → твой аккаунт @CryptoBot` }).catch(() => {}); return { ok: true };
  } catch (e) {
    if (e.api && e.message !== 'INSUFFICIENT_FUNDS') return { ok: false, definite: true, why: e.message };
    wd.st = 'review'; wd.err = e.message; await R('SET', 'wd:' + wd.id, JSON.stringify(wd)); // сеть/нехватка средств у проекта: решает персонал
    tg('sendMessage', { chat_id: process.env.ADMIN_ID, text: `⚠️ Вывод ${wd.id} (${wd.net} ${wd.c}) ждёт решения: ${e.message}` }).catch(() => {});
    return { ok: false, definite: false, why: e.message };
  }
}
// Вернуть монеты по отклонённой/неудавшейся заявке
export async function refundWd(wd, why, locked = false, st = 'rejected') {
  const go = async () => {
    const u = await getUser(wd.u); add(u, wd.c, wd.a); log(u, { t: 'withdraw_back', c: wd.c, a: wd.a }); await save(u);
    wd.st = st; wd.why = why; await R('SET', 'wd:' + wd.id, JSON.stringify(wd));
    tg('sendMessage', { chat_id: wd.u, text: `↩️ Вывод ${wd.a} ${wd.c} отменён, монеты возвращены. ${why || ''}` }).catch(() => {});
  };
  return locked ? go() : withLock(wd.u, go);
}
export { PAY_ON };
