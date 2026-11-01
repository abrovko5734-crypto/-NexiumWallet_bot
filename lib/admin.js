import { R, save, add, log } from './core.js';

// Сброс пользователя: 'bal' — обнуляет балансы и историю операций остаётся; 'full' — начать заново (остаются ID, имя, бан, роль).
export async function resetUser(id, mode = 'bal') {
  const raw = await R('GET', 'user:' + id); if (!raw) return false;
  const u = JSON.parse(raw);
  const n = mode === 'full'
    ? { id: u.id, name: u.name, wid: u.wid, banned: u.banned, at: u.at, ref: u.ref, src: u.src, nt: u.nt, bal: {}, tx: [] }
    : { ...u, bal: {} };
  log(n, { t: 'admin', c: 'USDT', a: 0 });
  await save(n); return true;
}
// Снимает объявления P2P (залог уже списан с баланса)
export async function clearOffers(only) {
  const ids = (await R('SMEMBERS', 'offers')) || [];
  await Promise.all(ids.map(async i => {
    const r = await R('GET', 'offer:' + i); if (!r) return R('SREM', 'offers', i);
    if (only && JSON.parse(r).o !== String(only)) return;
    await R('DEL', 'offer:' + i); await R('SREM', 'offers', i);
  }));
}
export async function resetAll(mode) {
  const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 3000); let n = 0;
  for (let i = 0; i < ids.length; i += 25) n += (await Promise.all(ids.slice(i, i + 25).map(id => resetUser(id, mode).catch(() => false)))).filter(Boolean).length;
  await clearOffers(); await R('DEL', 'cache:info');
  return n;
}
export const userCard = (u, role) => ({ id: u.id, name: u.name, wid: u.wid, role, bal: u.bal, banned: !!u.banned, refs: u.refs || 0, ref: u.ref || '', at: u.at, nt: u.nt !== false, tx: (u.tx || []).slice(0, 8), contacts: (u.contacts || []).length, note: u.anote || '' });
