/* Nexium Wallet — мини-игры и ежедневный кейс. Работает поверх основного скрипта (общие S, api, sheet, toast…). */
(() => {
  Object.assign(TYPE, { game_bet: ['Ставка в игре', '🎮'], game_win: ['Выигрыш в игре', '🏆'], case: ['Ежедневный кейс', '🎁'], ref: ['Бонус за друга', '👥'], quest: ['Задание', '✅'] });
  const CH_URL = 'https://t.me/NexiumWallet_News', CHAT_URL = 'https://t.me/NexiumWalletNews_Chat';
  const GAMES = [['crash', '🚀', 'Crash', 'Забери выигрыш до краха'], ['mines', '💣', 'Mines', 'Открывай клетки, обходи мины'], ['dice', '🎲', 'Dice', 'Выбери шанс и множитель'], ['flip', '🪙', 'Монетка', 'Орёл или решка, x1.94'], ['wheel', '🎡', 'Колесо', 'Крути и забирай до x10'], ['cases', '📦', 'Кейсы', 'Бронза, серебро, золото'], ['quests', '✅', 'Задания', 'Разовые награды GRAM']];
  const NAMES = { crash: 'Crash', mines: 'Mines', dice: 'Dice', flip: 'Монетка', wheel: 'Колесо', case: 'Кейс' };
  let GS = { cases: {}, off: false, limits: { GRAM: { min: .01, max: 50 }, USDT: { min: .1, max: 1000 } } };
  let QS = [], WH = [], V = 'menu', GCUR = LS.get('nx_gc', 'GRAM'), CI = null, cr = null, mn = null, MM = 3, DCH = 50, DDIR = 'under', FSIDE = 'h', crT = 0, busy = false;
  if (!['GRAM', 'USDT'].includes(GCUR)) GCUR = 'GRAM';
  const f8 = x => Math.floor(x * 1e8 + 1e-6) / 1e8, A = n => amt(f8(n));
  const cls4 = (v, t) => v < t[0] ? 'c1' : v < t[1] ? 'c2' : v < t[2] ? 'c3' : 'c4';
  const gv = () => $('#gv');

  // ---------- запросы ----------
  async function call(action, d = {}, quiet) {
    try {
      const r = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tgw?.initData || '', action, ...d }) });
      const j = await r.json();
      if (!r.ok) { if (!quiet) toast(j.err || 'Ошибка', 1); return null; }
      if (j.cfg) S.cfg = j.cfg; if (j.info) S.info = j.info; if (j.me) { S.me = j.me; S.admin = j.isAdmin; if (!quiet || j.crash?.over) render(); balUpd(); }
      return j;
    } catch { if (!quiet) toast('Нет связи с сервером', 1); return null; }
  }
  const balUpd = () => { const e = $('#g-bal'); if (e) e.textContent = A(S.me.bal[GCUR] || 0) + ' ' + GCUR; };

  // ---------- общие элементы ----------
  const back = () => `<button class="gback" data-gx="back">‹ Все игры</button>`;
  const betForm = (locked) => `<div class="gbal"><span>Ставка</span><span>Баланс: <b id="g-bal">${A(S.me.bal[GCUR] || 0)} ${GCUR}</b></span></div>
    <div class="chips">${['GRAM', 'USDT'].map(c => `<button class="chip ${c === GCUR ? 'on' : ''}" data-gx="cur" data-gv="${c}" ${locked ? 'disabled' : ''}>${c}</button>`).join('')}</div>
    <input id="g-bet" inputmode="decimal" placeholder="Сумма ставки" value="${LS.get('nx_gb_' + GCUR, GCUR === 'GRAM' ? '0.1' : '1')}" ${locked ? 'disabled' : ''}>
    <div class="sbtn"><button class="chip" data-gx="bm" data-gv="min" ${locked ? 'disabled' : ''}>MIN</button><button class="chip" data-gx="bm" data-gv="half" ${locked ? 'disabled' : ''}>½</button><button class="chip" data-gx="bm" data-gv="x2" ${locked ? 'disabled' : ''}>×2</button><button class="chip" data-gx="bm" data-gv="max" ${locked ? 'disabled' : ''}>MAX</button></div>`;
  const betVal = () => { const v = String($('#g-bet')?.value || '').replace(',', '.'); LS.set('nx_gb_' + GCUR, v); return v; };
  const res = (w, t) => `<div class="gres ${w ? 'w' : 'l'}">${t}</div>`;

  // ---------- меню ----------
  function menu() {
    const g = S.me.g || { n: 0, w: 0, p: {} }, h = S.me.gh || [];
    gv().innerHTML = `<div class="gtitle">Мини-игры</div><div class="gdesc">🧪 Демо: играем на <b>виртуальные</b> GRAM и USDT, это не азартная игра на деньги. Результат каждого раунда определяет сервер, шансы указаны в каждой игре.</div>${GS.off ? '<div class="gres l">Игры временно отключены администратором</div>' : ''}
    <div class="gmenu">${GAMES.map(x => `<button class="gcard g-${x[0]}" data-gx="open" data-gv="${x[0]}"><span class="gi">${x[1]}</span><b>${x[2]}</b><small>${x[3]}</small></button>`).join('')}</div>
    <div class="gstat"><div class="st"><b>${g.n}</b><span>игр</span></div><div class="st"><b>${g.n ? Math.round(g.w / g.n * 100) : 0}%</b><span>побед</span></div>
      <div class="st"><b class="${(g.p.GRAM || 0) >= 0 ? 'up' : 'down'}">${(g.p.GRAM || 0) > 0 ? '+' : ''}${A(g.p.GRAM || 0)}</b><span>итог, GRAM</span></div></div>
    ${topBox()}<div class="sec">Последние раунды</div><div class="list ghist">${h.length ? h.map(x => `<div class="row"><div class="coin" style="--c:${x.pay > x.b ? '#2f8f55' : '#55627a'};width:38px;height:38px">${x.pay > x.b ? '★' : '•'}</div><div class="grow"><b>${NAMES[x.g] || x.g}</b><div class="sub">${esc(x.i || '')} · ${new Date(x.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div></div><b class="${x.pay >= x.b ? 'up' : 'down'}">${x.pay >= x.b ? '+' : ''}${A(x.pay - x.b)} ${x.c}</b></div>`).join('') : '<div class="empty">Пока нет сыгранных раундов</div>'}</div>`;
  }

  const topBox = () => { const i = S.info; if (!i) return ''; const rows = (a, f) => a?.length ? a.map((u, n) => `<div class="row"><div class="num">${['🥇', '🥈', '🥉'][n] || n + 1}</div><div class="grow"><b>${esc(u.n)}</b></div>${f(u)}</div>`).join('') : '<div class="empty">Пока пусто</div>';
    return `<div class="sec">Топ игроков (прибыль, GRAM)</div><div class="list lead">${rows(i.gtop, u => `<b class="${u.p >= 0 ? 'up' : 'down'}">${u.p > 0 ? '+' : ''}${A(u.p)}</b>`)}</div><div class="sec">Топ по кейсам</div><div class="list lead">${rows(i.ctop, u => `<b>${A(u.s)} GRAM · ${u.c}</b>`)}</div>`; };

  // ---------- CRASH ----------
  const crMult = ms => Math.floor(Math.exp(8e-5 * ms) * 100) / 100;
  function crash() {
    const run = cr && !cr.over;
    gv().innerHTML = `${back()}<div class="gtitle">🚀 Crash</div><div class="gdesc">Множитель растёт, пока ракета не рухнет. Успей нажать «Забрать» раньше. Можно задать авто-вывод.</div>
    <div class="gcv"><canvas id="g-cv"></canvas><div class="gmult ${cr?.over ? (cr.r === 'win' ? 'won' : 'over') : ''}" id="g-m"><div id="g-mt">1.00x</div></div></div>
    ${cr?.over && cr.msg ? res(cr.r === 'win', cr.msg) : ''}
    ${run ? `<button class="btn g" id="g-cash" data-gx="ccash">Забрать</button>` : `${betForm(false)}<input id="g-auto" inputmode="decimal" placeholder="Авто-вывод на x (необязательно), напр. 2" value="${LS.get('nx_auto', '')}"><button class="btn" data-gx="cstart">Играть</button>`}`;
    drawCr(run ? Date.now() + cr.off - cr.t : (cr?.over ? cr.el : 0), cr?.over ? cr.r : '');
    if (run) { crLoop(); clearInterval(crT); crT = setInterval(crPoll, 350); }
  }
  function drawCr(el, state) {
    const cv = $('#g-cv'); if (!cv) return; const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const m = Math.exp(8e-5 * el), xmax = Math.max(el, 7000), ymax = Math.max(2, m * 1.2), P = (t) => [18 + t / xmax * (w - 36), h - 22 - (Math.exp(8e-5 * t) - 1) / (ymax - 1) * (h - 50)];
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1; for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo(0, h * i / 5); x.lineTo(w, h * i / 5); x.stroke(); }
    if (el <= 0) return;
    const col = state === 'lose' ? '#ff5f6d' : state === 'win' ? '#4fd37c' : getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#45aef5';
    x.beginPath(); for (let i = 0; i <= 60; i++) { const [px, py] = P(el * i / 60); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.lineWidth = 4; x.lineCap = 'round'; x.strokeStyle = col; x.shadowColor = col; x.shadowBlur = 14; x.stroke(); x.shadowBlur = 0;
    const [ex, ey] = P(el); x.beginPath(); x.arc(ex, ey, 6, 0, 7); x.fillStyle = '#fff'; x.fill();
    x.font = '22px sans-serif'; x.fillText(state === 'lose' ? '💥' : '🚀', Math.min(ex + 6, w - 30), Math.max(ey - 8, 24));
  }
  function crLoop() {
    if (V !== 'crash' || !cr || cr.over) return;
    const el = Date.now() + cr.off - cr.t, m = crMult(el);
    const e = $('#g-mt'); if (e) { e.textContent = m.toFixed(2) + 'x'; }
    const b = $('#g-cash'); if (b) b.textContent = `Забрать ${A(cr.bet * m)} ${cr.cur}`;
    drawCr(el, ''); requestAnimationFrame(crLoop);
  }
  function crEnd(o, cur) {
    clearInterval(crT); const el = Math.log(Math.max(o.cp, 1)) / 8e-5;
    cr = { ...cr, over: true, r: o.r, el: o.r === 'win' ? Math.log(o.mult) / 8e-5 : el, msg: o.r === 'win' ? `Забрал x${o.mult.toFixed(2)} · +${A(o.pay)} ${cur}` : `Крах на x${o.cp.toFixed(2)} · ставка проиграна`, shown: o.r === 'win' ? o.mult : o.cp };
    hap(o.r === 'win' ? 'success' : 'error'); if (o.r === 'win') confetti(60);
    if (V === 'crash') { crash(); const e = $('#g-mt'); if (e) e.textContent = (o.r === 'win' ? '' : '💥 ') + 'x' + cr.shown.toFixed(2); }
  }
  async function crPoll() {
    if (!cr || cr.over || V !== 'crash') return clearInterval(crT);
    const j = await call('crash_state', {}, true); if (!j?.crash) return;
    if (j.crash.over) crEnd(j.crash, cr.cur); else if (j.crash.none) { clearInterval(crT); cr = null; crash(); } else cr.off = j.crash.now - Date.now();
  }

  // ---------- MINES ----------
  function mines() {
    const run = mn && !mn.over, ov = mn?.over;
    const cell = i => {
      if (ov) { const bomb = mn.mines.includes(i), op = mn.open.includes(i); return `<button class="mc ${bomb ? (i === mn.hit ? 'hit' : 'bm') : op ? 'ok' : 'dim'}" disabled>${bomb ? '💣' : op ? '💎' : '💎'}</button>`; }
      const op = run && mn.open.includes(i); return `<button class="mc ${op ? 'ok' : ''}" data-gx="mpick" data-gv="${i}" ${!run || op ? 'disabled' : ''}>${op ? '💎' : (run ? '' : '')}</button>`;
    };
    gv().innerHTML = `${back()}<div class="gtitle">💣 Mines</div><div class="gdesc">Поле 5×5. Каждая найденная звезда увеличивает множитель. Нажал на мину — ставка сгорает. Чем больше мин, тем выше множители.</div>
    ${run ? `<div class="minfo"><div class="st"><b>x${mn.mult.toFixed(2)}</b><span>сейчас</span></div><div class="st"><b>x${mn.next.toFixed(2)}</b><span>следующий</span></div><div class="st"><b>${A(mn.bet * mn.mult)}</b><span>${mn.cur}</span></div></div>` : ''}
    ${ov ? res(mn.r === 'win', mn.r === 'win' ? `Забрал x${mn.mult.toFixed(2)} · +${A(mn.pay)} ${mn.cur}` : 'Мина! Ставка проиграна') : ''}
    <div class="mgrid">${Array.from({ length: 25 }, (_, i) => cell(i)).join('')}</div>
    ${run ? `<button class="btn g" data-gx="mcash" ${mn.open.length ? '' : 'disabled'}>Забрать ${A(mn.bet * mn.mult)} ${mn.cur}</button>`
        : `${betForm(false)}<div class="lbl">Количество мин</div><div class="chips">${[1, 3, 5, 10, 15, 24].map(n => `<button class="chip ${n === MM ? 'on' : ''}" data-gx="mm" data-gv="${n}">${n}</button>`).join('')}</div><button class="btn" data-gx="mstart">Начать игру</button>`}`;
  }

  // ---------- DICE ----------
  const dMult = ch => Math.floor(97 / ch * 10000) / 10000;
  function dice(last) {
    const ch = DCH, over = DDIR === 'over';
    gv().innerHTML = `${back()}<div class="gtitle">🎲 Dice</div><div class="gdesc">Выбери шанс и сторону. Чем ниже шанс, тем больше множитель. Выпадает число от 0.00 до 99.99.</div>
    <div class="droll ${last ? (last.win ? 'w' : 'l') : ''}" id="g-roll">${last ? last.roll.toFixed(2) : '—'}</div>${last ? res(last.win, last.win ? `Выигрыш +${A(last.pay)} ${GCUR}` : 'Не повезло') : ''}
    <div class="chips" style="justify-content:center"><button class="chip ${!over ? 'on' : ''}" data-gx="dd" data-gv="under">Меньше ${ch.toFixed(2)}</button><button class="chip ${over ? 'on' : ''}" data-gx="dd" data-gv="over">Больше или = ${(100 - ch).toFixed(2)}</button></div>
    <input type="range" id="g-ch" min="1" max="95" value="${ch}">
    <div class="dstat"><div>Шанс<b id="d-ch">${ch}%</b></div><div>Множитель<b id="d-m">x${dMult(ch).toFixed(2)}</b></div><div>Выигрыш<b id="d-p">–</b></div></div>
    ${betForm(false)}<button class="btn" data-gx="droll">Бросить</button>`;
    dPrev();
  }
  function dPrev() { const b = +String($('#g-bet')?.value || 0).replace(',', '.') || 0, p = $('#d-p'); if (p) p.textContent = b ? A(b * dMult(DCH)) + ' ' + GCUR : '–'; }

  // ---------- Монетка ----------
  function flip(last) {
    gv().innerHTML = `${back()}<div class="gtitle">🪙 Монетка</div><div class="gdesc">Угадай сторону — получи ставку ×1.94.</div>
    <div class="coinbox"><div class="gcoin" id="g-coin">${last ? (last.res === 'h' ? '🦅' : '🌙') : '🪙'}</div></div>
    ${last ? res(last.win, last.win ? `Угадал! +${A(last.pay)} ${GCUR}` : 'Не угадал') : ''}
    <div class="sides"><button class="side ${FSIDE === 'h' ? 'on' : ''}" data-gx="fs" data-gv="h">🦅 Орёл</button><button class="side ${FSIDE === 't' ? 'on' : ''}" data-gx="fs" data-gv="t">🌙 Решка</button></div>
    ${betForm(false)}<button class="btn" data-gx="fgo">Бросить</button>`;
  }

  // ---------- Колесо удачи ----------
  const WCOL = ['#3a4559', '#1c4a78', '#2f8f55', '#52318f', '#8a6310', '#a8324a', '#0f7c8c', '#c2a633'];
  function wheel(last) {
    const seg = WH.length || 8, grad = Array.from({ length: seg }, (_, i) => `${WCOL[i % 8]} ${i * 360 / seg}deg ${(i + 1) * 360 / seg}deg`).join(','), rot = last ? last.rot : 0;
    const labels = WH.map((w, i) => { const a = (i + .5) * 360 / seg; return `<div style="position:absolute;left:50%;top:50%;transform:rotate(${a}deg) translateY(-98px) rotate(${-a}deg);margin:-14px 0 0 -22px;width:44px;text-align:center;font:800 15px Montserrat;text-shadow:0 2px 6px rgba(0,0,0,.6)">x${w.m}</div>`; }).join('');
    gv().innerHTML = `${back()}<div class="gtitle">🎡 Колесо удачи</div><div class="gdesc">Крути колесо: множитель от x0 до x10. Шансы: ${WH.map(w => `x${w.m} — ${w.p}%`).join(', ')}.</div>
    <div class="wheelbox"><div class="wheelpin"></div><div class="wheel" id="g-wh" style="background:conic-gradient(${grad});transform:rotate(${rot}deg);transition:none">${labels}</div><div class="wheelhub">🎡</div></div>
    ${last ? res(last.win, last.m > 0 ? `x${last.m} · +${A(last.pay)} ${GCUR}` : 'Выпал x0, повезёт в следующий раз') : ''}${betForm(false)}<button class="btn" data-gx="wgo">Крутить</button>`;
  }

  // ---------- Задания ----------
  function quests() {
    gv().innerHTML = `${back()}<div class="gtitle">✅ Задания</div><div class="gdesc">Выполняй разовые задания и забирай награды в GRAM (виртуальные).</div><div class="list">${QS.length ? QS.map(q => `<div class="qrow"><div class="grow">${q.claimed ? '✅ ' : ''}${esc(q.t)}<small>Награда: ${q.r} GRAM · ${q.p}/${q.n}</small><div class="qbar"><i style="width:${q.p / q.n * 100}%"></i></div></div>${q.claimed ? '<span class="sm">Получено</span>' : q.p >= q.n ? `<button class="chip go" data-gx="qclaim" data-gv="${q.id}">Забрать</button>` : q.id === 'subs' ? '<button class="chip" data-gx="sub" data-gv="ch">Канал</button>' : ''}</div>`).join('') : '<div class="empty">Загрузка…</div>'}</div>`;
  }
  async function loadQuests() { const j = await call('quests_list', {}, true); if (j?.quests) { QS = j.quests; if (V === 'quests') quests(); } }

  // ---------- Рулетка-анимация кейса ----------
  function reel(host, vals, win, fmt, cls, done) {
    const N = 44, W = 92, pos = 36, arr = Array.from({ length: N }, (_, i) => i === pos ? win : vals[Math.random() * vals.length | 0]);
    host.innerHTML = `<div class="rmark"></div><div class="rtrack">${arr.map(v => `<div class="ri ${cls(v)}">${fmt(v)}</div>`).join('')}</div>`;
    const tr = host.querySelector('.rtrack');
    requestAnimationFrame(() => requestAnimationFrame(() => { const cw = host.clientWidth, j = (Math.random() - .5) * 50; tr.style.transition = 'transform 4.2s cubic-bezier(.12,.62,.12,1)'; tr.style.transform = `translateX(${-(pos * W + W / 2 - cw / 2 + j)}px)`; }));
    const t = setInterval(() => { if (host.isConnected) tap(); else clearInterval(t); }, 180); setTimeout(() => { clearInterval(t); if (host.isConnected) done(); }, 4350);
  }

  // ---------- Платные кейсы ----------
  const CICON = { bronze: '📦', silver: '🎁', gold: '👑' };
  function cases() {
    gv().innerHTML = `${back()}<div class="gtitle">📦 Кейсы</div><div class="gdesc">Открой кейс и получи приз от цены кейса. Шансы показаны внутри.</div>
    <div class="ccards">${Object.entries(GS.cases).map(([id, c]) => { const mx = Math.max(...c.prizes.map(p => p.m)); return `<button class="cc" data-gx="cbuy" data-gv="${id}"><div class="ci">${CICON[id] || '📦'}</div><div><b>${c.name}</b><small>призы до x${mx}</small></div><div class="pr">${c.price} ${c.cur}</div></button>`; }).join('')}</div>`;
  }
  function caseSheet(id) {
    const c = GS.cases[id]; if (!c) return;
    sheet(`<h3>${CICON[id] || '📦'} ${c.name} кейс</h3><div class="reel" id="g-reel"><div class="rtrack"><div class="ri c1">?</div><div class="ri c2">?</div><div class="ri c3">?</div><div class="ri c4">?</div></div></div>
    <div class="pz">${c.prizes.map(p => `<span class="${cls4(p.m, [1, 2, 5])}">x${p.m}<em>${p.p}%</em></span>`).join('')}</div>
    <div id="g-cres"></div><div class="sm" style="margin-bottom:10px">Баланс: <b style="color:#fff" id="g-sb">${A(S.me.bal[c.cur] || 0)} ${c.cur}</b></div><button class="btn" id="g-copen" data-gx="copen" data-gv="${id}">Открыть за ${c.price} ${c.cur}</button>`);
  }
  async function buyCase(id) {
    if (busy) return; busy = true; const b = $('#g-copen'); if (b) b.disabled = true;
    const j = await call('case_buy', { id }); const c = GS.cases[id];
    if (!j) { busy = false; if (b) b.disabled = false; return; }
    reel($('#g-reel'), c.prizes.map(p => p.m), j.win.m, m => A(c.price * m) + '<br>' + c.cur, v => cls4(v, [1, 2, 5]), () => {
      busy = false; const r = $('#g-cres'); if (!r) return; const w = j.win.pay >= c.price; hap(w ? 'success' : 'error'); if (j.win.m >= 5) confetti(120); else if (w) confetti(50);
      r.innerHTML = res(w, j.win.pay > 0 ? `x${j.win.m} · +${A(j.win.pay)} ${c.cur}` : 'Пусто. Повезёт в следующий раз');
      const sb = $('#g-sb'); if (sb) sb.textContent = A(S.me.bal[c.cur] || 0) + ' ' + c.cur; if (b) { b.disabled = false; b.textContent = `Ещё раз за ${c.price} ${c.cur}`; }
    });
  }

  // ---------- Отрисовка вкладки ----------
  function draw() {
    if (!S.me) return; clearInterval(crT);
    ({ menu, crash, mines, dice: () => dice(), flip: () => flip(), cases, wheel: () => wheel(), quests }[V] || menu)();
  }
  async function gOpen() {
    draw();
    const j = await call('g_state', {}, true); if (!j?.g) return;
    GS = { ...GS, cases: j.g.cases, limits: j.g.limits, off: j.g.off }; WH = j.g.wheel || WH; call('info', {}, true).then(() => { if (V === 'menu') menu(); });
    const st = j.g.crash; if (st) cr = { t: st.t, off: st.now - Date.now(), bet: st.bet, cur: st.cur, auto: st.auto }; else if (cr && !cr.over) cr = null;
    if (j.g.mines) mn = j.g.mines; else if (mn && !mn.over) mn = null;
    if (st && V === 'menu') V = 'crash'; else if (j.g.mines && V === 'menu') V = 'mines';
    draw();
  }

  // ---------- Ежедневный кейс (карточка на главной) ----------
  const fh = h => h === 24 ? '24 часа' : h === 1 ? 'час' : h < 1 ? Math.round(h * 60) + ' мин' : (h % 1 ? h.toFixed(1) : h) + ' ч';
  const left = () => CI ? Math.max(0, CI.left - (Date.now() - CI.at)) : 0;
  const hms = ms => { const s = Math.ceil(ms / 1000); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':'); };
  window.caseCard = () => {
    if (!CI) return `<div class="dcase"><div class="hd"><div class="gift">🎁</div><div><b class="t">Ежедневный кейс</b><div class="sub2">Загрузка…</div></div></div></div>`;
    if (CI.off) return `<div class="dcase"><div class="hd"><div class="gift">🎁</div><div><b class="t">Ежедневный кейс</b><div class="sub2">Временно отключён администратором</div></div></div></div>`;
    const l = left(), s = CI.subs, ok = s.ch && s.chat;
    const strip = `<div class="cstrip">${CI.prizes.filter((_, i) => i % 2 === 0 || i === CI.prizes.length - 1).map(p => `<span>${p.a} GRAM</span>`).join('')}</div>`;
    const head = (t, sub) => `<div class="hd"><div class="gift">🎁</div><div class="grow"><b class="t">${t}</b><div class="sub2">${sub}</div></div></div>`;
    const meta = `<div class="cmeta"><span>Серия: <b>${CI.streak} дн.</b></span><span>Открыто: <b>${CI.total}</b></span><span>Выиграно: <b>${A(CI.sum)} GRAM</b></span></div>${CI.hist?.length ? `<div class="chist">Последние призы: ${CI.hist.slice(0, 5).map(h => `<b>${h.a}</b>`).join(' · ')}</div>` : ''}`;
    if (l > 0) return `<div class="dcase">${head('Следующий кейс через', `<b class="ccd" style="font:800 22px Montserrat;color:#fff">${hms(l)}</b>`)}${meta}${strip}</div>`;
    const task = (done, t, u, k) => `<div class="ctask ${done ? 'ok' : ''}"><span>${done ? '✅' : '⭕'}</span><div class="grow">${t}<small>${u}</small></div>${done ? '' : `<button class="chip" data-gx="sub" data-gv="${k}">Открыть</button>`}</div>`;
    return `<div class="dcase">${head('Бесплатный кейс готов!', 'Награда от 0.01 до 1 GRAM. Раз в ' + fh(CI.hours || 24) + '.')}
      ${ok ? '' : task(s.ch, 'Подписаться на канал', '@NexiumWallet_News', 'ch') + task(s.chat, 'Вступить в чат', '@NexiumWalletNews_Chat', 'chat')}
      ${s.bad ? `<div class="sub2" style="margin-bottom:8px">⚠️ Бот не смог проверить: ${[s.badCh && 'канал', s.badChat && 'чат'].filter(Boolean).join(' и ')}. Скорее всего, бот не добавлен туда администратором.${S.admin && s.why ? '<br><b>' + esc(s.why) + '</b>' : ''}</div>` : ''}
      ${ok ? '<button class="btn" data-gx="copenD">🎁 Открыть кейс</button>' : '<button class="btn" data-gx="cchk">Проверить подписку</button>'}${meta}${strip}</div>`;
  };
  async function loadCase() {
    const j = await call('case_info', {}, true); if (!j?.case) return;
    CI = { ...j.case, at: Date.now() }; if ($('#p-w').classList.contains('on') || !$('#bn').innerHTML) $('#bn').innerHTML = caseCard();
  }
  async function openDaily() {
    if (busy) return; busy = true; const j = await call('case_open', {});
    if (!j) { busy = false; loadCase(); return; }
    CI = { ...j.case, at: Date.now() }; const pr = CI.prizes.map(p => p.a);
    sheet(`<h3>🎁 Ежедневный кейс</h3><div class="reel" id="g-reel"></div><div id="g-cres"></div><button class="btn sec2" id="g-close" data-gx="close" disabled>Подожди…</button>`);
    reel($('#g-reel'), pr, j.win.prize, v => v + '<br>GRAM', v => cls4(v, [.1, .3, .6]), () => {
      busy = false; hap('success'); confetti(j.win.prize >= .3 ? 160 : 80);
      const r = $('#g-cres'); if (r) r.innerHTML = res(true, `+${j.win.prize} GRAM · серия ${j.win.streak} дн.`);
      const c = $('#g-close'); if (c) { c.disabled = false; c.textContent = 'Отлично'; } $('#bn').innerHTML = caseCard();
    });
  }

  // ---------- Клики ----------
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-gx]'); if (!b || !S.me) return; const x = b.dataset.gx, v = b.dataset.gv;
    switch (x) {
      case 'open': V = v; if (v === 'quests') loadQuests(); if (v === 'crash' && !cr) cr = null; draw(); return tap();
      case 'back': V = 'menu'; clearInterval(crT); draw(); return tap();
      case 'cur': GCUR = v; LS.set('nx_gc', v); tap(); return draw();
      case 'bm': { const i = $('#g-bet'), c = GS.limits[GCUR], cur = +String(i.value).replace(',', '.') || 0, bal = S.me.bal[GCUR] || 0;
        const n = v === 'min' ? c.min : v === 'half' ? cur / 2 : v === 'x2' ? cur * 2 : bal; i.value = f8(Math.min(Math.max(n, c.min), c.max, Math.max(bal, c.min))); tap(); return dPrev(); }
      case 'sub': return openLink(v === 'ch' ? CH_URL : CHAT_URL);
      case 'cchk': { const j = await call('case_info', {}); if (j?.case) { CI = { ...j.case, at: Date.now() }; $('#bn').innerHTML = caseCard(); const s = CI.subs; toast(s.ch && s.chat ? 'Подписка подтверждена' : s.bad ? 'Бот не может проверить подписку: он должен быть админом канала и чата' : (s.ch ? 'Вступи в чат' : 'Подпишись на канал'), !(s.ch && s.chat)); } return; }
      case 'copenD': return openDaily();
      case 'close': return shut();
      case 'cbuy': return caseSheet(v);
      case 'copen': return buyCase(v);
      case 'cstart': { if (busy) return; busy = true; const au = $('#g-auto').value.replace(',', '.'); LS.set('nx_auto', au);
        const j = await call('crash_start', { bet: betVal(), cur: GCUR, auto: au }); busy = false; if (!j) return;
        const c = j.g.crash; cr = { t: c.t, off: c.now - Date.now(), bet: c.bet, cur: c.cur, auto: c.auto }; tap(); return crash(); }
      case 'ccash': { if (busy || !cr || cr.over) return; busy = true; const j = await call('crash_cash', {}, true); busy = false; if (!j?.crash) return;
        if (j.crash.over) crEnd(j.crash, cr.cur); return; }
      case 'mm': MM = +v; tap(); return mines();
      case 'mstart': { if (busy) return; busy = true; const j = await call('mines_start', { bet: betVal(), cur: GCUR, m: MM }); busy = false; if (j) { mn = j.mines; tap(); mines(); } return; }
      case 'mpick': { if (busy) return; busy = true; const j = await call('mines_pick', { i: +v }); busy = false; if (!j) return; mn = j.mines; mines();
        if (mn.over) { hap(mn.r === 'win' ? 'success' : 'error'); if (mn.r === 'win') confetti(90); } else tap(); return; }
      case 'mcash': { if (busy) return; busy = true; const j = await call('mines_cash', {}); busy = false; if (!j) return; mn = j.mines; mines(); hap('success'); confetti(80); return; }
      case 'dd': DDIR = v; tap(); return dice();
      case 'droll': { if (busy) return; busy = true; const j = await call('dice', { bet: betVal(), cur: GCUR, chance: DCH, dir: DDIR }); if (!j) { busy = false; return; }
        const el = $('#g-roll'); let n = 0; const t = setInterval(() => { el.textContent = (Math.random() * 100).toFixed(2); if (++n > 12) { clearInterval(t); busy = false; dice(j); hap(j.win ? 'success' : 'error'); if (j.win) confetti(40); } }, 45); return; }
      case 'wgo': { if (busy) return; busy = true; const j = await call('wheel', { bet: betVal(), cur: GCUR }); if (!j) { busy = false; return; }
        const w = j.wheel, seg = WH.length, el = $('#g-wh'), target = 360 * 6 + (360 - (w.i + .5) * 360 / seg) + (Math.random() - .5) * (360 / seg) * .6;
        el.style.transition = 'transform 4.2s cubic-bezier(.15,.7,.1,1)'; el.style.transform = `rotate(${target}deg)`;
        const t = setInterval(() => { if (el.isConnected) tap(); else clearInterval(t); }, 200);
        setTimeout(() => { clearInterval(t); busy = false; if (V === 'wheel') { wheel({ ...w, rot: target % 360 }); hap(w.win ? 'success' : 'error'); if (w.m >= 3) confetti(100); else if (w.win) confetti(40); } }, 4350); return; }
      case 'qclaim': { const j = await call('quest_claim', { id: v }); if (j) { QS = j.quests; toast(j.done); confetti(60); quests(); } return; }
      case 'nt': { const j = await call('notify', { on: S.me.nt === false }); if (j) toast(j.done); return; }
      case 'ucard': { const j = await call('a_user', { to: $('#u-to').value }); if (!j) return; const c = j.card, bal = Object.entries(c.bal).filter(x => x[1]).map(x => `${A(x[1])} ${x[0]}`).join(', ') || 'пусто';
        $('#u-card').innerHTML = `<div class="ucard"><b>${esc(c.name || '—')}</b> · ${esc(c.wid)} · TG ${esc(c.id)}${c.banned ? ' · <b style="color:#ff5f6d">БАН</b>' : ''}<br>Баланс: <b>${bal}</b><br>Игр: <b>${c.g?.n || 0}</b> · Кейсов: <b>${c.case?.n || 0}</b> (серия ${c.case?.s || 0}) · Друзей: <b>${c.refs}</b> · Заданий: <b>${c.quests}</b><br>Пришёл: ${new Date(c.at).toLocaleDateString('ru-RU')} · Напоминания: ${c.nt ? 'вкл' : 'выкл'}</div>`; return; }
      case 'umsg': { const j = await call('a_msg', { to: $('#u-to').value, text: $('#u-msg').value }); if (j) { toast(j.done); $('#u-msg').value = ''; } return; }
      case 'areset2': { const to = $('#u-to').value.trim(); if (!confirm(to ? `Сбросить ${to}?` : 'Сбросить ВСЕХ пользователей?')) return;
        const j = await call('a_reset', { to, mode: $('#r-mode').value, bonus: $('#r-bonus').value === '1', confirm: $('#r-ok').value.trim() }); if (j) { toast(j.done); $('#r-ok').value = ''; loadCase(); } return; }
      case 'adrop': { if (!confirm('Начислить всем пользователям?')) return; const j = await call('a_airdrop', { amt: $('#d-amt').value, cur: $('#d-cur').value, text: $('#d-txt').value }); if (j) { toast(j.done); confetti(60); } return; }
      case 'astr': { if (!confirm('Обнулить статистику игр?')) return; const j = await call('a_stats_reset'); if (j) { toast(j.done); adminLoad(); } return; }
      case 'atg': { if (!ACF) return; ACF.conf[v] = !ACF.conf[v]; adminFill(); return tap(); }
      case 'asave': { const g = id => $('#' + id).value, c = ACF?.conf || {};
        const j = await call('a_cfg_set', { caseHours: g('c-h'), welcome: g('c-w'), ref: g('c-r'), refMile: g('c-m'), maxBetGRAM: g('c-bg'), maxBetUSDT: g('c-bu'), games: !!c.games, cases: !!c.cases });
        if (j) { ACF = { ...ACF, conf: j.conf }; adminFill(); toast(j.done); loadCase(); } return; }
      case 'areset': { const to = $('#c-to').value.trim(); if (!to && !confirm('Сбросить кулдаун кейса у ВСЕХ пользователей?')) return;
        const j = await call('a_case_reset', { to }); if (j) { toast(j.done); if (j.conf) ACF = { ...ACF, conf: j.conf }; loadCase(); } return; }
      case 'fs': FSIDE = v; tap(); return flip();
      case 'fgo': { if (busy) return; busy = true; const j = await call('flip', { bet: betVal(), cur: GCUR, side: FSIDE }); if (!j) { busy = false; return; }
        const c = $('#g-coin'); c.classList.remove('spin'); void c.offsetWidth; c.classList.add('spin'); setTimeout(() => { busy = false; flip(j); hap(j.win ? 'success' : 'error'); if (j.win) confetti(40); }, 1350); return; }
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'g-ch') { DCH = +e.target.value; $('#d-ch').textContent = DCH + '%'; $('#d-m').textContent = 'x' + dMult(DCH).toFixed(2); const ch = $$('[data-gx="dd"]'); ch[0].textContent = 'Меньше ' + DCH.toFixed(2); ch[1].textContent = 'Больше или = ' + (100 - DCH).toFixed(2); dPrev(); }
    if (e.target.id === 'g-bet') dPrev();
  });

  // ---------- Админ: настройки, кулдаун кейса, статистика ----------
  const adminBox = () => `<div class="box" id="a-cfg"><h3>⚙️ Настройки и кейс</h3><div class="sm" style="margin-bottom:10px">Кулдаун ежедневного кейса и параметры бонусов. Применяется сразу.</div>
    <div class="lbl">Кулдаун кейса, часов (24 = раз в сутки, 0.5 = раз в 30 мин)</div><input id="c-h" inputmode="decimal">
    <div class="two eq"><div><div class="lbl">Стартовый бонус, USDT</div><input id="c-w" inputmode="decimal"></div><div><div class="lbl">За друга, GRAM</div><input id="c-r" inputmode="decimal"></div></div>
    <div class="two eq"><div><div class="lbl">За 5 друзей, GRAM</div><input id="c-m" inputmode="decimal"></div><div><div class="lbl">Макс. ставка GRAM</div><input id="c-bg" inputmode="decimal"></div></div>
    <div class="lbl">Макс. ставка USDT</div><input id="c-bu" inputmode="decimal">
    <div class="tgl"><button class="chip" data-gx="atg" data-gv="games" id="c-tg">Игры</button><button class="chip" data-gx="atg" data-gv="cases" id="c-tc">Кейс</button></div>
    <button class="btn" data-gx="asave">Сохранить настройки</button>
    <div class="lbl" style="margin-top:16px">Сбросить кулдаун кейса (оставь пусто — сбросить ВСЕМ)</div><input id="c-to" placeholder="Telegram ID или ID кошелька (необяз.)"><button class="btn sec2" data-gx="areset">Сбросить кулдаун</button>
    <div class="sec" style="margin:18px 2px 10px;font-size:15px">📊 Статистика игр</div><div class="astat" id="a-st"></div></div>`;
  const adminBox2 = () => `<div class="box" id="a-tools"><h3>🧰 Пользователи и счета</h3>
    <input id="u-to" placeholder="Telegram ID или ID кошелька"><div class="two eq"><button class="btn sec2" data-gx="ucard">Карточка</button><button class="btn sec2" data-gx="umsg">Написать</button></div>
    <input id="u-msg" placeholder="Текст личного сообщения"><div id="u-card"></div>
    <div class="dng"><h3>🔄 Сброс счетов</h3><div class="sm" style="margin-bottom:10px">Кому: ID из поля выше. Поле пустое — сбросить ВСЕМ пользователям.</div>
      <select id="r-mode" class="mini"><option value="bal">Только счета: балансы, стейки, открытые сделки</option><option value="full">Всё заново: баланс, история, игры, кейс, задания</option></select>
      <select id="r-bonus" class="mini"><option value="1">Выдать стартовый бонус после сброса</option><option value="0">Без бонуса (нулевой баланс)</option></select>
      <input id="r-ok" placeholder="Для сброса ВСЕХ введи слово СБРОС"><button class="btn rd2" data-gx="areset2">Сбросить</button></div>
    <div class="dng" style="background:rgba(79,211,124,.1);border-color:rgba(79,211,124,.3)"><h3>🎁 Раздача всем</h3>
      <div class="two"><input id="d-amt" inputmode="decimal" placeholder="Сумма каждому"><select id="d-cur">${opts('USDT')}</select></div><input id="d-txt" placeholder="Сообщение (необязательно)"><button class="btn" data-gx="adrop">Начислить всем</button></div>
    <button class="btn sec2" data-gx="astr" style="margin-top:12px">Обнулить статистику игр</button></div>`;
  let ACF = null;
  function adminFill() {
    if (!ACF) return; const c = ACF.conf, st = ACF.stats, set = (id, v) => { const e = $('#' + id); if (e && document.activeElement !== e) e.value = v; };
    set('c-h', c.caseHours); set('c-w', c.welcome); set('c-r', c.ref); set('c-m', c.refMile); set('c-bg', c.maxBet.GRAM); set('c-bu', c.maxBet.USDT);
    const tg = $('#c-tg'), tc = $('#c-tc'); if (tg) { tg.classList.toggle('on', c.games); tg.textContent = 'Игры: ' + (c.games ? 'вкл' : 'выкл'); tc.classList.toggle('on', c.cases); tc.textContent = 'Кейс: ' + (c.cases ? 'вкл' : 'выкл'); }
    const gi = (st['in:GRAM'] || 0), go = (st['out:GRAM'] || 0), ui = (st['in:USDT'] || 0), uo = (st['out:USDT'] || 0), cell = (a, b) => `<div>${a}<b>${b}</b></div>`;
    const a = $('#a-st'); if (a) a.innerHTML = cell('Раундов', st.rounds || 0) + cell('Ставки GRAM / выплаты', A(gi) + ' / ' + A(go)) + cell('Ставки USDT / выплаты', A(ui) + ' / ' + A(uo)) + cell('Кейсов открыто', st['case:n'] || 0) + cell('Выдано кейсами', A(st['case:sum'] || 0) + ' GRAM') + cell('Заданий / награды', (st['quest:n'] || 0) + ' / ' + A(st['quest:sum'] || 0)) + cell('Crash / Mines', (st['g:crash'] || 0) + ' / ' + (st['g:mines'] || 0)) + cell('Dice / Монетка / Колесо', (st['g:dice'] || 0) + ' / ' + (st['g:flip'] || 0) + ' / ' + (st['g:wheel'] || 0));
  }
  async function adminLoad() {
    if (!S.admin) return; if (!$('#a-cfg')) $('#p-a').insertAdjacentHTML('afterbegin', adminBox() + adminBox2());
    const j = await call('a_cfg_get', {}, true); if (j?.conf) { ACF = j; adminFill(); }
  }

  // ---------- Настройки, видимые всем (награда за друга и т.п.) ----------
  const applyCfg = () => { const c = S.cfg; if (!c) return; const a = $('#refA'), m = $('#refM'); if (a) a.textContent = c.ref; if (m) m.textContent = c.refMile; const n = $('#ntBtn'); if (n && S.me) n.textContent = 'Напоминания: ' + (S.me.nt === false ? 'выкл' : 'вкл'); };
  const _render = render; render = function () { _render(); applyCfg(); };

  // ---------- Подключение к основному приложению ----------
  const _go = go; go = function (t) { _go(t); if (t === 'g') gOpen(); if (t === 'w') loadCase(); if (t === 'a') adminLoad(); };
  setInterval(() => {
    $$('.ccd').forEach(e => { const l = left(); if (l <= 0) { loadCase(); } else e.textContent = hms(l); });
  }, 1000);
  setInterval(loadCase, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadCase(); });
  addEventListener('focus', loadCase);
  const wait = setInterval(() => { if (S.me) { clearInterval(wait); loadCase(); } }, 300);
})();
