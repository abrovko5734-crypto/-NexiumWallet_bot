import { settleInvoice } from '../lib/pay.js';
import { errlog } from '../lib/core.js';
// Вебхук Crypto Pay (укажи https://проект.vercel.app/api/pay в @CryptoBot → Crypto Pay → My Apps → Webhooks).
// Тело не считается доверенным: по invoice_id заново запрашиваем счёт у API Crypto Pay.
export default async function handler(req, res) {
  try {
    const b = req.body || {}, id = b.payload?.invoice_id;
    if (b.update_type === 'invoice_paid' && id) await settleInvoice(id);
  } catch (e) { console.error(e); await errlog('pay', e); }
  res.json({ ok: 1 });
}
