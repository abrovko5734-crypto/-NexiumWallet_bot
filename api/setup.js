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
    { command: 'news', description: 'Новости' }, { command: 'support', description: 'Поддержка' }, { command: 'id', description: 'Мой ID и роль' }, { command: 'ref', description: 'Пригласить друзей' }, { command: 'help', description: 'Помощь' }] });
  const d = await tg('setMyShortDescription', { short_description: 'ДЕМО-кошелёк (виртуальные монеты): реальные курсы, обмен, P2P, чеки 💎' });
  const e = await tg('setMyDescription', { description: 'Nexium Wallet — ДЕМО-кошелёк в Telegram. Все монеты виртуальные, ввод и вывод невозможны. Реальные курсы, мгновенный обмен, P2P-биржа, чеки, запросы платежа, ценовые оповещения, адресная книга и поддержка.' });
  res.json({ webhook: a, menu: b, commands: c, short: d, desc: e });
}
