// 總覽：最上面是大盤指數，下面是股利的幾個數字和即將除權息；全部由其他資料表推算，不另外儲存
//   大盤指數：加權、櫃買的收盤指數和漲跌（見 market.js 的 indices）；收盤資料下載到新的時重畫（見 app.js）
//     點卡片（或右上角的「走勢 ›」）打開大盤：加權指數的當日走勢和日 K 線（見 taiex.js）
//     一定寫是哪一天收盤的：收盤資料傍晚才更新，盤中打開看到的是前一天的
//   今年現金股利：今年已發放（發放日 ≤ 今天）的股息淨值加總
//   月平均股息：近 12 個月已發放的股息淨值 ÷ 12
//   下一筆入帳：發放日在今天之後、最近的一筆（同一天有多筆時合計）
//   即將除權息：持股接下來 30 天要除權息的（見 upcoming.js）；點一筆打開那一檔的「我的」（見 mine.js），和即將除權息那一頁一樣
//   市值和持股在帳務的庫存（見 inventory.js）
//   subtitle：標題後面的小字，顯示今天的日期
const OVERVIEW = {
  title: '總覽',
  subtitle() {
    const today = U.today();
    return `今天 ${U.fmtDate(today)} ${U.weekday(today)}`;
  },
};

// 上面那排數字太長放不下時（例如損益八、九位數）把字縮小，不換行，才不會被拆成兩行（總覽、庫存共用）
//   同一排的三格（損益試算、報酬率、總付出成本）縮成一樣大，看起來才整齊；放得下時維持原本的大小
//   沒在畫面上時量不到寬度：切換過來、螢幕轉向時再調（ResizeObserver），標題字型載入後也再調一次
function fitKpis(el) {
  if (!el.offsetWidth) return;
  const nums = [...el.querySelectorAll('.kpi b')];
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

function watchKpis(el) {
  let fittedWidth = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (el.offsetWidth === fittedWidth) return;
      fittedWidth = el.offsetWidth;
      fitKpis(el);
    }).observe(el);
  }
  document.fonts?.addEventListener?.('loadingdone', () => fitKpis(el));
}

function createOverview(hooks) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = '<div class="kpis"></div>';

  const kpisEl = el.querySelector('.kpis');

  // 即將除權息點一筆：打開那一檔的「我的」，上一檔、下一檔照卡片列出來的順序
  kpisEl.addEventListener('click', e => {
    const row = e.target.closest('.up-row[data-code]');
    if (!row) return;
    const list = [...new Set([...kpisEl.querySelectorAll('.up-row[data-code]')].map(n => n.dataset.code))];
    hooks.openStock(row.dataset.code, list);
  });
  // 大盤指數卡片：打開大盤（見 taiex.js）
  kpisEl.addEventListener('click', e => {
    if (e.target.closest('.kpi.ix')) hooks.openTaiex?.();
  });
  // 即將除權息的展開／收起（見 upcoming.js）：焦點放回新的按鈕
  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('[data-act="upcoming"]')) return;
    Upcoming.toggle();
    render();
    kpisEl.querySelector('[data-act="upcoming"]')?.focus({ preventScroll: true });
  });

  // 金額：隱藏金額時顯示成 ***
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const byPayDate = (a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0);
  const sumNet = rows => rows.reduce((s, r) => s + (r.net ?? 0), 0);
  const missingNote = rows => {
    const n = rows.filter(r => r.net === null).length;
    return n ? `<span class="kpi-sub warn">另有 ${n} 筆算不出來，未計入</span>` : '';
  };

  // 大盤指數：一個指數一行，名稱｜收盤指數｜漲跌點數｜漲跌幅，數字靠右、上下對齊；漲紅跌綠（台股的習慣）
  //   還沒有資料（收盤價還在下載、舊的資料沒有指數）時不顯示這張卡片
  const two = n => U.fmtNum(U.round(n, 2), 2);
  const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${two(Math.abs(n))}`;
  function indexCard() {
    const list = Market.indices();
    if (!list.length) return '';
    const rows = list.map(r => {
      const cls = r.change > 0 ? ' gain' : r.change < 0 ? ' loss' : '';
      return `
        <span class="ix-name">${U.esc(r.name)}</span>
        <span class="ix-num">${two(r.close)}</span>
        <span class="ix-num${cls}">${signed(r.change)}</span>
        <span class="ix-num${cls}">${r.pct === null ? '' : `${signed(r.pct)}%`}</span>`;
    }).join('');
    return `
      <div class="kpi wide ix">
        <small>${U.esc(Market.indexLine(list))}</small>
        <button type="button" class="trend-hint ix-hint" aria-label="大盤走勢">走勢<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
        <div class="ix-list">${rows}</div>
      </div>`;
  }

  function render() {
    const today = U.today();
    const year = today.slice(0, 4);
    const yearAgo = `${+year - 1}${today.slice(4)}`;
    const divs = VIEWS.cashDividends.rows();
    const paid = divs.filter(r => r.payDate && r.payDate <= today);
    const thisYear = paid.filter(r => r.payDate.startsWith(`${year}-`));
    const last12 = paid.filter(r => r.payDate > yearAgo);
    const upcoming = divs.filter(r => r.payDate > today).sort(byPayDate);
    const next = upcoming.filter(r => r.payDate === upcoming[0]?.payDate);

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
      ${indexCard()}
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
      ${Upcoming.cardHTML(Holdings.all(today))}`;
    fitKpis(kpisEl);
  }
  watchKpis(kpisEl);

  // 看不到的時候（在別的分頁）先不畫，記著要重畫，切回總覽時（shown）才畫
  let stale = false;
  function refresh() {
    if (el.hidden) {
      stale = true;
      return;
    }
    stale = false;
    render();
  }
  function shown() {
    if (stale) refresh();
  }

  // 和其他列表相同的介面，資料變動時一律重算
  return { el, refresh, reset: refresh, changed: refresh, shown };
}
