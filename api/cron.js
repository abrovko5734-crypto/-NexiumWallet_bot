import { R } from '../lib/core.js';
import { checkAlerts } from '../lib/alerts.js';
import { settleInvoice } from '../lib/pay.js';
import { PAY_ON, TON_ON } from '../lib/core.js';
import { scanTon } from '../lib/ton.js';
// Cron: ценовые оповещения + дозачёт оплаченных счетов. Vercel Cron: Authorization: Bearer CRON_SECRET. Вручную: /api/cron?key=WEBHOOK_SECRET
export default async function handler(req, res) {
  const okAuth = (process.env.CRON_SECRET && req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET) || (req.query.key && req.query.key === process.env.WEBHOOK_SECRET);
  if (!okAuth) return res.status(401).send('no');
  if (req.query.ton) { // лёгкий режим для частого опроса снаружи (например, cron-job.org раз в минуту): только поступления на Tonkeeper
    const r = TON_ON ? await scanTon() : { credited: 0 }; return res.json({ ton: r.credited || 0, skipped: !!r.skipped });
  }
  const tonN = TON_ON ? (await scanTon()).credited || 0 : 0;
  const ids = ((await R('SMEMBERS', 'alerts:users')) || []).slice(0, 1000); let fired = 0, paid = 0;
  for (let i = 0; i < ids.length; i += 20) fired += (await Promise.all(ids.slice(i, i + 20).map(id => checkAlerts(id).catch(() => 0)))).reduce((a, b) => a + b, 0);
  if (PAY_ON) for (const id of ((await R('SMEMBERS', 'inv:pending')) || []).slice(0, 100)) { try { if ((await settleInvoice(id)) === 'paid') paid++; } catch {} }
  res.json({ users: ids.length, fired, paid, ton: tonN });
}
