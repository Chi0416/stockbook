// K 線：選股的一頁（列表、「持有｜觀察｜全市場｜成分股」、搜尋見 market.js），每一列一張小 K 線圖（最近 20 天和月線，見 MA.miniHTML）
//   月線往哪裡彎、扣低幾天，用現價算（和殖利率頁的現價一樣，見 market.js 的 quote）：
//     月線：價格是現價的話，今天的月線比前一天高（上彎）、低（下彎）
//     扣低：接下來 5 天要扣的收盤價有幾天比現價低；扣低越多，價格不變的話月線越會往上彎
//   排序：扣低多的在前（預設，找月線快要往上彎的）、扣高多的在前、依代號；算不出來的放最後
//     扣低一樣多的：價格不變的話，5 天後的月線比前一天高越多（%）的在前（扣高的反過來）
//   點一列打開詳細頁，K 線那一段直接展開成大圖（見 detail.js），上一檔、下一檔照目前列表的順序
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
        '<p>點一檔打開詳細資料，K 線那一段直接展開成大圖，可以自己打價格看月線怎麼走</p>' +
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
