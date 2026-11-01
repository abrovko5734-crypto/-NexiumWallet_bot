import { tg, CHANNEL, CHAT } from '../lib/core.js';
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
    { command: 'case', description: 'Ежедневный кейс' }, { command: 'games', description: 'Мини-игры' }, { command: 'ref', description: 'Пригласить друзей' }, { command: 'promo', description: 'Активировать промокод' }, { command: 'help', description: 'Помощь' }] });
  const d = await tg('setMyShortDescription', { short_description: 'Кошелёк с реальными курсами, игры, обмен, P2P и ежедневный кейс до 1 TON 🎁' });
  const e = await tg('setMyDescription', { description: 'Nexium Wallet — кошелёк в Telegram с реальными курсами 10 монет, мгновенным обменом, P2P-биржей, трейдингом и чеками. Ежедневный кейс (0.01–1 TON), мини-игры Crash, Mines, Dice и реферальная программа: 0.1 TON за друга. Демо с виртуальными монетами.' });
  res.json({ webhook: a, menu: b, commands: c, short: d, desc: e });
}
