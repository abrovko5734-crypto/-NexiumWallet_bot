import { R, save, cfg, add, log, tg } from './core.js';

const QUESTS = ['subs', 'case3', 'case7', 'g10', 'g50', 'big', 'ref1', 'ref5'];
const GAMES = ['crash', 'mines', 'dice', 'flip', 'wheel', 'case'];

// Сброс одного пользователя.
// mode 'bal'  — обнуляет балансы, стейки и открытые сделки (статистика и кейс остаются);
// mode 'full' — начать заново: баланс, история, игровая и кейс-статистика, задания, рефералы. Остаются ID, имя, бан, кто пригласил.
export async function resetUser(id, mode = 'bal', bonus = true) {
  const raw = await R('GET', 'user:' + id); if (!raw) return false;
  const u = JSON.parse(raw), cf = await cfg();
  let n;
  if (mode === 'full') n = { id: u.id, name: u.name, wid: u.wid, banned: u.banned, at: u.at, ref: u.ref, src: u.src, nt: u.nt, ep: (u.ep || 0) + 1, bal: {}, tx: [] };
  else n = { ...u, bal: {}, stakes: [], open: [], tx: u.tx || [] };
  if (bonus && cf.welcome > 0) { add(n, 'USDT', cf.welcome); log(n, { t: 'bonus', c: 'USDT', a: cf.welcome }); }
  else log(n, { t: 'admin', c: 'USDT', a: 0 });
  await save(n);
  await Promise.all([R('DEL', 'g:crash:' + id), R('DEL', 'g:mines:' + id), ...(mode === 'full' ? QUESTS.map(q => R('DEL', `quest:${id}:${q}`)) : [])]);
  return true;
}
// Снимает объявления P2P (залог уже списан с баланса, поэтому после сброса их нужно убрать, иначе вернут монеты «из воздуха»)
export async function clearOffers(only) {
  const ids = (await R('SMEMBERS', 'offers')) || [];
  await Promise.all(ids.map(async i => {
    const r = await R('GET', 'offer:' + i); if (!r) return R('SREM', 'offers', i);
    if (only && JSON.parse(r).o !== String(only)) return;
    await R('DEL', 'offer:' + i); await R('SREM', 'offers', i);
  }));
}
export async function resetAll(mode, bonus) {
  const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 3000); let n = 0;
  for (let i = 0; i < ids.length; i += 25) n += (await Promise.all(ids.slice(i, i + 25).map(id => resetUser(id, mode, bonus).catch(() => false)))).filter(Boolean).length;
  await clearOffers(); await R('DEL', 'cache:info');
  return n;
}
export async function airdrop(cur, amt, text) {
  const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 3000); let n = 0;
  for (let i = 0; i < ids.length; i += 25) await Promise.all(ids.slice(i, i + 25).map(async id => {
    const raw = await R('GET', 'user:' + id); if (!raw) return; const u = JSON.parse(raw); if (u.banned) return;
    add(u, cur, amt); log(u, { t: 'admin', c: cur, a: amt }); await save(u); n++;
    if (text) tg('sendMessage', { chat_id: id, text }).catch(() => {});
  }));
  await R('DEL', 'cache:info'); return n;
}
export const resetStats = () => Promise.all(['rounds', 'in:GRAM', 'out:GRAM', 'in:USDT', 'out:USDT', 'case:n', 'case:sum', 'quest:n', 'quest:sum', ...GAMES.map(g => 'g:' + g)].map(k => R('DEL', 'st:' + k)));
export const userCard = u => ({ id: u.id, name: u.name, wid: u.wid, bal: u.bal, banned: !!u.banned, refs: u.refs || 0, ref: u.ref || '', at: u.at, case: u.case || null, g: u.g || null, st: u.st || null, nt: u.nt !== false, tx: (u.tx || []).slice(0, 5), quests: Object.keys(u.quests || {}).length });
