import { R, tg, getUser, save, add, log, withLock, errlog, TON_ADDR, TON_ON, ADMIN } from './core.js';
// Пополнение переводом на Tonkeeper.
// Пользователь переводит TON (или USDT в сети TON) на адрес проекта и указывает в комментарии свой ID кошелька (memo).
//  • TON: поступления читаются через toncenter, зачисление автоматическое по комментарию (каждая транзакция — один раз).
//  • USDT (jetton) и всё нестандартное: пользователь подаёт заявку, персонал проверяет перевод в Tonkeeper и зачисляет вручную.
//  • Переводы без комментария или с неверным ID попадают в список «неопознанных» — персонал привязывает их к пользователю.
export const TON_COINS = ['GRAM', 'USDT'];
export const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const API = () => process.env.TONCENTER_URL || 'https://toncenter.com/api/v2';

export const tonInfo = u => ({ addr: TON_ADDR, memo: u.wid, jetton: USDT_MASTER });
export function tonLink(memo, cur = 'GRAM', a = 0) {
  const q = new URLSearchParams();
  if (a > 0) q.set('amount', String(Math.round(a * (cur === 'USDT' ? 1e6 : 1e9))));
  q.set('text', memo);
  if (cur === 'USDT') q.set('jetton', USDT_MASTER);
  return `https://app.tonkeeper.com/transfer/${TON_ADDR}?${q}`;
}

// Зачислить деньги пользователю. locked=true — если вызывающий уже держит блокировку этого пользователя
export async function creditDeposit(uid, cur, a, meta = {}, locked = false) {
  const go = async () => {
    const u = await getUser(uid); add(u, cur, a); log(u, { t: 'deposit', c: cur, a, m: meta.m || '' }); await save(u);
    tg('sendMessage', { chat_id: uid, text: `✅ Пополнение: +${a} ${cur}${meta.m === 'ton' ? ' (Tonkeeper)' : ''}` }).catch(() => {});
  };
  return locked ? go() : withLock(uid, go);
}

async function fetchTxs(limit = 40) {
  const r = await fetch(`${API()}/getTransactions?address=${encodeURIComponent(TON_ADDR)}&limit=${limit}`, {
    headers: process.env.TONCENTER_KEY ? { 'X-API-Key': process.env.TONCENTER_KEY } : {}, signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  if (!j.ok) throw new Error('toncenter: ' + (j.error || r.status));
  return j.result || [];
}
// Текст комментария: toncenter отдаёт его в message либо в msg_data.text (base64)
const commentOf = m => {
  if (!m) return '';
  if (typeof m.message === 'string' && m.message) return m.message;
  const t = m.msg_data?.text;
  if (t) { try { return Buffer.from(t, 'base64').toString('utf8'); } catch {} }
  return '';
};

// Просмотр последних входящих транзакций. heldId — пользователь, чья блокировка уже занята вызывающим.
export async function scanTon(heldId = '') {
  if (!TON_ON) return { credited: 0 };
  if ((await R('SET', 'tonscan', '1', 'NX', 'EX', 6)) !== 'OK') return { credited: 0, skipped: true }; // не чаще раза в 6 с
  let txs; try { txs = await fetchTxs(); } catch (e) { await errlog('ton_scan', e); return { credited: 0, err: true }; }
  let credited = 0;
  for (const tx of [...txs].reverse()) { // старые сначала
    const m = tx.in_msg, hash = tx.transaction_id?.hash;
    if (!m || !m.source || !hash) continue; // исходящие и служебные пропускаем
    const val = Number(m.value) / 1e9; if (!(val >= 0.01)) continue; // пыль не учитываем
    if (await R('GET', 'tonrx:' + hash)) continue;
    const memo = commentOf(m).trim().toUpperCase().slice(0, 40), uid = memo ? await R('GET', 'wid:' + memo) : null, ts = (tx.utime || 0) * 1000 || Date.now();
    if (!uid) { // нет комментария или ID неизвестен: сохраняем для ручного разбора
      if ((await R('SET', 'tonrx:' + hash, 'unm', 'NX')) === 'OK') {
        await R('SET', 'tonum:' + hash, JSON.stringify({ id: hash, h: hash, a: val, c: 'GRAM', src: m.source, m: memo, ts }));
        await R('SADD', 'ton:unm', hash);
        tg('sendMessage', { chat_id: ADMIN, text: `❓ Перевод ${val} TON без опознаваемого комментария (memo: «${memo || 'пусто'}»). Привяжи его к пользователю: Staff → Пополнения.` }).catch(() => {});
      }
      continue;
    }
    if ((await R('SET', 'tonrx:' + hash, String(uid), 'NX')) !== 'OK') continue;
    try {
      await creditDeposit(uid, 'GRAM', val, { m: 'ton' }, String(uid) === String(heldId));
      await R('SET', 'tondep:' + hash, JSON.stringify({ id: hash, u: String(uid), c: 'GRAM', a: val, ts, st: 'paid', src: m.source }));
      await R('SADD', 'tonu:' + uid, hash); credited++;
    } catch (e) { await R('DEL', 'tonrx:' + hash); await errlog('ton_credit', e, uid); } // откат метки — повторим при следующей проверке
  }
  return { credited };
}

// Заявка «я перевёл» (для USDT и случаев, когда автоопределение не сработало)
export async function createClaim(u, cur, a, hash, note) {
  hash = String(hash || '').trim().slice(0, 100);
  if (hash) {
    if (await R('GET', 'tonrx:' + hash)) return { err: 'Этот перевод уже зачислен' };
    if ((await R('SET', 'claimh:' + hash, '1', 'NX')) !== 'OK') return { err: 'По этому хешу уже есть заявка' };
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cl = { id, u: String(u.id), w: u.wid, c: cur, a, h: hash, n: String(note || '').slice(0, 100), ts: Date.now(), st: 'review' };
  await R('SET', 'dclaim:' + id, JSON.stringify(cl)); await R('SADD', 'dclaims', id); await R('SADD', 'dcu:' + u.id, id);
  tg('sendMessage', { chat_id: ADMIN, text: `⬇️ Заявка на пополнение: ${a} ${cur} от ${u.wid}${hash ? '\nХеш: ' + hash : ''}${cl.n ? '\n💬 ' + cl.n : ''}\nПроверь поступление в Tonkeeper → Staff → Пополнения.` }).catch(() => {});
  return { ok: cl };
}
