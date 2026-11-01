import { R, tg, getUser, save, cfg } from '../lib/core.js';
import { cdLeft } from '../lib/games.js';
// Ежедневное напоминание, что кейс готов. Vercel Cron вызывает с заголовком Authorization: Bearer CRON_SECRET.
// Вручную: /api/cron?key=WEBHOOK_SECRET
export default async function handler(req, res) {
  const okAuth = (process.env.CRON_SECRET && req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET) || (req.query.key && req.query.key === process.env.WEBHOOK_SECRET);
  if (!okAuth) return res.status(401).send('no');
  const cf = await cfg(); if (!cf.cases) return res.json({ sent: 0, off: true });
  const ids = ((await R('SMEMBERS', 'users')) || []).slice(0, 600); let sent = 0;
  for (let i = 0; i < ids.length; i += 20) await Promise.all(ids.slice(i, i + 20).map(async id => {
    try {
      const u = await getUser(id); if (u.banned || u.nt === false || cdLeft(u, cf) > 0 || Date.now() - (u.nsent || 0) < 20 * 36e5) return;
      const r = await tg('sendMessage', { chat_id: id, text: '🎁 Твой бесплатный кейс готов! Открой кошелёк и забери награду.', reply_markup: { inline_keyboard: [[{ text: '🎁 Открыть кейс', web_app: { url: process.env.APP_URL } }]] } });
      if (r.ok) { u.nsent = Date.now(); await save(u); sent++; } else if (r.error_code === 403) { u.nt = false; await save(u); }
    } catch {}
  }));
  res.json({ sent });
}
