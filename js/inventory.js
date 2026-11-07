// 庫存（帳務的第一頁）：上方庫存總市值、下方目前每檔持股；全部由其他資料表推算，不另外儲存
//   庫存總市值：每檔股數 × 現價（現價見下面），抓不到現價的那幾檔不算進去
//     損益試算 = 市值 − 那幾檔的付出成本；報酬率 = 損益 ÷ 那幾檔的付出成本（沒有扣掉賣出的手續費和證交稅）
//     付出成本和券商 App 一樣已經扣掉除息的現金股利，所以損益包含領到的股利
//     總付出成本：目前持股的成本加總（持股與成本的算法見 holdings.js：最近一期快照＋之後的交易和除息，沒有快照時加總全部交易）
//   帳戶走勢：點庫存總市值卡片（眼睛以外的地方）彈出折線圖，每天的付出成本和市值（見 trend.js、history.js）
//     卡片右下角寫「走勢 ›」，看得出來可以點
//   全家檢視時各成員分別推算後合計，持股卡片下方列出每人的股數
//   庫存總市值卡片右上角的眼睛：隱藏金額的開關（見 privacy.js），像網路銀行的隱藏餘額
//   現價：連結 Google 時用試算表的 GOOGLEFINANCE 抓的延遲價（見 sync.js），抓不到的、沒連結的、收盤資料比較新的用收盤價（見 market.js 的 quote）
//     持股列表上方寫是哪一種、什麼時候的；兩種都有時，用收盤價的那幾列標「收」；不是自己的資料，隱藏金額時照常顯示
//   點一檔持股打開「未實現損益」（hooks.openStock，見 mine.js）：這一檔的損益、交易明細、股利明細和快照
//     庫存是算出來的，不能直接改；帳務的其他頁點一筆才是修改
const INVENTORY = { title: '庫存' };

function createInventory(hooks) {
  // sort／desc：表格依哪一欄排序（預設代號小到大，和券商 App 一樣）
  const state = { keyword: '', sort: 'code', desc: false };

  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="kpis"></div>
    <div class="filterbar">
      <input class="f-keyword" type="search" placeholder="搜尋代號或證券" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;

  const kpisEl = el.querySelector('.kpis');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  // 注音打到一半（還有ㄅㄆㄇ）不搜尋，選好字才搜（見 util.js 的 zhuyinPending）
  const onKeyword = () => { state.keyword = keywordInput.value; renderList(); };
  keywordInput.addEventListener('input', e => { if (!(e.isComposing && U.zhuyinPending(keywordInput.value))) onKeyword(); });
  keywordInput.addEventListener('compositionend', onKeyword);
  // 表頭排序：換一欄時代號小到大、其他大到小，再點一次反過來；點一檔打開「我的」
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act="sort"]');
    if (!btn) {
      const row = e.target.closest('[data-code]');
      if (row) hooks.openStock(row.dataset.code);
      return;
    }
    const k = btn.dataset.value;
    state.desc = state.sort === k ? !state.desc : k !== 'code';
    state.sort = k;
    renderList();
  });
  // 切換後每一頁都會重畫（app.js），眼睛按鈕也換了一個，焦點放回新的按鈕
  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('[data-act="privacy"]')) return;
    Privacy.toggle();
    kpisEl.querySelector('[data-act="privacy"]')?.focus({ preventScroll: true });
  });
  // 帳戶走勢（見 trend.js）：點庫存總市值卡片任何地方都打開（眼睛是隱藏金額，不算）
  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('.kpi.hero') || e.target.closest('[data-act="privacy"]')) return;
    Trend.open();
  });

  // 金額、股數、成本均價：隱藏金額時顯示成 ***
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const shares = n => Privacy.num(U.fmtNum(n));
  // 眼睛：看得到金額時是睜開的（按了隱藏），隱藏時加一條斜線（按了顯示）
  const eyeHTML = () => `
    <button type="button" class="eye-btn" data-act="privacy" aria-pressed="${Privacy.hidden}"
      aria-label="${Privacy.hidden ? '顯示金額' : '隱藏金額'}" title="${Privacy.hidden ? '顯示金額' : '隱藏金額'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>${Privacy.hidden ? '<path d="M4 4l16 16"/>' : ''}</svg>
    </button>`;

  // ---------- 庫存總市值 ----------
  function renderKpis(holdings) {
    // 推算的起點：同一期快照、全部從 0 加總交易，或全家各成員的起點不一樣
    const basis = h => (h.snapDate ? `依 ${U.fmtDate(h.snapDate)} 庫存快照推算到今天`
      : h.mixed ? '依各成員的庫存快照和交易紀錄推算到今天'
      : '依交易紀錄加總到今天');
    // 大數字下面一排三格（損益試算、報酬率、總付出成本）
    //   損益賺錢紅色、賠錢綠色（台股的習慣）；隱藏金額時連正負號和顏色都不顯示
    let hero;
    if (holdings) {
      const priced = holdings.positions.filter(p => p.shares > 0 && priceOf(p.code) !== null);
      const value = priced.reduce((s, p) => s + p.shares * priceOf(p.code), 0);
      const pricedCost = priced.reduce((s, p) => s + p.cost, 0);
      const pl = Math.round(value) - Math.round(pricedCost);
      // 和券商的卡片一樣：賺錢不加「+」，用紅色表示；賠錢留著「-」，綠色（長輩不一定注意得到顏色）
      const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'gain' : 'loss';
      const rate = pricedCost > 0 ? Privacy.num(`${U.fmtNum(U.round(pl / pricedCost * 100, 2), 2)}%`) : '—';
      const unpriced = holdings.positions.filter(p => p.shares > 0).length - priced.length;
      const priceNote = !priced.length ? (Market.waiting() || '抓不到現價，算不出市值')
        : unpriced ? `另有 ${unpriced} 檔抓不到現價，沒有算進市值和損益` : '';
      const cell = (label, v, cls = '') => `<span class="kpi-cell"><small>${label}</small><b class="${cls}">${v}</b></span>`;
      hero = `
        <b>${priced.length ? money(value) : '—'}</b>
        <span class="kpi-row">
          ${cell('損益試算', priced.length ? Privacy.num(U.fmtNum(pl)) : '—', tone)}
          ${cell('報酬率', priced.length ? rate : '—', tone)}
          ${cell('總付出成本', money(holdings.positions.reduce((s, p) => s + p.cost, 0)))}
        </span>
        <span class="kpi-sub">${U.esc(basis(holdings))}</span>
        ${priceNote ? `<span class="kpi-sub">${priceNote}</span>` : ''}`;
    } else {
      hero = `<b>—</b><span class="kpi-sub">還沒有交易紀錄或庫存快照</span>`;
    }
    hero += '<button type="button" class="trend-hint" data-act="trend">走勢<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>';

    kpisEl.innerHTML = `
      <div class="kpi wide hero"><small>庫存總市值</small>${eyeHTML()}${hero}</div>
      ${holdings && holdings.missingCode
        ? `<p class="kpi-note">有 ${holdings.missingCode} 筆快照或交易沒填代號，沒有計入</p>` : ''}
      ${checkNote()}`;
    fitKpis(kpisEl);
  }
  watchKpis(kpisEl);

  // 庫存快照的股數和交易紀錄對不上時提醒（核對明細在庫存快照頁，算法見 holdings.js 的 check）
  // 瀏覽器快取到舊版 holdings.js（還沒有 check）時直接略過，不讓整個頁面壞掉
  function checkNote() {
    if (typeof Holdings.check !== 'function') return '';
    const n = Holdings.check().filter(c => c.status === 'diff').length;
    return n ? `<p class="kpi-note">有 ${n} 筆庫存快照的股數和交易紀錄對不上，明細請看「庫存快照」那一頁</p>` : '';
  }

  // ---------- 持股列表（依代號由小到大，和券商 App 的庫存、對帳單同一個順序，方便對資料） ----------
  function noteHTML(p) {
    // 全家：列出每位成員的股數；有人算出負數時改列那個人的算式
    if (p.parts && Store.members().length > 1) {
      const bad = p.parts.filter(x => x.shares < 0);
      if (bad.length) {
        return bad.map(x => `<span class="card-note warn">${U.esc(Store.memberName(x.member))}的股數算出來是負的` +
          `（${U.esc(Privacy.text(x.formula))}），請檢查資料</span>`).join('');
      }
      const each = p.parts.map(x => `${Store.memberName(x.member)} ${shares(x.shares)} 股`).join(' · ');
      return `<span class="card-note">${U.esc(each)}</span>`;
    }
    const one = p.parts ? p.parts[0] : p;
    return one.shares < 0
      ? `<span class="card-note warn">股數算出來是負的（${U.esc(Privacy.text(one.formula))}），請檢查資料</span>`
      : `<span class="card-note">${U.esc(one.changed ? `股數 = ${Privacy.text(one.formula)}` : `依 ${U.fmtDate(one.snapDate)} 庫存快照`)}</span>`;
  }

  // 現價（延遲價或收盤價，見 market.js 的 quote）；都沒有時是 null
  function priceOf(code) {
    return Market.quote(code).price;
  }

  // 持股上面一行：「延遲 14:05」「延遲 14:05・6488 用 10/07 收盤」「10/16 收盤」，右邊「說明」點了寫完整的（見 market.js 的 priceLine、priceNote、Note）
  function priceNote(positions) {
    const codes = positions.filter(p => p.shares > 0).map(p => p.code);
    const note = Market.priceNote(codes);
    return note ? Note.line(Market.priceLine(codes), '價格', `<p>${U.esc(note)}</p>`) : '';
  }
  // 這次畫的列表是不是兩種價格都有：是的話用收盤價的那幾列標「收」
  let mixed = false;
  const mark = code => (mixed ? Market.closeTag(code) : '');

  // 右上角是現值（股數 × 現價；抓不到現價時是「—」），付出成本放在下面一排，和券商 App 對帳用
  function cardHTML(p) {
    const avg = p.shares > 0 ? U.round(p.cost / p.shares, 2) : null;
    const price = priceOf(p.code);
    const priced = price !== null && p.shares > 0;
    return `
      <button type="button" class="card" data-code="${U.esc(p.code)}">
        <span class="card-top">
          <span class="card-title"><span class="card-code">${U.esc(p.code)}</span>${U.esc(p.name)}</span>
          <span class="card-primary"><small>現值</small><b>${priced ? money(p.shares * price) : '—'}</b></span>
        </span>
        <span class="card-grid">
          <span class="cell"><small>庫存股</small><span>${shares(p.shares)}</span></span>
          <span class="cell"><small>成本均價</small><span>${avg === null ? '—' : Privacy.num(U.fmtNum(avg, 2))}</span></span>
          <span class="cell"><small>現價</small><span>${price !== null ? `${mark(p.code)}${U.fmtNum(U.round(price, 2), 2)}` : '—'}</span></span>
          <span class="cell"><small>付出成本</small><span>${money(p.cost)}</span></span>
        </span>
        ${noteHTML(p)}
      </button>`;
  }

  // 表格（照券商 App 的綜合損益）：證券／代號｜庫存股／現值（兩種價格都有時，用收盤價的標「收」）｜損益／報酬率；抓不到現價時市值、損益是「—」
  //   全家每個人各幾股、股數怎麼算的，設定裡打開「詳細卡片」看；股數算出來是負的紅字照樣寫
  function figures(p) {
    const price = priceOf(p.code);
    const value = price !== null && p.shares > 0 ? p.shares * price : null;
    const pl = value === null ? null : Math.round(value - p.cost);
    return { value, pl, rate: pl !== null && p.cost > 0 ? pl / p.cost : null };
  }

  function rowHTML(p) {
    const { value, pl, rate } = figures(p);
    const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
    const bad = (p.parts || [p]).filter(x => x.shares < 0);
    const note = !bad.length ? ''
      : p.parts && Store.members().length > 1 ? `${bad.map(x => Store.memberName(x.member)).join('、')}的股數算出來是負的，請檢查資料`
      : `股數算出來是負的（${Privacy.text(bad[0].formula)}），請檢查資料`;
    return Table.row({
      attrs: `data-code="${U.esc(p.code)}"`,
      cells: [
        Table.name(p.name, p.code),
        Table.cell(shares(p.shares), value === null ? '—' : `${mark(p.code)}${money(value)}`),
        Table.cell(pl === null ? '—' : Privacy.num(U.fmtNum(pl)),
          rate === null ? '—' : Privacy.num(`${U.fmtNum(U.round(rate * 100, 2), 2)}%`), `strong ${tone}`),
      ],
      note,
    });
  }

  function tableHTML(rows) {
    const dir = k => (state.sort === k ? (state.desc ? 'desc' : 'asc') : '');
    const cols = [
      { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
      { label: ['庫存股', '現值'], sort: 'shares', dir: dir('shares') },
      { label: ['損益', '報酬率'], sort: 'pl', dir: dir('pl') },
    ];
    const val = state.sort === 'code' ? p => p.code : state.sort === 'shares' ? p => p.shares : p => figures(p).pl;
    return Table.html(cols, Table.sort(rows.slice(), val, state.desc).map(rowHTML));
  }

  function renderList(holdings = Holdings.all(U.today())) {
    if (!holdings) {
      countEl.textContent = '';
      listEl.innerHTML = '<p class="empty">還沒有持股資料<br>點右上角「新增交易」記一筆買進，或在「庫存快照」照券商的庫存填一期，這裡就會算出目前持股</p>';
      return;
    }
    const kw = state.keyword.trim().toLowerCase();
    const all = holdings.positions.slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const text = p => `${p.code} ${p.name} ${(p.parts || []).map(x => Store.memberName(x.member)).join(' ')}`;
    const rows = all.filter(p => !kw || text(p).toLowerCase().includes(kw));
    countEl.textContent = rows.length === all.length ? `${all.length} 檔` : `${rows.length}／${all.length} 檔`;
    mixed = Market.mixed(all.filter(p => p.shares > 0).map(p => p.code));
    listEl.innerHTML = rows.length
      ? priceNote(all) + (Cards.on ? rows.map(cardHTML).join('') : tableHTML(rows))
      : `<p class="empty">${all.length ? '沒有符合條件的持股' : '目前沒有持股'}</p>`;
  }

  // 看不到的時候（在別的分頁）先不畫，記著要重畫，切過來時（shown）才畫
  let stale = false;
  function refresh() {
    if (el.hidden) {
      stale = true;
      return;
    }
    stale = false;
    const holdings = Holdings.all(U.today());
    renderKpis(holdings);
    renderList(holdings);
  }
  function shown() {
    if (stale) refresh();
  }

  function reset() {
    state.keyword = '';
    keywordInput.value = '';
    refresh();
  }

  // 和其他列表相同的介面，資料變動時一律重算
  // 「我的」的上一檔、下一檔：照列出來的順序
  const codes = () => [...listEl.querySelectorAll('[data-code]')].map(n => n.dataset.code);

  return { el, refresh, reset, changed: refresh, shown, codes };
}
