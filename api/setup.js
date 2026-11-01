import { LIVE, PAY_ON, TON_ON, TON_ADDR, tg, CHANNEL, CHAT } from '../lib/core.js';
// Открой один раз: https://ТВОЙ-САЙТ/api/setup?key=ТВОЙ_WEBHOOK_SECRET
export default async function handler(req, res) {
  if (req.query.key !== process.env.WEBHOOK_SECRET) return res.status(401).send('no');
  const host = `https://${req.headers.host}`;
  if (req.query.check) { // диагностика: /api/setup?key=...&check=1
    const me = await tg('getMe', {}), out = { bot: me.result?.username };
    for (const [n, c] of [['channel', CHANNEL], ['chat', CHAT]]) {
      const m = await tg('getChatMember', { chat_id: c, user_id: me.result?.id });
      out[n] = { id: c, ok: m.ok, botStatus: m.result?.status, error: m.description, fix: m.ok && ['administrator', 'creator'].includes(m.result?.status) ? 'ок' : 'добавь бота администратором в ' + c };
    }
    return res.json(out);
  }
  const a = await tg('setWebhook', { url: host + '/api/bot', secret_token: process.env.WEBHOOK_SECRET, allowed_updates: ['message', 'inline_query', 'callback_query'] });
  const b = await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Кошелёк', web_app: { url: process.env.APP_URL || host } } });
  const c = await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Главное меню' }, { command: 'rates', description: 'Курсы монет' }, { command: 'balance', description: 'Мой баланс' },
    { command: 'deposit', description: 'Пополнить баланс' }, { command: 'withdraw', description: 'Вывести средства' }, { command: 'history', description: 'Последние операции' }, { command: 'contact', description: 'Связь с администратором' },
    { command: 'news', description: 'Новости' }, { command: 'support', description: 'Поддержка' }, { command: 'id', description: 'Мой ID и роль' }, { command: 'ref', description: 'Пригласить друзей' }, { command: 'privacy', description: 'Политика конфиденциальности' }, { command: 'terms', description: 'Условия использования' }, { command: 'help', description: 'Помощь' }] });
  const d = await tg('setMyShortDescription', { short_description: LIVE ? 'Кошелёк в Telegram: пополнение через Tonkeeper, вывод, обмен, P2P, чеки 💎' : 'Учебный кошелёк (виртуальные монеты): курсы, обмен, P2P, чеки 💎' });
  const e = await tg('setMyDescription', { description: (LIVE ? 'Nexium Wallet — кастодиальный кошелёк в Telegram: пополнение переводом на Tonkeeper, вывод через администратора. Криптовалюты рискованны. ' : 'Nexium Wallet — учебный кошелёк: монеты виртуальные, ввод и вывод невозможны. ') + 'Реальные курсы, мгновенный обмен, P2P-биржа, чеки, запросы платежа, ценовые оповещения, адресная книга и поддержка.' });
  res.json({ live: LIVE, payReady: PAY_ON, tonReady: TON_ON, tonAddress: TON_ADDR ? TON_ADDR.slice(0, 6) + '…' + TON_ADDR.slice(-4) : null, scanTonUrl: host + '/api/cron?ton=1&key=<WEBHOOK_SECRET>', payWebhook: host + '/api/pay', legal: [host + '/privacy', host + '/terms'], webhook: a, menu: b, commands: c, short: d, desc: e });
}
