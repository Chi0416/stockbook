// 行情：底部「行情」一格，每個指標一頁（殖利率｜KD｜EPS，之後的其他指標往後加，見 app.js 的 GROUPS）
//   每一頁上面切換「全部｜持有｜觀察｜全市場」（每一頁一起切換）：
//     全部：持股和觀察清單，同一檔只列一次，標「持有」或「觀察」；持股跟著設定裡勾的成員，觀察清單全家共用一份
//     持有、觀察：只看其中一邊（你也持有的觀察清單股票，兩邊都有）
//     全市場：收盤資料裡的每一檔（上市、上櫃約 2,400 檔），照排序先列前 50 檔，下面「再顯示 50 檔」；搜尋時找全部
//   觀察清單在右上角「新增觀察」裡新增、移除（見 form.js），詳細頁裡也可以加入、移除（見 detail.js）
//   點卡片打開那一檔的詳細頁（見 detail.js）
//   每一頁不一樣的地方（排序、卡片、說明）寫在 YIELD_PAGE（yield.js）、KD_PAGE（kd.js）、EPS_PAGE（eps.js）、STARS_PAGE（stars.js）
//
// Market：收盤價和日 KD（shared/prices.json，由 tools/update-prices.mjs 產生）
//   GitHub 每個工作天收盤後自動更新這個檔案（見 .github/workflows/update-prices.yml），不用改版本號：
//     App 打開時下載（load），從背景切回來、網路恢復時，距離上次超過 30 分鐘再檢查一次（refresh）
//     每次都先問網站有沒有新的（沒變只回一個很小的回應）；沒有網路時用瀏覽器暫存的上一份
//     第一次下載好、或下載到不一樣的資料時通知 onChange（app.js 重畫總覽和行情）
//   現價（quote）：連結 Google 時用 GOOGLEFINANCE 抓的（見 sync.js，盤中會跟著變）；
//     抓不到的（上櫃常常抓不到）、沒連結 Google 的，用最近一次的收盤價
const Market = (() => {
  const FILE = 'shared/prices.json';
  const AGAIN = 30 * 60000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();

  // 測試時直接放一份全域的 PRICE_LIST，不用下載
  let data = typeof PRICE_LIST !== 'undefined' ? PRICE_LIST : null;
  let state = data ? 'ready' : 'loading';
  let text = '';      // 上次下載到的內容，一樣的就不通知
  let lastTry = 0;
  let pending = null; // 下載中（同時只下載一次）
  const listeners = [];

  // 下載收盤資料：有新的資料、或第一次就下載失敗時通知 onChange；下載失敗、格式不對時留著原本的資料
  function load() {
    if (pending) return pending;
    lastTry = Date.now();
    const get = async mode => {
      try {
        const res = await fetch(FILE, { cache: mode });
        return res.ok ? await res.text() : null;
      } catch (_) {
        return null;
      }
    };
    pending = (async () => {
      const got = (await get('no-cache')) ?? (await get('force-cache'));
      let changed = false;
      if (got !== null && got !== text) {
        try {
          const next = JSON.parse(got);
          if (typeof next.date === 'string' && next.rows && typeof next.rows === 'object') {
            data = next;
            text = got;
            state = 'ready';
            changed = true;
          }
        } catch (_) {}
      }
      if (!data && state !== 'failed') {
        state = 'failed';
        changed = true;
      }
      pending = null;
      if (changed) listeners.forEach(fn => fn());
      return changed;
    })();
    return pending;
  }

  // 從背景切回來、網路恢復時：還沒下載成功的馬上再試，下載過的隔 30 分鐘才再檢查
  const refresh = () => (state !== 'ready' || Date.now() - lastTry >= AGAIN ? load() : Promise.resolve(false));

  // 這一檔的收盤價和 KD：{ close, k, d, pk（前一個交易日的 K）, pd, date（收盤價是哪一天的）}
  //   K、D 是 null：成交不到 9 天，還算不出來；資料裡沒有這一檔（興櫃、還沒開始交易）時回傳 null
  function get(code) {
    const r = data?.rows[key(code)];
    return r ? { close: r[0], k: r[1], d: r[2], pk: r[3], pd: r[4], date: r[5] || data.date } : null;
  }

  // 現價：{ price, close: 用收盤價時是哪一天的（用 GOOGLEFINANCE 的是 ''）}；都沒有時 price 是 null
  const live = () => (typeof Sync !== 'undefined' && Sync.state().linked ? Sync.prices() : null);
  function quote(code) {
    const p = live()?.quotes[key(code)];
    if (typeof p === 'number' && p > 0) return { price: p, close: '' };
    const m = get(code);
    return m ? { price: m.close, close: m.date } : { price: null, close: '' };
  }

  // 今年的日期只寫月/日
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));

  // 收盤資料還沒下載好、下載不了時的說明（下載好了是 ''）
  const waiting = () => (state === 'ready' ? '' : state === 'failed' ? '下載不了收盤價（連上網路後會再試）' : '收盤價還在下載');

  // 價格的說明（總覽的持股、行情的殖利率列表上面）：「現價 14:05 更新，可能延遲 20 分鐘；2 檔抓不到，用 10/07 收盤價」
  function priceNote(codes) {
    const q = live();
    const quotes = codes.map(quote);
    const closed = quotes.filter(x => x.close).length;
    const none = quotes.filter(x => x.price === null).length;
    const day = data ? md(data.date) : '';
    const parts = [];
    if (q) {
      const t = q.at ? U.fmtDateTime(q.at) : '';
      const time = t.startsWith(U.today().replace(/-/g, '/')) ? t.slice(11) : t;
      parts.push(time ? `現價 ${time} 更新，可能延遲 20 分鐘` : '正在抓現價…');
      if (closed) parts.push(`${closed} 檔抓不到，用 ${day} 收盤價`);
    } else if (closed) {
      parts.push(`價格是 ${day} 收盤價（連結 Google 帳號後，盤中會抓即時價格）`);
    }
    if (none) parts.push(waiting() || `${none} 檔沒有價格`);
    return parts.join('；');
  }

  return {
    get, quote, priceNote, waiting, load, refresh,
    // 資料裡的每一檔（行情的「全市場」）
    codes: () => (data ? Object.keys(data.rows) : []),
    date: () => (data ? data.date : ''),
    state: () => state,
    ready: () => state === 'ready',
    onChange: fn => listeners.push(fn),
  };
})();

// 行情每一頁共用的「全部｜持有｜觀察｜全市場」：切換時每一頁一起重畫，換到別頁還是同一個範圍
const MARKET_VIEW = { range: 'all', pages: [] };

// 持有、觀察的標籤（行情的卡片、詳細頁）：兩邊都有就兩個都標
//   「觀察」也會列出你持有的觀察清單股票，只標「持有」會看不懂它為什麼在這裡；也提醒買了之後可以從觀察清單移除
function holdTagsHTML(r) {
  return (r.held ? '<span class="badge member">持有</span>' : '') + (r.watched ? '<span class="badge">觀察</span>' : '');
}

// 行情的一頁：page 是 YIELD_PAGE、KD_PAGE、EPS_PAGE、STARS_PAGE；和其他列表一樣有 el、refresh、reset、changed
//   page.sorts：[[值, 選單上的字, 比較的函式]]，第一個是預設；一樣的時候依代號
//   page.enrich(r)：加上這一頁要顯示的數字；page.cardHTML(r)：一張卡片；page.introHTML(rows, 全市場, 沒列出幾檔)：列表上面的說明
//   page.keep(r)（可以沒有）：這一頁只列哪些（EPS 頁不列 ETF）；全部沒列出時用 page.skippedHTML(幾檔, 全市場) 那句話
//   openStock(代號)：點卡片時打開詳細頁
function createMarket(page, { openStock = () => {} } = {}) {
  const RANGES = [['all', '全部'], ['held', '持有'], ['watch', '觀察'], ['market', '全市場']];
  const STEP = 50; // 全市場一次列幾檔
  const state = { keyword: '', sort: page.sorts[0][0], limit: STEP };
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
  keywordInput.addEventListener('input', () => { state.keyword = keywordInput.value; state.limit = STEP; render(); });
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (btn?.dataset.act === 'range') {
      setRange(btn.dataset.value);
      return;
    }
    if (btn?.dataset.act === 'more') {
      state.limit += STEP;
      render();
      return;
    }
    if (btn) return; // 說明裡的「調整」（app.js 打開設定）
    const card = e.target.closest('.card[data-code]');
    if (card) openStock(card.dataset.code);
  });

  // 搜尋的字留著（「看全市場」是要在全市場找同一個字）
  function setRange(range) {
    if (range === MARKET_VIEW.range) return;
    MARKET_VIEW.range = range;
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

  const rangeHTML = () => `
    <div class="seg range" role="group" aria-label="列出哪些股票">
      ${RANGES.map(([v, label]) => `<button type="button" data-act="range" data-value="${v}" aria-pressed="${MARKET_VIEW.range === v}">${label}</button>`).join('')}
    </div>`;

  function render() {
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
    const base = wide ? market(my) : my.filter(r => range === 'all' || (range === 'held' ? r.held : r.watched));
    const enriched = base.filter(match).map(page.enrich);
    const all = page.keep ? enriched.filter(page.keep) : enriched;
    const skipped = enriched.length - all.length;
    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const cmp = page.sorts.find(([v]) => v === state.sort)[2];
    all.sort((a, b) => (cmp ? cmp(a, b) : 0) || byCode(a, b));
    const shown = wide ? all.slice(0, state.limit) : all;
    countEl.textContent = `${U.fmtNum(all.length)} 檔`;

    let empty = '';
    if (!all.length) {
      // 持股、觀察清單裡找不到，全市場有：給一個按鈕切過去
      const elsewhere = !wide && kw && Market.ready() ? Market.codes().filter(c => match({ code: c, name: names()[c] || '' })).length : 0;
      empty = skipped ? page.skippedHTML(skipped, wide)
        : elsewhere ? `這裡沒有符合的股票<br><button type="button" class="link-btn" data-act="range" data-value="market">全市場有 ${elsewhere} 檔符合，看全市場</button>`
        : kw ? '沒有符合條件的股票'
        : range === 'held' ? '目前沒有持股<br>到「記帳」記一筆買進，或照券商的庫存填一期快照'
        : range === 'watch' ? '還沒有觀察的股票<br>點右上角「新增觀察」，打代號或名稱加進來<br>也可以在「全市場」點一檔，加入觀察清單'
        : '還沒有持股和觀察的股票<br>到「記帳」記一筆買進，或點右上角「新增觀察」<br>也可以切到「全市場」看全部的股票';
    }
    const more = wide && all.length > shown.length
      ? `<button type="button" class="wide-btn more-btn" data-act="more">再顯示 ${Math.min(STEP, all.length - shown.length)} 檔（還有 ${U.fmtNum(all.length - shown.length)} 檔）</button>` : '';
    listEl.innerHTML = rangeHTML() + (all.length ? page.introHTML(all, wide, skipped) : '') +
      (shown.length ? shown.map(page.cardHTML).join('') + more : `<p class="empty">${empty}</p>`);
  }

  function reset() {
    state.keyword = '';
    state.limit = STEP;
    keywordInput.value = '';
    render();
  }

  // 剛加進觀察清單的那一檔閃一下；只看持有時先切回全部，才看得到
  function changed(rec) {
    if (rec?.code && MARKET_VIEW.range === 'held') MARKET_VIEW.range = 'all';
    render();
    const card = rec?.code && listEl.querySelector(`[data-code="${CSS.escape(key(rec.code))}"]`);
    if (card) {
      card.classList.add('flash');
      card.scrollIntoView({ block: 'nearest' });
    }
  }

  const view = {
    el, refresh: render, reset, changed,
    ranged() { state.limit = STEP; render(); },
  };
  MARKET_VIEW.pages.push(view);
  return view;
}
