import { CUR, R, tg, getUser, save, add, log, claim, makeCheck, clean, getRates, redeemPromo, esc, nc, REF_TON, REF_MILESTONE_TON, CHANNEL_URL, CHAT_URL } from '../lib/core.js';
const name = f => f.first_name || f.username || 'user';
const BOT = () => process.env.BOT_USERNAME || 'NexiumWallet_bot';
const open = () => ({ inline_keyboard: [[{ text: '💼 Открыть кошелёк', web_app: { url: process.env.APP_URL } }]] });
const refLink = id => `https://t.me/${BOT()}?start=r_${id}`;
const shareUrl = id => `https://t.me/share/url?url=${encodeURIComponent(refLink(id))}&text=${encodeURIComponent('Nexium Wallet — кошелёк, обмен, P2P и трейдинг в Telegram. Заходи, получи бонус 🎁')}`;
const fmt = n => n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(3);
const ratesText = async () => {
  const r = await getRates();
  return '<b>📈 Курсы в реальном времени</b>\n<i>Источник: рыночные данные бирж</i>\n\n' + Object.keys(r).filter(k => k !== 'USDT').map(k => `<b>${k}</b>  $${fmt(r[k].p)}  ${r[k].d >= 0 ? '🟢 +' : '🔴 '}${r[k].d.toFixed(2)}%`).join('\n');
};
const hint = (q, id, title, description) => tg('answerInlineQuery', {
  inline_query_id: q.id, cache_time: 0, is_personal: true,
  results: [{ type: 'article', id, title, description, input_message_content: { message_text: 'Nexium Wallet' } }] });
const welcome = me => ({
  parse_mode: 'HTML',
  text: `<b>Nexium Wallet</b> — кошелёк прямо в Telegram\n\n` +
    `• 📊 реальные курсы 10 монет\n• 🔄 мгновенный обмен\n• 🤝 P2P-биржа\n• 📈 трейдинг на реальных котировках\n• 🧾 чеки и переводы по ID\n• 🎁 бесплатный кейс каждые 24 часа (0.01–1 GRAM)\n• 🎮 игры: Crash, Mines, Dice, монетка, кейсы\n• 👥 0.1 GRAM за каждого друга\n\n` +
    `Твой ID: <code>${me.wid}</code>\n\n<i>Это демо-кошелёк с виртуальными монетами: внутренний учёт, не блокчейн. Монеты не имеют денежной стоимости, ввод и вывод невозможны.</i>`,
  reply_markup: { inline_keyboard: [
    [{ text: '💼 Открыть кошелёк', web_app: { url: process.env.APP_URL } }],
    [{ text: '📈 Курсы', callback_data: 'rates' }, { text: '👥 Пригласить', callback_data: 'ref' }],
    [{ text: '📤 Поделиться ботом', url: shareUrl(me.id) }]] }
});

export default async function handler(req, res) {
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) return res.status(401).end();
  const u = req.body;
  try {
    if (u.message?.text?.startsWith('/')) {
      const m = u.message, me = await getUser(m.from.id, name(m.from));
      const [cmdRaw, p] = m.text.split(' '), cmd = cmdRaw.split('@')[0].toLowerCase();
      if (cmd === '/start') {
        const isNew = Date.now() - me.at < 120000;
        if (p?.startsWith('r_')) {
          const rid = p.slice(2);
          if (rid !== me.id && !me.ref && isNew && await R('EXISTS', 'user:' + rid)) {
            const rf = await getUser(rid);
            me.ref = rid; await save(me);
            rf.refs = (rf.refs || 0) + 1; add(rf, 'GRAM', REF_TON); log(rf, { t: 'ref', c: 'GRAM', a: REF_TON });
            let extra = '';
            if (rf.refs % 5 === 0) { add(rf, 'GRAM', REF_MILESTONE_TON); log(rf, { t: 'ref', c: 'GRAM', a: REF_MILESTONE_TON }); extra = `\n🏆 ${rf.refs} приглашённых — ещё +${REF_MILESTONE_TON} GRAM!`; }
            await save(rf);
            tg('sendMessage', { chat_id: rid, text: `По вашей ссылке пришёл ${name(m.from)}. Бонус +${REF_TON} GRAM${extra}` }).catch(() => {});
          }
        }
        if (p?.startsWith('s_') && isNew && !me.src) { // метка источника рекламы: t.me/бот?start=s_МЕТКА
          const tag = p.slice(2).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
          if (tag) { me.src = tag; await save(me); await R('INCR', 'src:' + tag); await R('SADD', 'srcs', tag); }
        }
        if (p?.startsWith('c_')) {
          const r = await claim(p.slice(2), me);
          await tg('sendMessage', { chat_id: m.chat.id, text: r.err ? '⚠️ ' + r.err : `✅ Чек активирован: +${r.ok.a} ${r.ok.c}`, reply_markup: open() });
        } else if (p?.startsWith('p_')) {
          const r = await redeemPromo(p.slice(2), me);
          await tg('sendMessage', { chat_id: m.chat.id, text: r.err ? '⚠️ ' + r.err : `🎟 Промокод активирован: +${r.ok.a} ${r.ok.c}`, reply_markup: open() });
        } else await tg('sendMessage', { chat_id: m.chat.id, ...welcome(me) });
      } else if (cmd === '/rates') {
        await tg('sendMessage', { chat_id: m.chat.id, text: await ratesText(), parse_mode: 'HTML', reply_markup: open() });
      } else if (cmd === '/balance') {
        const rt = await getRates(), rows = CUR.filter(c => me.bal[c]).map(c => `<b>${c}</b>  ${me.bal[c]}  ≈ $${fmt(me.bal[c] * (rt[c]?.p || 0))}`);
        const tot = CUR.reduce((s, c) => s + (me.bal[c] || 0) * (rt[c]?.p || 0), 0);
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: rows.length ? `<b>💼 Баланс</b>\n\n${rows.join('\n')}\n\nИтого ≈ <b>$${fmt(tot)}</b>` : 'Баланс пуст. Забери ежедневный бонус в приложении.', reply_markup: open() });
      } else if (cmd === '/ref') {
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: `<b>👥 Реферальная программа</b>\nЗа каждого друга вы получаете ${REF_TON} GRAM, а за каждые 5 друзей — ещё +${REF_MILESTONE_TON} GRAM.\nПриглашено: <b>${me.refs || 0}</b>\n\n<code>${refLink(me.id)}</code>`, reply_markup: { inline_keyboard: [[{ text: '📤 Поделиться ссылкой', url: shareUrl(me.id) }]] } });
      } else if (cmd === '/promo') {
        if (!p) await tg('sendMessage', { chat_id: m.chat.id, text: 'Отправь: /promo КОД' });
        else { const r = await redeemPromo(p, me); await tg('sendMessage', { chat_id: m.chat.id, text: r.err ? '⚠️ ' + r.err : `🎟 Промокод активирован: +${r.ok.a} ${r.ok.c}` }); }
      } else if (cmd === '/case' || cmd === '/games') {
        await tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: cmd === '/case'
          ? `<b>🎁 Ежедневный кейс</b>\nНаграда от 0.01 до 1 GRAM раз в 24 часа.\n\nУсловия:\n1) подписаться на <a href="${CHANNEL_URL}">канал</a>\n2) вступить в <a href="${CHAT_URL}">чат</a>\n\nОткрой кошелёк и нажми «Открыть кейс».`
          : '<b>🎮 Мини-игры</b>\nCrash, Mines, Dice, Монетка и платные кейсы — во вкладке «Игры».', reply_markup: { inline_keyboard: [[{ text: cmd === '/case' ? '🎁 Открыть кейс' : '🎮 Играть', web_app: { url: process.env.APP_URL } }], ...(cmd === '/case' ? [[{ text: '📢 Канал', url: CHANNEL_URL }, { text: '💬 Чат', url: CHAT_URL }]] : [])] } });
      } else if (cmd === '/help') {
        await tg('sendMessage', { chat_id: m.chat.id, text: '/start — главное меню\n/rates — курсы\n/balance — баланс\n/ref — пригласить друзей\n/promo КОД — промокод\n/case — ежедневный кейс\n/games — мини-игры\n\nЧек в любом чате: @' + BOT() + ' 1 USDT', reply_markup: open() });
      }
    }
    if (u.inline_query) {
      const q = u.inline_query, me = await getUser(q.from.id, name(q.from));
      const qq = q.query.trim(), mt = qq.match(/^([\d.,]+)\s*([a-zA-Z]+)$/), cur = nc(mt?.[2].toUpperCase()), amt = mt && clean(mt[1]);
      if (me.banned) { await hint(q, 'ban', 'Аккаунт заблокирован', 'Обратись к администратору'); return res.json({ ok: 1 }); }
      if (!qq) { // пустой запрос: курсы и приглашение
        await tg('answerInlineQuery', { inline_query_id: q.id, cache_time: 0, is_personal: true, results: [
          { type: 'article', id: 'rates', title: '📈 Курсы монет', description: 'Реальные котировки', input_message_content: { message_text: await ratesText(), parse_mode: 'HTML' } },
          { type: 'article', id: 'invite', title: '👥 Пригласить в Nexium Wallet', description: `Вы получите ${REF_TON} GRAM за друга`, input_message_content: { message_text: 'Nexium Wallet — кошелёк, обмен, P2P и трейдинг в Telegram. Заходи и получи бонус 🎁' },
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
        else await tg('sendMessage', { chat_id: cid, parse_mode: 'HTML', text: `<b>👥 Твоя ссылка</b>\nЗа каждого друга +${REF_TON} GRAM, за каждые 5 друзей ещё +${REF_MILESTONE_TON} GRAM.\n\n<code>${refLink(q.from.id)}</code>`, reply_markup: { inline_keyboard: [[{ text: '📤 Поделиться', url: shareUrl(q.from.id) }]] } });
      }
    }
  } catch (e) { console.error(e); }
  res.json({ ok: 1 });
}
