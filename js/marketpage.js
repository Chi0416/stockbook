// 看股票的頁：每個指標一頁（見 app.js 的 GROUPS）；選股那一格的 K 線｜KD｜ETF 持有｜殖利率｜EPS｜★ 星星
//   每一頁上面切換「持有｜觀察｜全市場｜成分股」（每一頁一起切換，換到選股的別頁還是同一個範圍）：
//     觀察（預設）：觀察清單加上持股，同一檔只列一次，標「持有」「觀察」；持股跟著設定裡勾的成員，觀察清單全家共用一份
//       2026-10-16 起不另外分「全部」：持股不用再加進觀察清單，新買的自動出現
//     持有：只看持股
//     全市場：收盤資料裡的每一檔（上市、上櫃約 2,400 檔），照排序先列前 50 檔，下面「再顯示 50 檔」；搜尋時找全部
//     成分股：選一檔 ETF，列出它的成分股（見 etf.js），代號後面寫權重；選單下面寫哪家投信、哪一天公布的（不是每天更新，免得誤會）
//       排序照每一頁自己的，「依代號」在這裡換成「依權重」（大的在前），一樣的時候也照權重
//   觀察清單在右上角「新增觀察」裡新增、移除（見 form.js），詳細頁裡也可以加入、移除（見 detail.js）
//   點卡片打開那一檔的詳細頁（見 detail.js）
//   每一頁不一樣的地方（排序、卡片、說明）寫在 YIELD_PAGE（yield.js）、EPS_PAGE（eps.js）、KLINE_PAGE（kline.js）、KD_PAGE（kd.js）、ETF_PAGE（etf.js）、STARS_PAGE（stars.js）

// 看股票的頁共用的「持有｜觀察｜全市場｜成分股」：切換時每一頁一起重畫，換到別頁還是同一個範圍
const MARKET_VIEW = { range: 'watch', pages: [] };

// 持有、觀察的標籤（選股的卡片、詳細頁）：兩邊都有就兩個都標
//   「觀察」也會列出你持有的觀察清單股票，只標「持有」會看不懂它為什麼在這裡；也提醒買了之後可以從觀察清單移除
//   看 ETF 的成分股時，最後面寫這一檔佔 ETF 的權重
function holdTagsHTML(r) {
  return (r.held ? '<span class="badge member">持有</span>' : '') + (r.watched ? '<span class="badge">觀察</span>' : '') +
    (typeof r.weight === 'number' ? `<span class="etf-w">${U.fmtNum(r.weight, 2)}%</span>` : '');
}

// 看股票的一頁：page 是 YIELD_PAGE、EPS_PAGE、KLINE_PAGE、KD_PAGE、ETF_PAGE、STARS_PAGE；和其他列表一樣有 el、refresh、reset、changed
//   page.sorts：[[值, 選單上的字, 比較的函式]]，第一個是預設；一樣的時候依代號
//   page.table：預設畫成表格，設定裡打開「詳細卡片」時用 page.cardHTML（見 table.js）：{ cols: [{ label: [上, 下], sort }], cells(r): 證券以外每一格 }
//     sort 是 page.sorts 的值，點表頭等於在排序選單選那一個；給 [小到大, 大到小] 兩個時，再點一次換另一個（KD 的 K 值）
//   page.enrich(r)：加上這一頁要顯示的數字；page.cardHTML(r)：一張卡片
//   page.tagHTML(r)（可以沒有）：表格的代號後面，持有、觀察以外多標的標籤（EPS 頁的財報季）
//   page.intro(rows, 全市場, 沒列出幾檔)：列表上面的說明 { title, line, body }（都是 HTML）
//     line 是收起來的那一行，寫資料是哪一天的（一定看得到，免得誤會）；右邊「說明」點了用小泡泡（Note）打開 body，title 給讀螢幕的
//   page.keep(r)（可以沒有）：這一頁只列哪些（EPS 頁不列 ETF）；全部沒列出時用 page.skippedHTML(幾檔, 全市場) 那句話
//   openStock(代號)：點卡片時打開詳細頁（每一頁都是；上一檔、下一檔用 view.codes() 目前列出的順序）
function createMarket(page, { openStock = () => {} } = {}) {
  const RANGES = [['held', '持有'], ['watch', '觀察'], ['market', '全市場'], ['etf', '成分股']];
  const STEP = 50; // 全市場一次列幾檔
  const state = { keyword: '', sort: page.sorts[0][0], limit: STEP };
  let listed = []; // 目前列出的代號，照畫面上的順序
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const names = () => (typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {});

  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <select class="f-sort" aria-label="排序">
        ${page.sorts.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}
      </select>
      <input class="f-keyword" type="search" placeholder="搜尋代號或證券" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;
  const sortSel = el.querySelector('.f-sort');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.limit = STEP; render(); });
  // 成分股：換一檔 ETF，每一頁一起換
  listEl.addEventListener('change', e => {
    if (!e.target.matches('.etf-pick')) return;
    Etf.select(e.target.value);
    MARKET_VIEW.pages.forEach(p => p.ranged());
  });
  // 注音打到一半（還有ㄅㄆㄇ）不搜尋，選好字才搜（見 util.js 的 zhuyinPending）
  const onKeyword = () => { state.keyword = keywordInput.value; state.limit = STEP; render(); };
  keywordInput.addEventListener('input', e => { if (!(e.isComposing && U.zhuyinPending(keywordInput.value))) onKeyword(); });
  keywordInput.addEventListener('compositionend', onKeyword);
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (btn?.dataset.act === 'range') {
      setRange(btn.dataset.value);
      return;
    }
    if (btn?.dataset.act === 'sort') {
      const col = cols().find(c => [].concat(c.sort).includes(btn.dataset.value));
      const pair = [].concat(col?.sort || btn.dataset.value);
      state.sort = pair.length > 1 && state.sort === pair[0] ? pair[1] : pair[0];
      sortSel.value = state.sort;
      state.limit = STEP;
      render();
      return;
    }
    if (btn?.dataset.act === 'more') {
      state.limit += STEP;
      render();
      return;
    }
    if (btn) return;
    const card = e.target.closest('.card[data-code], .trow[data-code]');
    if (card) openStock(card.dataset.code);
  });

  // 搜尋的字留著（「看全市場」是要在全市場找同一個字）
  function setRange(range) {
    if (range === MARKET_VIEW.range) return;
    MARKET_VIEW.range = range;
    if (range === 'etf') Etf.need(); // 第一次切過來才下載，下載好了 app.js 重畫每一頁
    MARKET_VIEW.pages.forEach(p => p.ranged());
  }

  // 持股（股數大於 0）在前，觀察清單裡沒持有的接在後面；held：設定裡勾的成員有持有，watched：在觀察清單裡
  function mine() {
    const h = Holdings.all(U.today());
    const watched = new Map();
    Store.list('watch').forEach(r => { if (key(r.code) && !watched.has(key(r.code))) watched.set(key(r.code), r.name); });
    const out = (h ? h.positions : []).filter(p => p.shares > 0)
      .map(p => ({ code: key(p.code), name: p.name, held: true, watched: watched.has(key(p.code)) }));
    const have = new Set(out.map(r => r.code));
    watched.forEach((name, code) => { if (!have.has(code)) out.push({ code, name, held: false, watched: true }); });
    return out;
  }

  // 全市場：收盤資料裡的每一檔，加上持股和觀察清單（興櫃之類收盤資料裡沒有的也列）；名稱用證交所的清單，沒有的用自己記的
  function market(my) {
    const list = names();
    const byCode = new Map(my.map(r => [r.code, r]));
    const out = Market.codes().map(code => byCode.get(code) || { code, name: list[code] || '', held: false, watched: false });
    my.forEach(r => { if (!Market.get(r.code)) out.push(r); });
    return out;
  }

  // ETF 的成分股：照權重（大的在前），持股、觀察清單裡有的照樣標持有、觀察；名稱用證交所的清單
  function members(my, etf) {
    const byCode = new Map(my.map(r => [r.code, r]));
    return etf.holdings.map(([code, weight]) => ({ ...(byCode.get(code) || { code, name: names()[code] || '', held: false, watched: false }), weight }));
  }

  // 選 ETF 的選單，下面寫成分股是哪家投信、哪一天公布的
  const etfHTML = etf => `
    <div class="etf-bar">
      <select class="etf-pick" aria-label="選一檔 ETF 看成分股">
        ${Etf.list().map(e => `<option value="${U.esc(e.code)}"${e.code === etf.code ? ' selected' : ''}>${U.esc(e.code)} ${U.esc(e.name)}（${e.holdings.length} 檔）</option>`).join('')}
      </select>
      <p class="etf-src">${U.esc(etf.source)} ${U.esc(U.fmtDate(etf.date))} 公布</p>
    </div>`;

  // 列表上面一行：資料是哪一天的，右邊「說明」；看成分股時說明最後多一段成分股資料從哪裡來
  function introHTML(all, wide, skipped, etf) {
    const it = page.intro(all, wide, skipped);
    const etfNote = etf ? `<p>成分股和權重是從${U.esc(etf.source)}網站抄下來的（${U.esc(U.fmtDate(etf.date))} 公布），` +
      '不是每天更新，ETF 調整成分股時才更新，所以權重和今天可能差一點。</p>' : '';
    return Note.line(it.line, it.title, it.body + etfNote);
  }

  // 表格：第一欄是證券／代號（依代號排序；看成分股時是依權重），其他欄照 page.table.cols；持有、觀察接在代號後面
  const cols = () => [{ label: ['證券', MARKET_VIEW.range === 'etf' ? '權重' : '代號'], sort: 'code' }, ...page.table.cols];
  // 排序的方向：兩個值的欄位前一個是小到大；依代號小到大（依權重大到小）；其他大到小
  const dirOf = c => {
    const pair = [].concat(c.sort || []);
    if (!pair.includes(state.sort)) return '';
    return pair.length > 1 ? (state.sort === pair[0] ? 'asc' : 'desc') : state.sort === 'code' && MARKET_VIEW.range !== 'etf' ? 'asc' : 'desc';
  };
  const tableHTML = rows => Table.html(cols().map(c => ({ ...c, sort: [].concat(c.sort || [])[0], dir: dirOf(c) })),
    rows.map(r => {
      const tags = holdTagsHTML(r) + (page.tagHTML ? page.tagHTML(r) : '');
      return Table.row({ attrs: `data-code="${U.esc(r.code)}"`, cells: [Table.name(r.name, r.code, tags ? ` ${tags}` : ''), ...page.table.cells(r)] });
    }));

  const rangeHTML = () => `
    <div class="seg range" role="group" aria-label="列出哪些股票">
      ${RANGES.map(([v, label]) => `<button type="button" data-act="range" data-value="${v}" aria-pressed="${MARKET_VIEW.range === v}">${label}</button>`).join('')}
    </div>`;

  // 看不到的頁（不是目前這一頁）先不畫，記著要重畫，切過來時（shown）才畫：存一筆、換範圍時選股 6 頁不用全部重算
  let stale = false;
  function refresh() {
    if (el.hidden) stale = true;
    else render();
  }
  function shown() {
    if (stale) render();
  }

  function render() {
    stale = false;
    const kw = state.keyword.trim().toLowerCase();
    const match = r => !kw || `${r.code} ${r.name}`.toLowerCase().includes(kw);
    const my = mine();
    const wide = MARKET_VIEW.range === 'market';
    if (wide && !Market.ready()) {
      countEl.textContent = '';
      listEl.innerHTML = rangeHTML() + `<p class="empty">${Market.waiting()}</p>`;
      return;
    }
    const range = MARKET_VIEW.range;
    const etfMode = range === 'etf';
    sortSel.querySelector('option[value="code"]').textContent = etfMode ? '依權重' : '依代號';
    const etf = etfMode ? Etf.current() : null;
    if (etfMode && !etf) {
      Etf.need();
      countEl.textContent = '';
      listEl.innerHTML = rangeHTML() + `<p class="empty">${Etf.waiting()}</p>`;
      return;
    }
    const base = wide ? market(my) : etfMode ? members(my, etf)
      : range === 'held' ? my.filter(r => r.held) : my;
    const enriched = base.filter(match).map(page.enrich);
    const all = page.keep ? enriched.filter(page.keep) : enriched;
    const skipped = enriched.length - all.length;
    // 一樣的時候依代號；看成分股時依權重
    const byCode = etfMode ? (a, b) => b.weight - a.weight : (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const cmp = page.sorts.find(([v]) => v === state.sort)[2];
    all.sort((a, b) => (cmp ? cmp(a, b) : 0) || byCode(a, b));
    const shown = wide ? all.slice(0, state.limit) : all;
    listed = shown.map(r => r.code);
    countEl.textContent = `${U.fmtNum(all.length)} 檔`;

    let empty = '';
    if (!all.length) {
      // 持股、觀察清單裡找不到，全市場有：給一個按鈕切過去
      const elsewhere = !wide && kw && Market.ready() ? Market.codes().filter(c => match({ code: c, name: names()[c] || '' })).length : 0;
      empty = skipped ? page.skippedHTML(skipped, wide)
        : elsewhere ? `這裡沒有符合的股票<br><button type="button" class="link-btn" data-act="range" data-value="market">全市場有 ${elsewhere} 檔符合，看全市場</button>`
        : kw ? '沒有符合條件的股票'
        : range === 'held' ? '目前沒有持股<br>到「帳務」記一筆買進，或照券商的庫存填一期快照'
        : '還沒有持股和觀察的股票<br>點右上角「新增觀察」，打代號或名稱加進來<br>也可以切到「全市場」點一檔，加入觀察清單';
    }
    const more = wide && all.length > shown.length
      ? `<button type="button" class="wide-btn more-btn" data-act="more">再顯示 ${Math.min(STEP, all.length - shown.length)} 檔（還有 ${U.fmtNum(all.length - shown.length)} 檔）</button>` : '';
    listEl.innerHTML = rangeHTML() + (etfMode ? etfHTML(etf) : '') + (all.length ? introHTML(all, wide, skipped, etf) : '') +
      (shown.length ? (Cards.on ? shown.map(page.cardHTML).join('') : tableHTML(shown)) + more : `<p class="empty">${empty}</p>`);
  }

  function reset() {
    state.keyword = '';
    state.limit = STEP;
    keywordInput.value = '';
    refresh();
  }

  // 剛加進觀察清單的那一檔閃一下；只看持有時先切回觀察，才看得到
  function changed(rec) {
    if (rec?.code && MARKET_VIEW.range === 'held') MARKET_VIEW.range = 'watch';
    if (el.hidden) {
      stale = true;
      return;
    }
    render();
    const card = rec?.code && listEl.querySelector(`[data-code="${CSS.escape(key(rec.code))}"]`);
    if (card) {
      card.classList.add('flash');
      card.scrollIntoView({ block: 'nearest' });
    }
  }

  const view = {
    el, refresh, reset, changed, shown,
    codes: () => listed,
    ranged() { state.limit = STEP; refresh(); },
  };
  MARKET_VIEW.pages.push(view);
  return view;
}
