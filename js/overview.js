// 持股總覽：上方 KPI、下方目前每檔持股；全部由其他資料表推算，不另外儲存
//   庫存總市值：每檔股數 × 現價（現價見下面），抓不到現價的那幾檔不算進去
//     損益試算 = 市值 − 那幾檔的付出成本；報酬率 = 損益 ÷ 那幾檔的付出成本（沒有扣掉賣出的手續費和證交稅）
//     付出成本和券商 App 一樣已經扣掉除息的現金股利，所以損益包含領到的股利
//     總付出成本：目前持股的成本加總（持股與成本的算法見 holdings.js：最近一期快照＋之後的交易和除息，沒有快照時加總全部交易）
//   今年現金股利：今年已發放（發放日 ≤ 今天）的股息淨值加總
//   月平均股息：近 12 個月已發放的股息淨值 ÷ 12
//   下一筆入帳：發放日在今天之後、最近的一筆（同一天有多筆時合計）
//   全家檢視時各成員分別推算後合計，持股卡片下方列出每人的股數
//   庫存總市值卡片右上角的眼睛：隱藏金額的開關（見 privacy.js），像網路銀行的隱藏餘額
//   現價：連結 Google 時由試算表的 GOOGLEFINANCE 抓（見 sync.js），持股列表上方註明更新時間；不是自己的資料，隱藏金額時照常顯示
//   subtitle：標題後面的小字，顯示今天的日期
const OVERVIEW = {
  title: '持股總覽',
  subtitle() {
    const today = U.today();
    return `今天 ${U.fmtDate(today)} ${U.weekday(today)}`;
  },
};

function createOverview() {
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
  // 切換後每一頁都會重畫（app.js），眼睛按鈕也換了一個，焦點放回新的按鈕
  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('[data-act="privacy"]')) return;
    Privacy.toggle();
    kpisEl.querySelector('[data-act="privacy"]')?.focus({ preventScroll: true });
  });

  // 金額、股數、成本均價：隱藏金額時顯示成 ＊＊＊
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const shares = n => Privacy.num(U.fmtNum(n));
  // 眼睛：看得到金額時是睜開的（按了隱藏），隱藏時加一條斜線（按了顯示）
  const eyeHTML = () => `
    <button type="button" class="eye-btn" data-act="privacy" aria-pressed="${Privacy.hidden}"
      aria-label="${Privacy.hidden ? '顯示金額' : '隱藏金額'}" title="${Privacy.hidden ? '顯示金額' : '隱藏金額'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>${Privacy.hidden ? '<path d="M4 4l16 16"/>' : ''}</svg>
    </button>`;
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
    // 庫存總市值：大數字下面一排三格（損益試算、報酬率、總付出成本）
    //   損益賺錢紅色、賠錢綠色（台股的習慣）；隱藏金額時連正負號和顏色都不顯示
    let hero;
    if (holdings) {
      const q = quotes();
      const priced = q ? holdings.positions.filter(p => p.shares > 0 && typeof q.quotes[p.code] === 'number') : [];
      const value = priced.reduce((s, p) => s + p.shares * q.quotes[p.code], 0);
      const pricedCost = priced.reduce((s, p) => s + p.cost, 0);
      const pl = Math.round(value) - Math.round(pricedCost);
      // 和券商的卡片一樣：賺錢不加「+」，用紅色表示；賠錢留著「-」，綠色（長輩不一定注意得到顏色）
      const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'gain' : 'loss';
      const rate = pricedCost > 0 ? Privacy.num(`${U.fmtNum(U.round(pl / pricedCost * 100, 2), 2)}%`) : '—';
      const unpriced = holdings.positions.filter(p => p.shares > 0).length - priced.length;
      const priceNote = !q ? '連結 Google 帳號後，會用 GOOGLEFINANCE 抓現價算市值'
        : !priced.length ? (q.at ? '抓不到現價，算不出市值' : '正在抓現價…')
        : unpriced ? `另有 ${unpriced} 檔抓不到現價，沒有算進市值和損益` : '';
      const cell = (label, v, cls = '') => `<span class="kpi-cell"><small>${label}</small><b class="${cls}">${v}</b></span>`;
      hero = `
        <b>${priced.length ? money(value) : '—'}</b>
        <span class="kpi-row">
          ${cell('損益試算', priced.length ? Privacy.num(U.fmtNum(pl)) : '—', tone)}
          ${cell('報酬率', priced.length ? rate : '—', tone)}
          ${cell('總付出成本', money(holdings.positions.reduce((s, p) => s + p.cost, 0)))}
        </span>
        <span class="kpi-sub">${basis(holdings)}</span>
        ${priceNote ? `<span class="kpi-sub">${priceNote}</span>` : ''}`;
    } else {
      hero = `<b>—</b><span class="kpi-sub">還沒有交易明細或庫存快照</span>`;
    }

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
      <div class="kpi wide hero"><small>庫存總市值</small>${eyeHTML()}${hero}</div>
      <div class="kpi">
        <small>今年現金股利</small>
        <b>${money(sumNet(thisYear))}</b>
        <span class="kpi-sub">${year} 年已發放</span>
        ${missingNote(thisYear)}
      </div>
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
    fitNumbers();
  }

  // 數字太長放不下時（例如損益八、九位數）把字縮小，不換行，才不會被拆成兩行
  //   同一排的三格（損益試算、報酬率、總付出成本）縮成一樣大，看起來才整齊；放得下時維持原本的大小
  //   總覽沒在畫面上時量不到寬度：切換過來、螢幕轉向時再調（ResizeObserver），標題字型載入後也再調一次
  function fitNumbers() {
    if (!kpisEl.offsetWidth) return;
    const nums = [...kpisEl.querySelectorAll('.kpi b')];
    nums.forEach(b => { b.style.fontSize = ''; });
    const groups = new Map();
    nums.forEach(b => {
      const key = b.closest('.kpi-row') || b;
      groups.set(key, [...(groups.get(key) || []), b]);
    });
    const tooWide = b => b.scrollWidth > b.clientWidth;
    groups.forEach(group => {
      // 寬度和字的大小成正比，照最擠的那一格算出比例；算完還放不下（四捨五入）就再縮一點
      let scale = Math.min(...group.map(b => (tooWide(b) ? b.clientWidth / b.scrollWidth : 1)));
      const base = group.map(b => parseFloat(getComputedStyle(b).fontSize));
      for (let k = 0; scale < 1 && k < 4; k++) {
        group.forEach((b, j) => { b.style.fontSize = `${Math.floor(base[j] * scale * 10) / 10}px`; });
        if (!group.some(tooWide)) break;
        scale *= 0.95;
      }
    });
  }
  let fittedWidth = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (kpisEl.offsetWidth === fittedWidth) return;
      fittedWidth = kpisEl.offsetWidth;
      fitNumbers();
    }).observe(kpisEl);
  }
  document.fonts?.addEventListener?.('loadingdone', fitNumbers);

  // 庫存快照的股數和交易紀錄對不上時提醒（核對明細在庫存快照頁，算法見 holdings.js 的 check）
  // 瀏覽器快取到舊版 holdings.js（還沒有 check）時直接略過，不讓整個總覽壞掉
  function checkNote() {
    if (typeof Holdings.check !== 'function') return '';
    const n = Holdings.check().filter(c => c.status === 'diff').length;
    return n ? `<p class="kpi-note">有 ${n} 筆庫存快照的股數和交易紀錄對不上，明細請看「記帳」的「庫存快照」</p>` : '';
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

  // 股價：連結 Google、抓過股價才有；沒連結時不顯示現價
  const quotes = () => (Sync.state().linked ? Sync.prices() : null);

  // 「價格更新於 14:05，可能延遲 20 分鐘」；不是今天的話加上日期
  function priceNote(q, positions) {
    const t = q.at ? U.fmtDateTime(q.at) : '';
    const time = t.startsWith(U.today().replace(/-/g, '/')) ? t.slice(11) : t;
    const missing = positions.filter(p => q.quotes[p.code] === null).length;
    const parts = [time ? `價格更新於 ${time}，可能延遲 20 分鐘` : '正在抓價格…'];
    if (missing) parts.push(`${missing} 檔抓不到價格`);
    return `<p class="list-intro">${U.esc(parts.join('；'))}</p>`;
  }

  function cardHTML(p, q) {
    const avg = p.shares > 0 ? U.round(p.cost / p.shares, 2) : null;
    const price = q?.quotes[p.code];
    return `
      <div class="card static">
        <span class="card-top">
          <span class="card-title"><span class="card-code">${U.esc(p.code)}</span>${U.esc(p.name)}</span>
          <span class="card-primary"><small>付出成本</small><b>${money(p.cost)}</b></span>
        </span>
        <span class="card-grid">
          <span class="cell"><small>股數</small><span>${shares(p.shares)}</span></span>
          <span class="cell"><small>成本均價</small><span>${avg === null ? '—' : Privacy.num(U.fmtNum(avg, 2))}</span></span>
          ${q ? `<span class="cell"><small>現價</small><span>${typeof price === 'number' ? U.fmtNum(U.round(price, 2)) : '—'}</span></span>` : ''}
        </span>
        ${noteHTML(p)}
      </div>`;
  }

  function renderList(holdings = Holdings.all(U.today())) {
    if (!holdings) {
      countEl.textContent = '';
      listEl.innerHTML = '<p class="empty">還沒有持股資料<br>到「記帳」記一筆買進，或在「庫存快照」照券商的庫存填一期，這裡就會算出目前持股</p>';
      return;
    }
    const kw = state.keyword.trim().toLowerCase();
    const all = holdings.positions.slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const text = p => `${p.code} ${p.name} ${(p.parts || []).map(x => Store.memberName(x.member)).join(' ')}`;
    const rows = all.filter(p => !kw || text(p).toLowerCase().includes(kw));
    countEl.textContent = rows.length === all.length ? `${all.length} 檔` : `${rows.length}／${all.length} 檔`;
    const q = quotes();
    listEl.innerHTML = rows.length
      ? (q ? priceNote(q, all) : '') + rows.map(p => cardHTML(p, q)).join('')
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
