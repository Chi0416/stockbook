


















const Mine = (() => {
  const dlg = document.getElementById('mine-sheet');

  if (!dlg) return { open() {}, refresh() {} };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  let code = null;
  let codes = [];
  let full = false;
  let allOf = {};
  let extra = null;
  const LIST_TOP = 5;
  const DAY = 86400000;
  const FREQ = { 12: '月配', 4: '季配', 2: '半年配', 1: '年配' };

  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  const head = (title, tip = '', extra = '') =>
    `<h3 class="section-head"><span class="sec-name">${title}</span>${extra}${tip ? Note.btn(title, tip) : ''}</h3>`;

  const tableNum = (v, digits) => (v === null ? '—' : Privacy.num(digits ? U.fmtNum(U.round(v, digits), digits) : U.fmtNum(v)));

  const moreBtn = (list, count) => (count <= LIST_TOP ? ''
    : `<button type="button" class="sec-btn" data-act="more" data-list="${list}" aria-expanded="${!!allOf[list]}">${allOf[list] ? '收起' : `全部 ${count} 筆`}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>`);
  const shownRows = (list, rows) => (allOf[list] ? rows : rows.slice(0, LIST_TOP));


  function open(c, { list = [], full: all = false, extra: more = null } = {}) {
    codes = list.map(key);
    full = all;
    extra = more;
    show(c);
  }

  function show(c) {
    code = key(c);
    allOf = {};
    render();
    if (!dlg.open) dlg.showModal();
    fitBig();
    bodyEl.scrollTop = 0;
  }


  function refresh() {
    if (!dlg.open) return;
    const top = bodyEl.scrollTop;
    render();
    fitBig();
    bodyEl.scrollTop = top;
  }


  function plHTML(pos, code) {
    const price = Market.quote(code).price;
    if (!pos) return '<p class="note muted">目前沒有持有</p>';
    const value = price ? pos.shares * price : null;
    const pl = value === null ? null : Math.round(value) - Math.round(pos.cost);
    const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
    const rate = pl !== null && pos.cost > 0 ? Privacy.num(`${U.fmtNum(U.round(pl / pos.cost * 100, 2), 2)}%`) : '—';
    const each = pos.parts && Store.members().length > 1
      ? pos.parts.map(x => `${Store.memberName(x.member)} ${Privacy.num(U.fmtNum(x.shares))} 股`).join(' · ') : '';
    return `
      <div class="card static detail-card">
        <span class="card-grid pl-grid">
          ${cell('預估損益', pl === null ? '—' : Privacy.num(U.fmtNum(pl)), `big ${tone}`)}
          ${cell('報酬率', rate, `big ${tone}`)}
          ${cell('庫存/股', Privacy.num(U.fmtNum(pos.shares)))}
          ${cell('付出成本', money(pos.cost))}
          ${cell('現價', price ? `${U.fmtNum(U.round(price, 2), 2)}<small class="px-tag">${U.esc(Market.tag(code))}</small>` : '—')}
          ${cell('成本均價', Privacy.num(U.fmtNum(U.round(pos.cost / pos.shares, 2), 2)))}
        </span>
        ${each ? `<span class="card-note">${U.esc(each)}</span>` : ''}
      </div>`;
  }


  function fitBig() {
    const nums = [...bodyEl.querySelectorAll('.pl-grid .big > span')];
    nums.forEach(n => { n.style.fontSize = ''; });
    const over = Math.max(1, ...nums.map(n => n.scrollWidth / (n.clientWidth || n.scrollWidth || 1)));
    if (over <= 1) return;
    const size = parseFloat(getComputedStyle(nums[0]).fontSize);
    nums.forEach(n => { n.style.fontSize = `${Math.floor(size / over * 10) / 10}px`; });
  }




  function ledgerSec() {
    const rows = Holdings.ledger(code, U.today());
    if (!rows.length) return '';
    const several = Store.shown().length > 1;
    const row = r => {
      const sign = r.kind === 'buy' && r.amount !== null && !Privacy.hidden ? '−' : '';
      const tone = Privacy.hidden ? '' : r.kind === 'buy' ? ' down' : ' up';
      const pl = r.sale?.pl ?? null;
      const plTone = Privacy.hidden || !pl ? '' : pl > 0 ? ' up' : ' down';
      return `
        <tr>
          <td>${U.esc(U.fmtDate(r.date))}<small>${U.esc(r.type)}${several ? ` · ${U.esc(Store.memberName(r.member))}` : ''}</small></td>
          <td class="num">${tableNum(r.shares)}<small>${tableNum(r.price, 2)}</small></td>
          <td class="num total${tone}">${sign}${tableNum(r.amount === null ? null : Math.round(r.amount))}${r.kind === 'sell'
            ? `<small class="sale-pl${plTone}">${tableNum(pl)}</small>` : ''}</td>
        </tr>`;
    };
    const tip = '<p>這一檔的全部買賣，新的在前；要改到帳務的交易紀錄</p>' +
      '<p>賣出的應收付下面是這筆的損益：拿回的錢 − 賣掉那部分的付出成本，含持有期間領到的股利；算不出來（例如前面的買進沒記）寫 —，點帳務的那一筆看原因</p>' +
      '<p>快照當天或以前的買賣已經算在快照裡，這裡照樣列出來，庫存不會再加一次</p>';
    return `${head('交易明細', tip, moreBtn('ledger', rows.length))}
      <div class="card static detail-card">
        <table class="ev-table">
          <thead><tr><th>成交日<small>類別</small></th><th class="num">股數<small>單價</small></th><th class="num">應收付<small>損益</small></th></tr></thead>
          <tbody>${shownRows('ledger', rows).map(row).join('')}</tbody>
        </table>
      </div>`;
  }


  function divRows() {
    const when = r => r.payDate || r.exDate;
    return VIEWS.cashDividends.rows().filter(r => key(r.code) === code && r.net !== null)
      .sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
  }
  const statusOf = r => VIEWS.cashDividends.status(r);
  const sumNet = rows => rows.reduce((s, r) => s + r.net, 0);





  function divTable(rows) {
    const several = Store.shown().length > 1;
    const row = r => {
      const st = statusOf(r);
      const under = [st?.label, several ? Store.memberName(r.member) : ''].filter(Boolean).join(' · ');
      const tone = st?.pending ? ' pending' : Privacy.hidden ? '' : ' up';
      return `
        <tr>
          <td>${r.payDate ? `${U.esc(U.fmtDate(r.payDate).slice(5))}<small>${U.esc(r.payDate.slice(0, 4))}</small>` : '—'}</td>
          <td class="num">${U.esc(U.fmtNum(r.cash))}<small>${tableNum(r.shares)}</small></td>
          <td class="num total${tone}">${tableNum(r.net)}${under ? `<small>${U.esc(under)}</small>` : ''}</td>
        </tr>`;
    };
    return `
      <table class="ev-table">
        <thead><tr><th>發放日</th><th class="num">股利<small>基準日股數</small></th><th class="num">股息淨值</th></tr></thead>
        <tbody>${shownRows('divs', rows).map(row).join('')}</tbody>
      </table>`;
  }


  function divSec() {
    const rows = divRows();
    if (!rows.length) return '';
    const paid = sumNet(rows.filter(r => !statusOf(r)?.pending));
    const tip = '<p>每次領到的錢：每股現金股利 × 基準日股數，和「股利」頁同一份</p>' +
      '<p>待除權息的金額是預估，待發放還沒入帳，都不算進一共領到</p><p>只配股的不會列在這裡</p>';
    return `${head('股利明細', tip, moreBtn('divs', rows.length))}
      <div class="card static detail-card">
        <span class="card-note lead">一共領到 ${money(paid)} 元</span>
        ${divTable(rows)}
      </div>`;
  }




  function pickEvent() {
    const next = Upcoming.list([code], { days: null })[0];
    if (next) return { ...next, past: false };
    const today = U.today();
    const last = Events.list(code).find(r => r.exDate < today);
    return last && (Date.parse(today) - Date.parse(last.exDate)) / DAY <= 365 ? { ...last, past: true } : null;
  }








  function exHTML(r) {
    if (!r) return '';
    const per = Announced.per(code);
    const freq = FREQ[per] || '';
    const px = Market.get(code);
    const today = U.today();
    const recent = per ? Events.list(code, []).filter(x => x.exDate <= today && typeof x.cash === 'number' &&
      (Date.parse(today) - Date.parse(x.exDate)) / DAY <= 385).slice(0, per) : [];
    const before = recent.filter(x => x.exDate < r.exDate).slice(0, per - 1);
    const y = per && px && r.cash !== null ? (r.cash + before.reduce((s, x) => s + x.cash, 0)) / px.close : null;
    const year = r.cash === null ? Yields.get(code)?.y ?? null : null;
    const yText = y !== null ? `${U.fmtNum(U.round(y * 100, 2), 2)}%` : year !== null ? `${U.fmtNum(year, 2)}%` : '—';
    const day = d => (d === U.today() ? '今天' : U.weekday(d));
    const num = (v, label) => `<span><b>${v}</b><small>${label}</small></span>`;
    const payDay = d => (d.slice(0, 4) === r.exDate.slice(0, 4) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
    const pay = r.payDate ? `發放 ${U.esc(payDay(r.payDate))} ${day(r.payDate)}` : '發放日待公告';
    const title = r.past ? '上次除權息' : '下次除權息';
    const tip = '<p>公告的除權息，誰打開都一樣；現金股利、股票股利都是<b>每股</b>多少元</p>' +
      `<p><b>殖利率</b> = 這次${per > 1 ? `加上前面 ${per - 1} 次（${freq}，一年 ${per} 次）` : ''}的現金股利 ÷ 收盤價` +
      (px ? `（${U.esc(U.fmtDate(px.date).slice(5))} 收盤 ${U.fmtNum(U.round(px.close, 2), 2)}）` : '') + '</p>' +
      (r.past
        ? '<p>接下來還沒有公告除權息，所以列最近一次已經除息的；超過一年的不列</p>'
        : '<p>這次的金額還沒公告時，用近一年的現金股利算</p>') +
      '<p>自己領到多少看「股利」頁的清單</p>';
    return `
        <div class="ex-title"><span>${title}</span>${Note.btn(title, tip)}</div>
        <div class="ex-date"><span><b>${U.esc(U.fmtDate(r.exDate))} ${day(r.exDate)}</b>${r.own ? Events.ownMark : ''}</span>${freq ? `<span class="badge">${freq}</span>` : ''}</div>
        <div class="ex-pay">${pay}</div>
        <div class="ex-nums">
          ${num(r.cash === null ? '待公告' : U.fmtNum(r.cash), '現金股利')}
          ${num(r.stock ? U.fmtNum(r.stock) : '—', '股票股利')}
          ${num(yText, '殖利率')}
        </div>
        ${r.own ? `<small class="ex-own">${Events.OWN_NOTE}</small>` : ''}`;
  }


  function summaryHTML(r) {
    const ex = exHTML(r);
    return ex ? `<div class="card static detail-card ex-card">${ex}</div>` : '';
  }


  function snapSec() {
    const rows = Holdings.snaps(code, U.today());
    if (!rows.length) return '';
    const several = Store.shown().length > 1;
    const row = r => {
      const under = [r.type, several ? Store.memberName(r.member) : ''].filter(Boolean).join(' · ');
      return `
        <tr>
          <td>${U.esc(U.fmtDate(r.date))}${under ? `<small>${U.esc(under)}</small>` : ''}</td>
          <td class="num">${tableNum(r.shares)}<small>${tableNum(r.price, 2)}</small></td>
          <td class="num total">${tableNum(Math.round(r.amount))}</td>
        </tr>`;
    };
    const tip = '<p>這一檔每一期的庫存快照，新的在前；要改到帳務的庫存快照</p>' +
      '<p>庫存從最近一期快照開始算，再加上之後的買賣</p>';
    return `${head('快照', tip, moreBtn('snaps', rows.length))}
      <div class="card static detail-card">
        <table class="ev-table">
          <thead><tr><th>快照日<small>類別</small></th><th class="num">股數<small>成本均價</small></th><th class="num">付出成本</th></tr></thead>
          <tbody>${shownRows('snaps', rows).map(row).join('')}</tbody>
        </table>
      </div>`;
  }

  function render() {
    const h = Holdings.all(U.today());
    const pos = (h ? h.positions : []).find(p => key(p.code) === code && p.shares > 0) || null;
    const names = typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {};
    const name = pos?.name || names[code] || Announced.forCode(code)[0]?.name || '';
    titleEl.textContent = `${code} ${name}`.trim();


    const i = codes.indexOf(code);
    const nav = codes.length > 1 && i >= 0 ? `
      <div class="kl-nav detail-nav">
        <button type="button" class="text-btn" data-act="prev"${i === 0 ? ' disabled' : ''}>‹ 上一檔</button>
        <span>${i + 1} / ${codes.length}</span>
        <button type="button" class="text-btn" data-act="next"${i === codes.length - 1 ? ' disabled' : ''}>下一檔 ›</button>
      </div>` : '';
    if (full) {
      bodyEl.innerHTML = `${nav}
        ${head('未實現損益')}
        ${plHTML(pos, code)}
        ${ledgerSec()}

        ${divSec()}

        ${snapSec()}`;
      return;
    }
    const eventsTip = '<p>金額都是<b>每股</b>多少元，不是你領到的錢（領到多少看「股利」頁的清單）</p>' +
      '<p>合計 = 現金股利 + 股票股利；股票股利是照面額算的價值，是股票不是現金</p>' +
      '<p>公告資料只抓近 13 個月，一年配一次的通常只有一行；更早的只列你在「除權息」記過的</p>';
    bodyEl.innerHTML = `${nav}
      ${extra ? extra(code) : summaryHTML(pickEvent())}

      ${head('歷史股利', eventsTip)}
      ${Events.tableHTML(Events.list(code), '公告資料裡沒有這檔的配息，也還沒有記過')}`;
  }

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  bodyEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    const i = codes.indexOf(code);
    if (act === 'prev' && i > 0) {
      show(codes[i - 1]);
    } else if (act === 'next' && i >= 0 && i < codes.length - 1) {
      show(codes[i + 1]);
    } else if (act === 'more') {
      const { list } = btn.dataset;
      allOf[list] = !allOf[list];
      refresh();
      bodyEl.querySelector(`[data-list="${list}"]`)?.focus({ preventScroll: true });
    }
  });

  return { open, refresh };
})();
