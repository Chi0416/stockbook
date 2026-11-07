// 我的（畫面上寫「未實現損益」）：帳務的庫存、總覽、股利、即將除權息點一檔打開（從底部彈出，和詳細資料一樣）
//   個人的數字只放在這裡；詳細資料（見 detail.js）只放誰打開都一樣的資料，這裡不連到詳細資料
//   最上面：上一檔、下一檔（照點進來那一頁列出來的順序，捲下去也一直在最上面）
//
//   從庫存點進來（full）：未實現損益、交易明細、股利明細、快照
//     未實現損益：兩欄三排，預估損益｜報酬率、庫存/股｜付出成本、現價｜成本均價；現價下面小字寫是哪一種（延遲 10:55、11/04 收盤，見 market.js 的 tag）
//       預估損益 = 市值 − 付出成本，和庫存的損益試算同一個數字（沒有扣賣出的手續費和證交稅）；隱藏金額時顯示 ***，現價是公開資料照常顯示
//       股數算出來是負的才會沒有持股，寫一句、列出交易明細和快照，看得出哪裡錯
//     交易明細：這一檔的全部買賣（見 holdings.js 的 ledger），新的在前，先列最近幾筆；沒有交易就沒有這一段
//     股利明細：每次領到的股利，和股利頁同一份資料，發放日｜股利／基準日股數｜股息淨值，新的在前，先列最近幾筆，表格上面小字寫一共領到（領過才有）
//     快照：這一檔每一期的庫存快照（見 holdings.js 的 snaps），新的在前，先列最近幾筆；沒有快照就沒有這一段
//
//   從總覽、股利、即將除權息點進來：只看股利，不放損益、交易明細和快照（那些在庫存）
//     只放公開的資料（基本面 > 股利資訊），沒有股數、金額這些個人的數字：領到多少看股利頁的清單，庫存點進來的股利明細也有
//     最上面一張卡片：接下來有除權息就是下一次（和即將除權息同一份，見 upcoming.js），標題寫下次除權息
//       沒有的話是一年內最近已經過的那一次，標題寫上次除權息；都沒有就不顯示；有沒有持有都一樣，標題放在卡片裡
//       日期和配息頻率、現金股利｜股票股利｜殖利率、發放日
//     歷史股利：公告的除權息加上自己記的（見 events.js），新的在前，都是每股金額
const Mine = (() => {
  const dlg = document.getElementById('mine-sheet');
  // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）時什麼都不做
  if (!dlg) return { open() {}, refresh() {} };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  let code = null;
  let codes = [];         // 上一檔、下一檔的順序
  let full = false;       // 從庫存點進來：列未實現損益、交易明細和快照；不是的話只看股利
  let allOf = {};         // 哪幾張表全部列出（ledger、divs、snaps）
  const LIST_TOP = 5;     // 這幾張表先列幾筆
  const DAY = 86400000;

  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  const head = (title, tip = '', extra = '') =>
    `<h3 class="section-head"><span class="sec-name">${title}</span>${extra}${tip ? Note.btn(title, tip) : ''}</h3>`;
  // 表格裡的數字：沒有值寫「—」；隱藏金額時顯示 ***
  const tableNum = (v, digits) => (v === null ? '—' : Privacy.num(digits ? U.fmtNum(U.round(v, digits), digits) : U.fmtNum(v)));
  // 標題右邊的「全部 N 筆／收起」：超過 LIST_TOP 筆才有；list 是哪一張表
  const moreBtn = (list, count) => (count <= LIST_TOP ? ''
    : `<button type="button" class="sec-btn" data-act="more" data-list="${list}" aria-expanded="${!!allOf[list]}">${allOf[list] ? '收起' : `全部 ${count} 筆`}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>`);
  const shownRows = (list, rows) => (allOf[list] ? rows : rows.slice(0, LIST_TOP));

  // c：哪一檔；list：上一檔、下一檔的順序（點進來那一頁列出來的）；all：從庫存點進來
  function open(c, { list = [], full: all = false } = {}) {
    codes = list.map(key);
    full = all;
    show(c);
  }

  function show(c) {
    code = key(c);
    allOf = {};
    render();
    if (!dlg.open) dlg.showModal();
    fitBig(); // 要先打開才量得到寬度
    bodyEl.scrollTop = 0; // 要先打開才捲得動
  }

  // 資料變了（同步、隱藏金額、現價、公告的除權息）：開著的話重畫，停在原本的位置
  function refresh() {
    if (!dlg.open) return;
    const top = bodyEl.scrollTop;
    render();
    fitBig();
    bodyEl.scrollTop = top;
  }

  // 未實現損益：兩欄三排；庫存裡股數算出來是負的那幾檔沒有持股，只寫一句
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

  // 預估損益、報酬率太長放不下時把字縮小，不換行，才不會被拆成兩行；兩格縮成一樣大
  function fitBig() {
    const nums = [...bodyEl.querySelectorAll('.pl-grid .big > span')];
    nums.forEach(n => { n.style.fontSize = ''; });
    const over = Math.max(1, ...nums.map(n => n.scrollWidth / (n.clientWidth || n.scrollWidth || 1)));
    if (over <= 1) return;
    const size = parseFloat(getComputedStyle(nums[0]).fontSize);
    nums.forEach(n => { n.style.fontSize = `${Math.floor(size / over * 10) / 10}px`; });
  }

  // 交易明細：一張表，一次一行：成交日／類別｜股數／單價｜應收付／損益；一欄上下疊兩個值，最窄的手機也放得下；隱藏金額時顯示 ***
  //   買進付出的錢前面加負號、綠色，賣出拿回的錢紅色（和帳務的交易紀錄一樣）；好幾位成員時類別後面寫是誰的
  //   賣出的應收付下面一行小字是這筆的損益（見 holdings.js 的 realized），賺紅賠綠，算不出來是 —；買進沒有這一行
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

  // 這一檔每次領到的股利（和股利頁同一份），新的在前
  function divRows() {
    const when = r => r.payDate || r.exDate;
    return VIEWS.cashDividends.rows().filter(r => key(r.code) === code && r.net !== null)
      .sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
  }
  const statusOf = r => VIEWS.cashDividends.status(r);
  const sumNet = rows => rows.reduce((s, r) => s + r.net, 0);

  // 股利明細的表：一次一行：發放日｜股利／基準日股數｜股息淨值
  //   和交易明細、快照、歷史股利一樣，第一欄是日期靠左，數字都靠右；發放日寫月/日，下面小字是年；還沒公告發放日的寫「—」
  //   每股是公開資料，隱藏金額時照常顯示；還沒入帳的（待除權息、待發放）金額變淡、下面寫狀態，不算進領到的合計
  //   好幾位成員時金額下面寫是誰的
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

  // 股利明細（庫存點進來）：一張表，表格上面小字寫一共領到；沒有領過就不寫
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

  // 卡片要顯示哪一次除權息：接下來有的話是下一次（和即將除權息同一份，見 upcoming.js）
  //   沒有的話是一年內最近已經過的那一次（公告的加上自己記的，見 events.js）；超過一年就不顯示，免得把停配的寫得像還在配
  //   有沒有持有都一樣；回傳 { exDate, payDate, cash, stock, own, past: 已經除息 }，都沒有是 null
  function pickEvent() {
    const next = Upcoming.list([code], { days: null })[0];
    if (next) return { ...next, past: false };
    const today = U.today();
    const last = Events.list(code).find(r => r.exDate < today);
    return last && (Date.parse(today) - Date.parse(last.exDate)) / DAY <= 365 ? { ...last, past: true } : null;
  }

  // 除權息卡片：r 是 pickEvent() 選的那一次（null 時不顯示），都是公告的資料，誰打開都一樣
  //   標題和「說明」放在卡片裡最上面（不在卡片外面）：還沒除息寫下次除權息，已經除息寫上次除權息
  //   第一行除權息日（寫出年）和配息頻率，下面一行灰色小字寫發放日（和除權息日同一年只寫月/日）；再下面一排 現金股利｜股票股利｜殖利率
  //   配息頻率和選股的殖利率頁同一個算法（見 yield.js）
  //   殖利率 = 這次加上前面幾次（一年配的次數）的現金股利 ÷ 收盤價，和券商 App 的近期除權息一樣
  //     選股的殖利率頁只算已經除息的，這次除息以後兩邊才會一樣；前面幾次只算公告的
  //     這次的金額還沒公告、公告裡沒有這一檔（算不出一年配幾次）時是「—」
  //     記帳網站以後不帶選股的程式時（沒有 Yield），不寫配息頻率、殖利率是「—」
  function exHTML(r) {
    if (!r) return '';
    const info = typeof Yield !== 'undefined' ? Yield.info(code) : null;
    const px = Market.get(code);
    const before = info ? info.recent.filter(x => x.exDate < r.exDate).slice(0, info.per - 1) : [];
    const y = info && px && r.cash !== null ? (r.cash + before.reduce((s, x) => s + x.cash, 0)) / px.close : null;
    const day = d => (d === U.today() ? '今天' : U.weekday(d));
    const num = (v, label) => `<span><b>${v}</b><small>${label}</small></span>`;
    const payDay = d => (d.slice(0, 4) === r.exDate.slice(0, 4) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
    const pay = r.payDate ? `發放 ${U.esc(payDay(r.payDate))} ${day(r.payDate)}` : '發放日待公告';
    const title = r.past ? '上次除權息' : '下次除權息';
    const tip = '<p>公告的除權息，誰打開都一樣；現金股利、股票股利都是<b>每股</b>多少元</p>' +
      `<p><b>殖利率</b> = 這次${info?.per > 1 ? `加上前面 ${info.per - 1} 次（${info.freq}，一年 ${info.per} 次）` : ''}的現金股利 ÷ 收盤價` +
      (px ? `（${U.esc(U.fmtDate(px.date).slice(5))} 收盤 ${U.fmtNum(U.round(px.close, 2), 2)}）` : '') + '</p>' +
      (r.past
        ? '<p>接下來還沒有公告除權息，所以列最近一次已經除息的；超過一年的不列</p>'
        : '<p>選股的殖利率頁只算已經除息的，這次除息以後兩邊才會一樣；這次的金額還沒公告時是「—」</p>') +
      '<p>自己領到多少看「股利」頁的清單</p>';
    return `
        <div class="ex-title"><span>${title}</span>${Note.btn(title, tip)}</div>
        <div class="ex-date"><span><b>${U.esc(U.fmtDate(r.exDate))} ${day(r.exDate)}</b>${r.own ? Events.ownMark : ''}</span>${info?.freq ? `<span class="badge">${info.freq}</span>` : ''}</div>
        <div class="ex-pay">${pay}</div>
        <div class="ex-nums">
          ${num(r.cash === null ? '待公告' : U.fmtNum(r.cash), '現金股利')}
          ${num(r.stock ? U.fmtNum(r.stock) : '—', '股票股利')}
          ${num(y === null ? '—' : `${U.fmtNum(U.round(y * 100, 2), 2)}%`, '殖利率')}
        </div>
        ${r.own ? `<small class="ex-own">${Events.OWN_NOTE}</small>` : ''}`;
  }

  // 最上面的卡片：一年內沒有除權息就不顯示
  function summaryHTML(r) {
    const ex = exHTML(r);
    return ex ? `<div class="card static detail-card ex-card">${ex}</div>` : '';
  }

  // 快照：和交易明細同一種表，一次一行：快照日／類別｜股數／成本均價｜付出成本；好幾位成員時類別後面寫是誰的
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

    // 上一檔、下一檔：捲下去也一直在最上面
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
      ${summaryHTML(pickEvent())}

      ${head('歷史股利', eventsTip)}
      ${Events.tableHTML(Events.list(code), '公告資料裡沒有這檔的配息，也還沒有記過')}`;
  }

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
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
