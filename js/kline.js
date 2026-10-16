// K 線：行情的一頁（列表、「持有｜觀察｜全市場｜成分股」、搜尋見 market.js），每一列一張小 K 線圖（最近 20 天和月線，見 MA.miniHTML）
//   月線往哪裡彎、扣低幾天，用現價算（和殖利率頁的現價一樣，見 market.js 的 quote）：
//     月線：價格是現價的話，今天的月線比前一天高（上彎）、低（下彎）
//     扣低：接下來 5 天要扣的收盤價有幾天比現價低；扣低越多，價格不變的話月線越會往上彎
//   排序：扣低多的在前（預設，找月線快要往上彎的）、扣高多的在前、依代號；算不出來的放最後
//     扣低一樣多的：價格不變的話，5 天後的月線比前一天高越多（%）的在前（扣高的反過來）
//   點一列打開大圖（KLine），上一檔、下一檔照目前列表的順序
//   K 線資料打開這一頁才下載（見 candles.js，app.js 切到這一頁時叫 Candles.need），下載好之後整頁重畫
const KLINE_PAGE = (() => {
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const ma2 = v => U.fmtNum(U.round(v, 2), 2);
  const TURN = { 1: ['up', '↑ 上彎'], '-1': ['down', '↓ 下彎'], 0: ['', '持平'] };
  // 多的在前，算不出來的放最後；一樣多的照月線 5 天後變多少（dir 1：往上多的在前，-1：往下多的在前）
  const most = (k, dir) => (a, b) => (b[k] ?? -1) - (a[k] ?? -1) || ((b.slope ?? 0) - (a.slope ?? 0)) * dir;

  function enrich(r) {
    const { price } = Market.quote(r.code);
    const k = MA.calc(r.code, price);
    const ok = !k.why && k.price !== null;
    return {
      ...r, price, k: ok ? k : null, why: k.why || (ok ? '' : '沒有現價'),
      low: ok ? k.low : null, high: ok ? k.high : null,
      slope: ok ? (k.proj[k.proj.length - 1] - k.prev) / k.prev : null, // 價格不變的話，5 天後的月線比前一天變多少
    };
  }

  // 表格：K 線（小圖）｜現價／月線｜月線上彎、下彎／扣低幾天；點「月線 扣低」在扣低多、扣高多之間換
  const table = {
    cols: [{ label: ['K 線'] }, { label: ['現價', '月線'] }, { label: ['月線', '扣低'], sort: ['high', 'low'] }],
    cells(r) {
      const { k } = r;
      if (!k) return [Table.cell('—'), Table.cell(r.price ? U.fmtNum(r.price, 2) : '—'), Table.cell('—')];
      const [cls, text] = TURN[k.dir];
      return [
        `<span class="tcell kl-cell">${MA.miniHTML(k)}</span>`,
        Table.cell(U.fmtNum(r.price, 2), ma2(k.ma)),
        Table.cell(`<span class="${cls}">${text}</span>`, `扣低 ${k.low}/${MA.DAYS}`, 'strong'),
      ];
    },
  };

  function cardHTML(r) {
    const { k } = r;
    const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
    const [cls, text] = k ? TURN[k.dir] : ['', '—'];
    const tag = holdTagsHTML(r);
    return `
      <div class="card kline-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tag ? `<span class="card-tags">${tag}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>月線</small><b class="kl-dir ${cls}">${text}</b></span>
        </span>
        ${k ? `<span class="kl-mini">${MA.miniHTML(k)}</span>` : ''}
        <span class="card-grid">
          ${cell('現價', r.price ? U.fmtNum(r.price, 2) : '—')}
          ${cell('月線', k ? ma2(k.ma) : '—')}
          ${cell('5 日線', k ? ma2(k.ma5) : '—')}
          ${cell('扣低', k ? `${k.low}/${MA.DAYS}` : '—')}
        </span>
        <span class="card-note">${U.esc(k ? `今天扣 ${md(k.deduct.date)} 的 ${U.fmtNum(k.deduct.close)}；前一天的月線 ${ma2(k.prev)}` : r.why)}</span>
      </div>`;
  }

  // 列表上面的說明（見 market.js 的 intro）：一行寫 K 線到哪一天、現價，小視窗寫怎麼看
  function intro(all, wide) {
    const codes = all.map(r => r.code);
    const price = wide ? `${md(Market.date())} 收盤價` : Market.priceShort(codes);
    const priceFull = wide ? `價格是 ${md(Market.date())} 收盤價（持股和觀察清單連結 Google 時用即時價格）` : Market.priceNote(codes);
    return {
      title: 'K 線怎麼看',
      line: U.esc(Candles.waiting() || `K 線到 ${md(Candles.date())}・${price}`),
      body: '<p>小圖是最近 20 天的 K 棒和月線（20 日均線），右邊的虛線是價格不變時月線怎麼走</p>' +
        `<p>扣低：接下來 ${MA.DAYS} 天要扣的收盤價有幾天比現價低，越多月線越會往上彎；月線的上彎、下彎也用現價算</p>` +
        '<p>點一檔打開大圖，可以自己打價格看月線怎麼走</p>' +
        `<p class="muted">${U.esc(Candles.waiting() || [`K 線到 ${md(Candles.date())}`, priceFull].filter(Boolean).join('；'))}</p>`,
    };
  }

  return {
    title: 'K 線',
    table,
    sorts: [['low', '扣低多的在前', most('low', 1)], ['high', '扣高多的在前', most('high', -1)], ['code', '依代號', null]],
    enrich, cardHTML, intro,
  };
})();

// K 線大圖：行情 K 線頁點一列、詳細頁點小圖，從底部彈出（和詳細頁一樣）
//   最上面：上一檔、下一檔（從 K 線頁打開時照列表的順序；從詳細頁打開時沒有）
//   自己輸入今天的價格（一開始帶入現價、點了全選），下面跟著算：扣抵值｜月線｜變化（上彎紅、下彎綠），前一天的月線、5 日線
//   大圖（見 MA.chartHTML）：點 K 棒看那天的收開高低；最下面一排之後 4 天的扣抵值（比輸入的價格低紅、高綠）
//   打字時只重畫結果（outHTML），輸入框不會失去焦點；輸入的價格換一檔、重新打開時清掉
const KLine = (() => {
  const dlg = document.getElementById('kline-sheet');
  // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）時什麼都不做
  if (!dlg) return { init() {}, open() {}, refresh() {} };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const md = d => U.fmtDate(d).slice(5);
  const ma2 = v => U.fmtNum(U.round(v, 2), 2);
  const TURN = { 1: '上彎', '-1': '下彎', 0: '持平' };
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  let code = null;
  let codes = [];    // 上一檔、下一檔的順序
  let typed = null;  // 輸入的價格（字串）；重畫時留著
  let price = null;  // 一開始帶入的現價

  const nameOf = c => (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || Store.list('watch').find(r => key(r.code) === c)?.name || '';

  // c：哪一檔；list：上一檔、下一檔的順序（K 線頁的列表），沒有就不顯示
  function open(c, list = []) {
    codes = list.map(key);
    go(c);
    if (!dlg.open) dlg.showModal();
  }

  function go(c) {
    code = key(c);
    typed = null;
    MA.resetChart();
    Candles.need();
    render();
    bodyEl.scrollTop = 0;
  }

  // 資料變了（K 線資料下載好、現價更新）：開著的話重畫；正在打字時不動，免得輸入框不見
  function refresh() {
    if (dlg.open && !bodyEl.contains(document.activeElement)) render();
  }

  function render() {
    titleEl.textContent = `${code} ${nameOf(code)}`.trim();
    price = Market.quote(code).price;
    const i = codes.indexOf(code);
    const nav = codes.length > 1 && i >= 0 ? `
      <div class="kl-nav">
        <button type="button" class="text-btn" data-act="prev"${i === 0 ? ' disabled' : ''}>‹ 上一檔</button>
        <span>${i + 1} / ${codes.length}</span>
        <button type="button" class="text-btn" data-act="next"${i === codes.length - 1 ? ' disabled' : ''}>下一檔 ›</button>
      </div>` : '';
    const v = typed ?? (price ? String(price) : '');
    const r = MA.calc(code, U.parseNum(v));
    bodyEl.innerHTML = nav + (r.why ? `<p class="note muted">${U.esc(r.why)}</p>` : `
      <div class="card static detail-card ma-card">
        <label class="ma-price"><span>${MA.dayName(r.last)}的價格</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${U.esc(v)}" data-ma></label>
        <div class="ma-out">${outHTML(r)}</div>
      </div>`);
  }

  function outHTML(r) {
    const tone = d => (d > 0 ? 'up' : d < 0 ? 'down' : '');
    const diff = r.ma === null ? 0 : U.round(r.ma - r.prev, 4);
    const change = r.ma === null ? '—' : `${diff > 0 ? '+' : ''}${U.fmtNum(diff, 2)}<small>${TURN[r.dir]}</small>`;
    const prevDir = r.prevDir === null ? '' : `，${TURN[r.prevDir]}`;
    const week = r.ma5 === null ? '' : `；5 日線 ${ma2(r.ma5)}，${TURN[r.dir5]}`;
    // 收盤價照原本的小數位寫（2,385、35.47）：一排四格，補成 2,385.00 會擠成兩行
    const next = r.next.map(x => cell(md(x.date), U.fmtNum(x.close), r.price === null ? '' : tone(r.price - x.close))).join('');
    return `
      <span class="card-grid">
        ${cell(`扣抵值 ${md(r.deduct.date)}`, U.fmtNum(r.deduct.close), r.price === null ? '' : tone(r.price - r.deduct.close))}
        ${cell('月線', r.ma === null ? '—' : ma2(r.ma), 'strong')}
        ${cell('變化', change, `strong ${tone(r.dir)}`)}
      </span>
      <span class="card-note">前一天（${md(r.last)}）的月線 ${ma2(r.prev)}${prevDir}${week}</span>
      <div class="kc">${MA.chartHTML(r)}</div>
      <span class="card-grid ma-next">${next}</span>
      <span class="card-note">之後 ${r.next.length} 天依序要扣的收盤價：比你輸入的價格低（紅）是扣低，價格不變月線就往上彎；高（綠）是扣高</span>`;
  }

  function init() {
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
    bodyEl.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const i = codes.indexOf(code);
      if (act === 'prev' && i > 0) go(codes[i - 1]);
      else if (act === 'next' && i >= 0 && i < codes.length - 1) go(codes[i + 1]);
    });
    bodyEl.addEventListener('input', e => {
      if (!e.target.matches('[data-ma]')) return;
      typed = e.target.value;
      const out = bodyEl.querySelector('.ma-out');
      if (out) out.innerHTML = outHTML(MA.calc(code, U.parseNum(typed)));
    });
    bodyEl.addEventListener('focusin', e => { if (e.target.matches('[data-ma]')) e.target.select(); }); // 點了直接打新的價格
    bodyEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-ma]')) e.target.blur(); }); // 收起鍵盤
    MA.bindChart(bodyEl); // 點哪一根看哪一天
  }

  return { init, open, refresh };
})();
