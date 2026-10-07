// 殖利率：底部「殖利率」一格裡的兩頁，上方切換「庫存｜觀察」，同一套欄位，預設殖利率由高到低
//   庫存：目前的持股（跟著上面選的成員）；觀察：觀察清單（全家共用，見 schema.js 的 watch），你也持有的標「持有」
//   排序：依殖利率（高的在前，算不出來的放最後）或依代號
//   近一年現金股利：公告的除權息（shared/dividends.json，見 announced.js）加上自己記的除權息，照配息頻率取最近幾次（月配 12、季配 4、半年配 2、年配 1）
//     公告的除權息是 App 打開時才下載的：還沒下載好、下載不了時，卡片寫出來，下載好之後整頁重畫（app.js）
//     不直接抓 365 天：除息日每年差一兩天時，去年同一期還在範圍內，會多算一次
//     同一次（代號相同、除權息日差 7 天內，見 announced.js）以公告為主；公告的金額還沒出來、或公告裡沒有的，用自己記的
//   殖利率 = 近一年現金股利 ÷ 現價（大字）
//   照最近一次換算一年 = 最近一次 × 一年配幾次 ÷ 現價（卡片下面的小字；年配的和殖利率一樣，不寫）
//   成本殖利率 = 近一年現金股利 ÷ 成本均價（只有庫存有）；成本均價已經扣掉領過的股利（和券商一樣），所以會比用買價算的高
//   現價：連結 Google 時由試算表的 GOOGLEFINANCE 抓（見 sync.js，持股和觀察清單的代號都抓）；沒連結時沒有現價，算不出殖利率
const YIELD_PAGE = { title: '殖利率' };

const Yield = (() => {
  const DAY = 86400000;
  const FREQ = { 12: '月配', 4: '季配', 2: '半年配', 1: '年配' };
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const days = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
  const byExDesc = (a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0);

  // 這一檔每一次的現金股利，除權息日新的在前：[{ exDate, payDate, cash, own }]
  //   cash 是 null：公告了日期、金額還沒公告，自己也還沒記；own：金額用的是自己記的
  //   own（參數）：自己記的除權息
  function events(code, own) {
    const c = key(code);
    if (!c) return [];
    const mine = own.filter(d => key(d.code) === c && d.exDate && typeof d.cash === 'number' && d.cash > 0);
    const pub = Announced.forCode(c).filter(r => r.cash !== 0); // 只配股的不算
    const list = pub.map(r => {
      const m = r.cash == null ? mine.find(d => Announced.sameEvent(d, r)) : null;
      return { exDate: r.exDate, payDate: r.payDate, cash: m ? m.cash : r.cash, own: !!m };
    });
    mine.filter(d => !pub.some(r => Announced.sameEvent(d, r)))
      .forEach(d => list.push({ exDate: d.exDate, payDate: d.payDate || '', cash: d.cash, own: true }));
    return list.sort(byExDesc);
  }

  // 一檔的配息：公告和自己記的都沒有時回傳 null
  //   { per: 一年配幾次, freq: 月配…, recent: 近一年算進去的那幾次, count, sum: 合計, next: 下一次（除權息日在今天之後、最近的）,
  //     short: 近一年的次數比一年配的次數少（上市未滿一年、改了配息頻率）, announced: 公告資料裡有這一檔 }
  function info(code, { today = U.today(), own = Store.list('dividends', 'all') } = {}) {
    const list = events(code, own);
    if (!list.length) return null;
    // 一年配幾次：相鄰兩次除權息日相隔天數的中位數（只有一次時當作年配）
    const gaps = list.slice(1).map((r, i) => days(list[i].exDate, r.exDate)).filter(g => g > 0).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 365;
    const per = gap <= 45 ? 12 : gap <= 120 ? 4 : gap <= 240 ? 2 : 1;
    // 近一年：除權息日在今天以前、金額知道的，最近的 per 次；超過一年又 20 天的不算（年配的除息日晚個幾天也還算得到去年那次）
    const recent = list.filter(r => r.exDate <= today && typeof r.cash === 'number' && days(today, r.exDate) <= 385).slice(0, per);
    const upcoming = list.filter(r => r.exDate > today);
    return {
      per,
      freq: FREQ[per],
      recent,
      count: recent.length,
      sum: U.round(recent.reduce((s, r) => s + r.cash, 0), 6),
      next: upcoming[upcoming.length - 1] || null,
      short: recent.length < per,
      announced: Announced.forCode(code).length > 0,
    };
  }

  return { events, info };
})();

// 殖利率頁：庫存（mode 'held'）、觀察（mode 'watch'）各一頁，和其他列表一樣有 el、refresh、reset、changed
function createYield(mode) {
  const watch = mode === 'watch';
  const state = { keyword: '', sort: 'yield' };
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();

  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <select class="f-sort" aria-label="排序">
        <option value="yield">依殖利率</option>
        <option value="code">依代號</option>
      </select>
      <input class="f-keyword" type="search" placeholder="搜尋代號或證券" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;
  const sortSel = el.querySelector('.f-sort');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  sortSel.addEventListener('change', () => { state.sort = sortSel.value; render(); });
  keywordInput.addEventListener('input', () => { state.keyword = keywordInput.value; render(); });
  // 觀察：點卡片打開表單（可以移除）；庫存是算出來的，不能點
  listEl.addEventListener('click', e => {
    const card = e.target.closest('.card[data-id]');
    if (card) Form.open('watch', card.dataset.id);
  });

  // 現價：連結 Google、抓過股價才有（和持股總覽一樣）
  const quotes = () => (Sync.state().linked ? Sync.prices() : null);
  // 今年的日期只寫月/日
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const pct = n => `${U.fmtNum(U.round(n * 100, 2), 2)}%`;

  function rows() {
    const h = Holdings.all(U.today());
    const held = (h ? h.positions : []).filter(p => p.shares > 0);
    if (!watch) return held.map(p => ({ code: p.code, name: p.name, avg: p.cost / p.shares }));
    const mine = new Set(held.map(p => p.code));
    return Store.list('watch').map(r => ({ id: r.id, code: key(r.code), name: r.name, held: mine.has(key(r.code)) }));
  }

  function enrich(r, q) {
    const info = Yield.info(r.code);
    const p = q?.quotes[r.code];
    const price = typeof p === 'number' && p > 0 ? p : null;
    return { ...r, info, price, y: info?.count && price ? info.sum / price : null };
  }

  // 公告的除權息還沒下載好（App 打開時才下載，見 announced.js）：不能說「公告資料裡沒有這檔」
  const waiting = () => (Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載');

  // 卡片下面的說明：資料從哪來、算不出來的原因、最近一次換算一年、下一次除息
  function notes({ info, price }) {
    const pub = Announced.ready();
    if (!info) return [pub ? '公告資料裡沒有這檔（上櫃 ETF、興櫃沒有資料）' : waiting()];
    const out = [];
    if (!info.count) out.push('近一年沒有配息');
    else if (info.short) out.push(`近一年只有 ${info.count} 次配息，殖利率會偏低（剛上市的常這樣）`);
    const own = info.recent.filter(r => r.own).length;
    if (!info.announced) out.push(pub ? '公告資料裡沒有這檔，用你記的除權息算' : `${waiting()}，先用你記的除權息算`);
    else if (own) out.push(`近一年有 ${own} 次公告還沒有金額，用你記的`);
    const last = info.recent[0];
    if (last && info.per > 1 && price) {
      out.push(`最近一次 ${md(last.exDate)} 除息 ${U.fmtNum(last.cash)} 元，照這次換算一年 ${pct(last.cash * info.per / price)}`);
    }
    const next = info.next;
    if (next) {
      const cash = typeof next.cash === 'number' ? ` ${U.fmtNum(next.cash)} 元${next.own ? '（你記的）' : ''}` : '（金額待公告）';
      out.push(`下次 ${md(next.exDate)} 除息${cash}`);
    }
    return out;
  }

  function cardHTML(r) {
    const { info, price, y } = r;
    const cell = (label, v) => `<span class="cell"><small>${label}</small><span>${v}</span></span>`;
    const cells = [
      cell('現價', price ? U.fmtNum(price, 2) : '—'),
      cell('近一年股利', info?.count ? `${U.fmtNum(info.sum)} 元` : '—'),
      cell('配息', info ? info.freq : '—'),
    ];
    if (!watch) cells.push(cell('成本殖利率', info?.count && r.avg > 0 ? Privacy.num(pct(info.sum / r.avg)) : '—'));
    const tag = r.held ? '<span class="card-tags"><span class="badge member">持有</span></span>' : '';
    return `
      <div class="card yield-card${watch ? '' : ' static'}"${watch ? ` data-id="${U.esc(r.id)}"` : ''}>
        <span class="card-top">
          <span class="card-title">${tag}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>殖利率</small><b class="yield-pct">${y === null ? '—' : pct(y)}</b></span>
        </span>
        <span class="card-grid">${cells.join('')}</span>
        ${notes(r).map(n => `<span class="card-note">${U.esc(n)}</span>`).join('')}
      </div>`;
  }

  // 列表上面的說明：怎麼算、現價和公告資料是什麼時候的
  function introHTML(q, all) {
    const how = watch
      ? '殖利率 = 近一年現金股利 ÷ 現價。你也持有的標「持有」，點一檔可以移除。'
      : '殖利率 = 近一年現金股利 ÷ 現價；成本殖利率用成本均價算（已扣掉領過的股利，和券商一樣，所以會比用買價算的高）。';
    let price = '連結 Google 帳號後，會用 GOOGLEFINANCE 抓現價算殖利率';
    if (q) {
      const t = q.at ? U.fmtDateTime(q.at) : '';
      const time = t.startsWith(U.today().replace(/-/g, '/')) ? t.slice(11) : t;
      const missing = all.filter(r => q.quotes[r.code] === null).length;
      price = (time ? `現價 ${time} 更新，可能延遲 20 分鐘` : '正在抓現價…') + (missing ? `；${missing} 檔抓不到現價` : '');
    }
    const updated = Announced.updated();
    return `<p class="list-intro">${how}<br>${U.esc(price)}${updated ? `；公告的除權息 ${md(updated)} 更新` : ''}</p>`;
  }

  function render() {
    const q = quotes();
    const all = rows().map(r => enrich(r, q));
    const kw = state.keyword.trim().toLowerCase();
    const shown = all.filter(r => !kw || `${r.code} ${r.name}`.toLowerCase().includes(kw));
    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    shown.sort(state.sort === 'code' ? byCode : (a, b) => ((b.y ?? -1) - (a.y ?? -1)) || byCode(a, b));
    countEl.textContent = shown.length === all.length ? `${all.length} 檔` : `${shown.length}／${all.length} 檔`;
    if (!all.length) {
      listEl.innerHTML = watch
        ? '<p class="empty">還沒有觀察的股票<br>點右上角「新增觀察」，打代號或名稱加進來<br>就能和庫存一起比殖利率</p>'
        : '<p class="empty">目前沒有持股<br>到「記帳」記一筆買進，或照券商的庫存填一期快照</p>';
      return;
    }
    listEl.innerHTML = introHTML(q, all) +
      (shown.length ? shown.map(cardHTML).join('') : '<p class="empty">沒有符合條件的股票</p>');
  }

  function reset() {
    state.keyword = '';
    keywordInput.value = '';
    render();
  }

  // 剛新增或改過的那一檔閃一下
  function changed(rec) {
    render();
    const card = rec?.id && listEl.querySelector(`[data-id="${CSS.escape(rec.id)}"]`);
    if (card) {
      card.classList.add('flash');
      card.scrollIntoView({ block: 'nearest' });
    }
  }

  return { el, refresh: render, reset, changed };
}
