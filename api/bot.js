import { CUR, ADMIN, tg, getUser, claim, makeCheck, clean } from '../lib/core.js';
const name = f => f.first_name || f.username || 'user';
const BOT = () => process.env.BOT_USERNAME || 'NexiumWallet_bot';
const open = () => ({ inline_keyboard: [[{ text: 'Открыть кошелёк', web_app: { url: process.env.APP_URL } }]] });

const hint = (q, id, title, description) => tg('answerInlineQuery', {
  inline_query_id: q.id, cache_time: 0, is_personal: true,
  results: [{ type: 'article', id, title, description, input_message_content: { message_text: 'Nexium Wallet' } }]
});

export default async function handler(req, res) {
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) return res.status(401).end();
  const u = req.body;
  try {
    if (u.message?.text?.startsWith('/start')) {
      const m = u.message, me = await getUser(m.from.id, name(m.from));
      const p = m.text.split(' ')[1];
      if (p?.startsWith('c_')) {
        const r = await claim(p.slice(2), me);
        await tg('sendMessage', { chat_id: m.chat.id, text: r.err ? '⚠️ ' + r.err : `✅ Чек активирован: +${r.ok.a} ${r.ok.c}`, reply_markup: open() });
      } else await tg('sendMessage', { chat_id: m.chat.id, text: 'Nexium Wallet — монеты, переводы и чеки в одном месте.', reply_markup: open() });
    }

    if (u.inline_query) {
      const q = u.inline_query, me = await getUser(q.from.id, name(q.from));
      const mt = q.query.trim().match(/^([\d.,]+)\s*([a-zA-Z]+)$/), cur = mt?.[2].toUpperCase(), amt = mt && clean(mt[1]);

      if (me.banned) { await hint(q, 'ban', 'Аккаунт заблокирован', 'Обратись к администратору'); return res.json({ ok: 1 }); }
      if (!mt || !amt || !CUR.includes(cur)) {
        await hint(q, 'hint', 'Создать чек', `Напиши сумму и монету, например 1 USDT. Доступно: ${CUR.join(', ')}`);
        return res.json({ ok: 1 });
      }
      // Проверка баланса (у админа без ограничений)
      if (String(q.from.id) !== ADMIN && (me.bal[cur] || 0) < amt) {
        await hint(q, 'low', `Недостаточно ${cur}`, `На балансе: ${me.bal[cur] || 0} ${cur}`);
        return res.json({ ok: 1 });
      }

      const code = await makeCheck(q.from.id, cur, amt);
      await tg('answerInlineQuery', { inline_query_id: q.id, cache_time: 0, is_personal: true, results: [{
        type: 'article', id: code, title: `Чек на ${amt} ${cur}`, description: 'Нажми, чтобы отправить в чат',
        input_message_content: { message_text: `🧾 Чек на ${amt} ${cur}\nЗабрать может один человек.` },
        reply_markup: { inline_keyboard: [[{ text: `Забрать ${amt} ${cur}`, callback_data: 'c:' + code }]] } }] });
    }

    if (u.callback_query?.data?.startsWith('c:')) {
      const q = u.callback_query, me = await getUser(q.from.id, name(q.from));
      const r = await claim(q.data.slice(2), me);
      await tg('answerCallbackQuery', { callback_query_id: q.id, show_alert: true, text: r.err ? r.err : `Получено ${r.ok.a} ${r.ok.c}` });
      if (r.ok && q.inline_message_id) await tg('editMessageText', { inline_message_id: q.inline_message_id,
        text: `✅ Чек на ${r.ok.a} ${r.ok.c} активирован: ${name(q.from)}`,
        reply_markup: { inline_keyboard: [[{ text: 'Открыть кошелёк', url: `https://t.me/${BOT()}` }]] } });
    }
  } catch (e) { console.error(e); }
  res.json({ ok: 1 });
}
