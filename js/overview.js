// 持股總覽：上方 KPI、下方目前每檔持股；全部由其他資料表推算，不另外儲存
//   總投資成本：目前持股的成本加總（持股與成本的算法見 holdings.js：最近一期快照＋之後的交易，沒有快照時加總全部交易）
//   今年現金股利：今年已發放（發放日 ≤ 今天）的股息淨值加總；點了打開累積現金股利的統計（篩選今年）
//   月平均股息：近 12 個月已發放的股息淨值 ÷ 12
//   下一筆入帳：發放日在今天之後、最近的一筆（同一天有多筆時合計）
//   全家檢視時各成員分別推算後合計，持股卡片下方列出每人的股數
//   subtitle：標題後面的小字，顯示今天的日期
const OVERVIEW = {
  title: '持股總覽',
  subtitle() {
    const today = U.today();
    return `今天 ${U.fmtDate(today)} ${U.weekday(today)}`;
  },
};

// openStats(年份)：點「今年現金股利」時呼叫（見 app.js）
function createOverview({ openStats } = {}) {
  const state = { keyword: '' };

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

  keywordInput.addEventListener('input', () => { state.keyword = keywordInput.value; renderList(); });
  kpisEl.addEventListener('click', e => {
    if (openStats && e.target.closest('[data-act="stats"]')) openStats(U.today().slice(0, 4));
  });

  const money = n => U.fmtNum(Math.round(n));
  const byPayDate = (a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0);
  const sumNet = rows => rows.reduce((s, r) => s + (r.net ?? 0), 0);
  const missingNote = rows => {
    const n = rows.filter(r => r.net === null).length;
    return n ? `<span class="kpi-sub warn">另有 ${n} 筆算不出來，未計入</span>` : '';
  };

  // ---------- KPI ----------
  function renderKpis(holdings) {
    const today = U.today();
    const year = today.slice(0, 4);
    const yearAgo = `${+year - 1}${today.slice(4)}`;
    const divs = VIEWS.cashDividends.rows();
    const paid = divs.filter(r => r.payDate && r.payDate <= today);
    const thisYear = paid.filter(r => r.payDate.startsWith(`${year}-`));
    const last12 = paid.filter(r => r.payDate > yearAgo);
    const upcoming = divs.filter(r => r.payDate > today).sort(byPayDate);
    const next = upcoming.filter(r => r.payDate === upcoming[0]?.payDate);

    // 推算的起點：同一期快照、全部從 0 加總交易，或全家各成員的起點不一樣
    const basis = h => (h.snapDate ? `依 ${U.fmtDate(h.snapDate)} 庫存快照推算到今天`
      : h.mixed ? '依各成員的庫存快照和交易明細推算到今天'
      : '依交易明細加總到今天');
    const cost = holdings
      ? `<b>${money(holdings.positions.reduce((s, p) => s + p.cost, 0))}</b>
         <span class="kpi-sub">${basis(holdings)}</span>`
      : `<b>—</b><span class="kpi-sub">還沒有交易明細或庫存快照</span>`;

    let nextTile;
    if (next.length) {
      const first = next[0];
      const amount = next.some(r => r.net !== null) ? money(sumNet(next)) : '—';
      // 同一筆除權息可能有好幾位成員各算一列，筆數以除權息計
      const count = new Set(next.map(r => r.id)).size;
      const who = `${first.code} ${first.name}${count > 1 ? ` 等 ${count} 筆` : ''}`;
      // 只顯示、不能點；日期和股票名稱各一行，名稱才不會被切斷
      nextTile = `
        <div class="kpi wide">
          <small>下一筆入帳</small>
          <b>${amount}</b>
          <span class="kpi-sub">${U.esc(U.fmtDate(first.payDate))} ${U.weekday(first.payDate)}</span>
          <span class="kpi-sub">${U.esc(who)}</span>
          ${missingNote(next)}
        </div>`;
    } else {
      nextTile = `
        <div class="kpi wide">
          <small>下一筆入帳</small>
          <b>—</b>
          <span class="kpi-sub">沒有待發放的股利</span>
        </div>`;
    }

    kpisEl.innerHTML = `
      <div class="kpi wide hero"><small>總投資成本</small>${cost}</div>
      <button type="button" class="kpi go" data-act="stats">
        <small>今年現金股利<svg class="go-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></small>
        <b>${money(sumNet(thisYear))}</b>
        <span class="kpi-sub">${year} 年已發放</span>
        ${missingNote(thisYear)}
      </button>
      <div class="kpi">
        <small>月平均股息</small>
        <b>${money(sumNet(last12) / 12)}</b>
        <span class="kpi-sub">近 12 個月 ÷ 12</span>
        ${missingNote(last12)}
      </div>
      ${nextTile}
      ${holdings && holdings.missingCode
        ? `<p class="kpi-note">有 ${holdings.missingCode} 筆快照或交易沒填代號，沒有計入</p>` : ''}
      ${checkNote()}`;
  }

  // 庫存快照的股數和交易紀錄對不上時提醒（核對明細在庫存快照頁，算法見 holdings.js 的 check）
  // 瀏覽器快取到舊版 holdings.js（還沒有 check）時直接略過，不讓整個總覽壞掉
  function checkNote() {
    if (typeof Holdings.check !== 'function') return '';
    const n = Holdings.check().filter(c => c.status === 'diff').length;
    return n ? `<p class="kpi-note">有 ${n} 筆庫存快照的股數和交易紀錄對不上，明細請看「庫存快照」頁</p>` : '';
  }

  // ---------- 持股列表（依總投資成本由大到小） ----------
  function noteHTML(p) {
    // 全家：列出每位成員的股數；有人算出負數時改列那個人的算式
    if (p.parts && Store.members().length > 1) {
      const bad = p.parts.filter(x => x.shares < 0);
      if (bad.length) {
        return bad.map(x => `<span class="card-note warn">${U.esc(Store.memberName(x.member))}的股數算出來是負的` +
          `（${U.esc(x.formula)}），請檢查資料</span>`).join('');
      }
      const each = p.parts.map(x => `${Store.memberName(x.member)} ${U.fmtNum(x.shares)} 股`).join(' · ');
      return `<span class="card-note">${U.esc(each)}</span>`;
    }
    const one = p.parts ? p.parts[0] : p;
    return one.shares < 0
      ? `<span class="card-note warn">股數算出來是負的（${U.esc(one.formula)}），請檢查資料</span>`
      : `<span class="card-note">${U.esc(one.changed ? `股數 = ${one.formula}` : `依 ${U.fmtDate(one.snapDate)} 庫存快照`)}</span>`;
  }

  function cardHTML(p) {
    const avg = p.shares > 0 ? U.round(p.cost / p.shares, 2) : null;
    return `
      <div class="card static">
        <span class="card-top">
          <span class="card-title"><span class="card-code">${U.esc(p.code)}</span>${U.esc(p.name)}</span>
          <span class="card-primary"><small>總投資成本</small><b>${money(p.cost)}</b></span>
        </span>
        <span class="card-grid">
          <span class="cell"><small>股數</small><span>${U.fmtNum(p.shares)}</span></span>
          <span class="cell"><small>平均成本</small><span>${avg === null ? '—' : U.fmtNum(avg, 2)}</span></span>
        </span>
        ${noteHTML(p)}
      </div>`;
  }

  function renderList(holdings = Holdings.all(U.today())) {
    if (!holdings) {
      countEl.textContent = '';
      listEl.innerHTML = '<p class="empty">還沒有持股資料<br>到「交易明細」記一筆買進，或到「庫存快照」照券商的庫存填一期，這裡就會算出目前持股</p>';
      return;
    }
    const kw = state.keyword.trim().toLowerCase();
    const all = holdings.positions.slice().sort((a, b) => b.cost - a.cost);
    const text = p => `${p.code} ${p.name} ${(p.parts || []).map(x => Store.memberName(x.member)).join(' ')}`;
    const rows = all.filter(p => !kw || text(p).toLowerCase().includes(kw));
    countEl.textContent = rows.length === all.length ? `${all.length} 檔` : `${rows.length}／${all.length} 檔`;
    listEl.innerHTML = rows.length
      ? rows.map(cardHTML).join('')
      : `<p class="empty">${all.length ? '沒有符合條件的持股' : '目前沒有持股'}</p>`;
  }

  function refresh() {
    const holdings = Holdings.all(U.today());
    renderKpis(holdings);
    renderList(holdings);
  }

  function reset() {
    state.keyword = '';
    keywordInput.value = '';
    refresh();
  }

  // 和其他列表相同的介面，資料變動時一律重算
  return { el, refresh, reset, changed: refresh };
}
