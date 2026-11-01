import { CUR, R, tg, getUser, save, claim, makeCheck, clean, getRates, nc, cfg, roleOf, ROLES, errlog } from '../lib/core.js';
const name = f => f.first_name || f.username || 'user';
const BOT = () => process.env.BOT_USERNAME || 'NexiumWallet_bot';
const open = (t = '💎 Открыть кошелёк') => ({ inline_keyboard: [[{ text: t, web_app: { url: process.env.APP_URL } }]] });
const refLink = id => `https://t.me/${BOT()}?start=r_${id}`;
const shareUrl = id => `https://t.me/share/url?url=${encodeURIComponent(refLink(id))}&text=${encodeURIComponent('Nexium Wallet — кошелёк, обмен, P2P и чеки в Telegram.')}`;
const fmt = n => n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(3);
const ratesText = async () => {
  const r = await getRates();
  return '<b>📈 Курсы в реальном времени</b>\n\n' + Object.keys(r).filter(k => k !== 'USDT').map(k => `<b>${k}</b>  $${fmt(r[k].p)}  ${r[k].d >= 0 ? '🟢 +' : '🔴 '}${r[k].d.toFixed(2)}%`).join('\n');
};
const hint = (q, id, title, description) => tg('answerInlineQuery', {
  inline_query_id: q.id, cache_time: 0, is_personal: true,
  results: [{ type: 'article', id, title, description, input_message_content: { message_text: 'Nexium Wallet' } }] });
const welcome = me => ({
  parse_mode: 'HTML',
  text: `<b>💎 Nexium Wallet</b>\n\n• 📊 реальные курсы 10 монет\n• 🔄 мгновенный обмен\n• 🤝 P2P-биржа\n• 🧾 чеки, переводы и запросы платежа\n• 🔔 ценовые оповещения\n• 📒 адресная книга\n• 🎫 поддержка прямо в приложении\n\nТвой ID: <code>${me.wid}</code>\n\n🧪 <b>ДЕМО-версия.</b> Монеты виртуальные и не имеют денежной стоимости, ввод и вывод невозможны.`,
  reply_markup: { inline_keyboard: [
    [{ text: '💎 Открыть кошелёк', web_app: { url: process.env.APP_URL } }],
    [{ text: '📈 Курсы', callback_data: 'rates' }, { text: '👥 Пригласить', callback_data: 'ref' }],
    [{ text: '📤 Поделиться ботом', url: shareUrl(me.id) }]] }
});

export default async function handler(req, res) {
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) return res.status(401).end();
  const u = req.body;
  try {
    const CF = await cfg();
    if (CF.maint && u.message && (await roleOf(u.message.from.id)) === 'user') { await tg('sendMessage', { chat_id: u.message.chat.id, text: '🛠 ' + CF.maintMsg }); return res.json({ ok: 1 }); }
    if (u.message?.text?.startsWith('/')) {
      const m = u.message, me = await getUser(m.from.id, name(m.from));
      const [cmdRaw, p] = m.text.split(' '), cmd = cmdRaw.split('@')[0].toLowerCase();
      if (cmd === '/start') {
        const isNew = Date.now() - me.at < 120000;
        if (p?.startsWith('r_')) {
          const rid = p.slice(2);
          if (rid !== me.id && !me.ref && isNew && await R('EXISTS', 'user:' + rid)) {
            const rf = await getUser(rid); me.ref = rid; await save(me);
            rf.refs = (rf.refs || 0) + 1; await save(rf);
            tg('sendMessage', { chat_id: rid, text: `👥 По вашей ссылке пришёл ${name(m.from)}. Приглашено: ${rf.refs}` }).catch(() => {});
          }
        }
        if (p?.startsWith('s_') && isNew && !me.src) { // метка источника рекламы: t.me/бот?start=s_МЕТКА
          const tag = p.slice(2).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
          if (tag) { me.src = tag; await save(me); await R('INCR', 'src:' + tag); await R('SADD', 'srcs', tag); }
        }
        if (p?.startsWith('c_')) {
          const r = await claim(p.slice(2), me);
          await tg('sendMessage', { chat_id: m.chat.id, text: r.err ? '⚠️ ' + r.err : `✅ Чек активирован: +${r.ok.a} ${r.ok.c}`, reply_markup: open() });
        } else await tg('sendMessage', { chat_id: m.chat.id, ...welcome(me) });
      } else if (cmd === '/rates') {
        await tg('sendMessage', { chat_id: m.chat.id, text: await ratesText(), parse_mode: 'HTML', reply_markup: open() });
      } else if (cmd === '/balance') {
        const rt = await getRates(), rows = CUR.filter(c => me.bal[c]).map(c => `<b>${c}</b>  ${me.bal[c]}  ≈ $${fmt(me.bal[c] * (rt[c]?.p || 0))}`);
        const tot = CUR.reduce((s, c) => s + (me.bal[c] || 0) * (rt[c]?.p || 0), 0);
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: rows.length ? `<b>💼 Баланс</b>\n\n${rows.join('\n')}\n\nИтого ≈ <b>$${fmt(tot)}</b>` : 'Баланс пуст. Получить монеты можно переводом от другого пользователя или через P2P.', reply_markup: open() });
      } else if (cmd === '/ref') {
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: `<b>👥 Реферальная программа</b>\nДелись ссылкой с друзьями.\nПриглашено: <b>${me.refs || 0}</b>\n\n<code>${refLink(me.id)}</code>`, reply_markup: { inline_keyboard: [[{ text: '📤 Поделиться ссылкой', url: shareUrl(me.id) }]] } });
      } else if (cmd === '/id') {
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: `Твой ID в кошельке: <code>${me.wid}</code>\nTelegram ID: <code>${me.id}</code>\nРоль: ${ROLES[await roleOf(me.id)]}` });
      } else if (cmd === '/support') {
        await tg('sendMessage', { chat_id: m.chat.id, text: '🎫 Поддержка работает прямо в приложении: вкладка «Ещё» → «Поддержка».', reply_markup: open('🎫 Открыть поддержку') });
      } else if (cmd === '/news') {
        const raws = (await R('LRANGE', 'news', 0, 4)) || [], list = raws.map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: list.length ? '<b>📰 Новости</b>\n\n' + list.map(n => `<b>${n.title.replace(/[<&>]/g, '')}</b>\n${(n.text || '').replace(/[<&>]/g, '')}`).join('\n\n') : 'Новостей пока нет.', reply_markup: open() });
      } else if (cmd === '/staff') {
        const r = await roleOf(me.id);
        await tg('sendMessage', { chat_id: m.chat.id, text: r === 'user' ? 'У тебя нет доступа к панели персонала.' : `🛡 Ты: ${ROLES[r]}. Панель — вкладка «Staff» в приложении.`, reply_markup: r === 'user' ? undefined : open('🛡 Открыть панель') });
      } else if (cmd === '/help') {
        await tg('sendMessage', { chat_id: m.chat.id, text: '/start — главное меню\n/rates — курсы\n/balance — баланс\n/ref — пригласить друзей\n/id — мой ID и роль\n/news — новости\n/support — поддержка\n\nЧек в любом чате: @' + BOT() + ' 1 USDT', reply_markup: open() });
      }
    }
    if (u.inline_query) {
      const q = u.inline_query, me = await getUser(q.from.id, name(q.from));
      const qq = q.query.trim(), mt = qq.match(/^([\d.,]+)\s*([a-zA-Z]+)$/), cur = nc(mt?.[2].toUpperCase()), amt = mt && clean(mt[1]);
      if (me.banned) { await hint(q, 'ban', 'Аккаунт заблокирован', 'Обратись к администратору'); return res.json({ ok: 1 }); }
      if (!qq) { // пустой запрос: курсы и приглашение
        await tg('answerInlineQuery', { inline_query_id: q.id, cache_time: 0, is_personal: true, results: [
          { type: 'article', id: 'rates', title: '📈 Курсы монет', description: 'Реальные котировки', input_message_content: { message_text: await ratesText(), parse_mode: 'HTML' } },
          { type: 'article', id: 'invite', title: '👥 Пригласить в Nexium Wallet', description: `Реальные курсы, обмен и P2P`, input_message_content: { message_text: 'Nexium Wallet — кошелёк, обмен и P2P в Telegram.' },
            reply_markup: { inline_keyboard: [[{ text: 'Открыть Nexium Wallet', url: refLink(me.id) }]] } }] });
        return res.json({ ok: 1 });
      }
      if (!mt || !amt || !CUR.includes(cur)) { await hint(q, 'hint', 'Создать чек', `Напиши сумму и монету, например 1 USDT. Доступно: ${CUR.join(', ')}`); return res.json({ ok: 1 }); }
      if ((me.bal[cur] || 0) < amt) { await hint(q, 'low', `Недостаточно ${cur}`, `На балансе: ${me.bal[cur] || 0} ${cur}`); return res.json({ ok: 1 }); }
      const code = await makeCheck(q.from.id, cur, amt);
      await tg('answerInlineQuery', { inline_query_id: q.id, cache_time: 0, is_personal: true, results: [{
        type: 'article', id: code, title: `Чек на ${amt} ${cur}`, description: 'Нажми, чтобы отправить в чат',
        input_message_content: { message_text: `🧾 Чек на ${amt} ${cur}` },
        reply_markup: { inline_keyboard: [[{ text: `Забрать ${amt} ${cur}`, callback_data: 'c:' + code }]] } }] });
    }
    if (u.callback_query) {
      const q = u.callback_query, d = q.data || '';
      if (d.startsWith('c:')) {
        const me = await getUser(q.from.id, name(q.from)), r = await claim(d.slice(2), me);
        await tg('answerCallbackQuery', { callback_query_id: q.id, show_alert: true, text: r.err ? r.err : `Получено ${r.ok.a} ${r.ok.c}` });
        if (r.ok && q.inline_message_id) await tg('editMessageText', { inline_message_id: q.inline_message_id,
          text: `✅ Чек на ${r.ok.a} ${r.ok.c} активирован: ${name(q.from)}`,
          reply_markup: { inline_keyboard: [[{ text: 'Открыть кошелёк', url: `https://t.me/${BOT()}` }]] } });
      } else if (d === 'rates' || d === 'ref') {
        await tg('answerCallbackQuery', { callback_query_id: q.id });
        const cid = q.message?.chat?.id; if (!cid) return res.json({ ok: 1 });
        if (d === 'rates') await tg('sendMessage', { chat_id: cid, text: await ratesText(), parse_mode: 'HTML' });
        else await tg('sendMessage', { chat_id: cid, parse_mode: 'HTML', text: `<b>👥 Твоя ссылка</b>\n<code>${refLink(q.from.id)}</code>`, reply_markup: { inline_keyboard: [[{ text: '📤 Поделиться', url: shareUrl(q.from.id) }]] } });
      }
    }
  } catch (e) { console.error(e); await errlog('bot', e); }
  res.json({ ok: 1 });
}
