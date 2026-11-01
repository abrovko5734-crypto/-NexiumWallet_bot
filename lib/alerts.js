import { R, tg, getUser, save, getRates } from './core.js';
// Проверяет ценовые оповещения пользователя; сработавшие удаляет и шлёт сообщение в бота. Возвращает число сработавших.
export async function checkAlerts(id) {
  const u = await getUser(id), al = u.alerts || [];
  if (!al.length) { await R('SREM', 'alerts:users', String(id)); return 0; }
  const rt = await getRates(), hit = [], keep = [];
  for (const a of al) { const p = rt[a.c]?.p; if (p && (a.dir === 'up' ? p >= a.p : p <= a.p)) hit.push({ ...a, now: p }); else keep.push(a); }
  if (!hit.length) return 0;
  u.alerts = keep; await save(u); if (!keep.length) await R('SREM', 'alerts:users', String(id));
  for (const a of hit) tg('sendMessage', { chat_id: id, text: `🔔 ${a.c} ${a.dir === 'up' ? 'поднялся до' : 'опустился до'} $${a.now} (цель $${a.p})`, reply_markup: { inline_keyboard: [[{ text: '💎 Открыть кошелёк', web_app: { url: process.env.APP_URL } }]] } }).catch(() => {});
  return hit.length;
}
