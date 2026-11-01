import { R } from '../lib/core.js';
import { checkAlerts } from '../lib/alerts.js';
import { settleInvoice } from '../lib/pay.js';
import { PAY_ON } from '../lib/core.js';
// Cron: ценовые оповещения + дозачёт оплаченных счетов. Vercel Cron: Authorization: Bearer CRON_SECRET. Вручную: /api/cron?key=WEBHOOK_SECRET
export default async function handler(req, res) {
  const okAuth = (process.env.CRON_SECRET && req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET) || (req.query.key && req.query.key === process.env.WEBHOOK_SECRET);
  if (!okAuth) return res.status(401).send('no');
  const ids = ((await R('SMEMBERS', 'alerts:users')) || []).slice(0, 1000); let fired = 0, paid = 0;
  for (let i = 0; i < ids.length; i += 20) fired += (await Promise.all(ids.slice(i, i + 20).map(id => checkAlerts(id).catch(() => 0)))).reduce((a, b) => a + b, 0);
  if (PAY_ON) for (const id of ((await R('SMEMBERS', 'inv:pending')) || []).slice(0, 100)) { try { if ((await settleInvoice(id)) === 'paid') paid++; } catch {} }
  res.json({ users: ids.length, fired, paid });
}
