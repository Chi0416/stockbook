// 即將除權息：持股總覽的一張卡片（見 overview.js），列出持股和觀察清單接下來 30 天要除權息的
//   除權息日當天參考價會扣掉股利，看起來變便宜，可以當作買進的時間點參考；想領這次股利，最晚前一個交易日買進
//   資料：公告的除權息（announced.js）加上自己記的除權息；同一次（代號相同、除權息日差 7 天內）以公告為主，
//         公告的金額還沒出來時用自己記的；百分比是每股現金股利 ÷ 現價（見 market.js），參考價大約少這麼多
//   持股跟著上面選的成員；觀察清單全家共用；兩邊都有的「持有」「觀察」都標（和行情一樣）
//   可以摺疊：收起時只列最近的一筆，下面「還有 N 筆」點了展開；展開或收起記在這台裝置，預設收起
//   最下面「看全部」：切到股利 → 除權息頁，最上面是詳細版（見下面的 pageHTML）
//
// 詳細版：股利 → 除權息頁最上面的一段（list.js 的 schema.top，見 schema.js 的 dividends）
//   不限 30 天：公告的、自己記的，除權息日今天以後的全部；分「本週」「下週」「之後」（週一到週日算一週）
//   每一筆：除權息日、股票（點了打開那一檔的詳細資料，見 detail.js）、持有或觀察、每股現金（配股）、約佔現價幾 %、發放日
//     持有的：照目前的股數算預估領多少（看好幾位成員時寫每個人的股數；隱藏金額時 ***）
//       還沒記在「除權息」：「記下來」一鍵加入（基準日股數自動推算，和訊息匣的「加入」一樣）；金額還沒公告的等公告了再記
//       記過了：寫「已記」
//     只在觀察清單的：沒有股數，不用記
//   平常列前 5 筆，下面「還有 N 筆」展開；展開或收起記在這台裝置，預設收起
//   持股和觀察清單都沒有時整段不顯示；搜尋框有打字時也不顯示（只找記過的）
const Upcoming = (() => {
  const DAYS = 30;
  const MAX = 8; // 展開時最多列幾筆，其他的寫「還有 N 筆沒有列出」
  const OPEN_KEY = 'stockbook.upcomingOpen';
  let open = false;
  try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) {}

  // 展開／收起（overview.js 點了按鈕之後呼叫，接著重畫卡片）
  function toggle() {
    open = !open;
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) {}
  }
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const num = v => (typeof v === 'number' ? v : null);

  function plusDays(iso, n) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
  }

  // 這些代號在今天到 days 天後（都含）要除權息的：[{ code, exDate, payDate, cash, stock, own }]，除權息日早的在前
  //   cash 是 null：金額還沒公告、自己也還沒記；own：金額用的是自己記的
  //   days 是 null：今天以後的全部（詳細版）
  function list(codes, { today = U.today(), days = DAYS, own = Store.list('dividends', 'all') } = {}) {
    const until = days === null ? '9999-12-31' : plusDays(today, days);
    const inRange = d => !!d && d >= today && d <= until;
    return [...new Set(codes.map(key).filter(Boolean))].flatMap(c => {
      const mine = own.filter(d => key(d.code) === c && inRange(d.exDate));
      const pub = Announced.forCode(c).filter(r => inRange(r.exDate));
      const rows = pub.map(r => {
        const m = r.cash == null ? mine.find(d => Announced.sameEvent(d, r) && num(d.cash) !== null) : null;
        return { code: c, exDate: r.exDate, payDate: r.payDate, cash: m ? m.cash : r.cash, stock: r.stock || 0, own: !!m };
      });
      mine.filter(d => !pub.some(r => Announced.sameEvent(d, r))).forEach(d => rows.push({
        code: c, exDate: d.exDate, payDate: d.payDate || '', cash: num(d.cash), stock: num(d.stock) || 0, own: true,
      }));
      return rows;
    }).sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  // 卡片：holdings 是 Holdings.all 的結果（沒有持股時是 null）
  function cardHTML(holdings) {
    const today = U.today();
    const held = new Map((holdings ? holdings.positions : []).filter(p => p.shares > 0).map(p => [p.code, p.name]));
    const watched = new Map(Store.list('watch').map(r => [key(r.code), r.name]));
    const rows = list([...held.keys(), ...watched.keys()], { today });
    const nameOf = c => held.get(c) || watched.get(c) || (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || '';
    const md = d => (d.startsWith(today.slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
    const pct = n => `${U.fmtNum(U.round(n * 100, 2), 2)}%`;

    const row = r => {
      const { price } = Market.quote(r.code);
      const cash = r.cash === null ? '金額待公告'
        : `${U.fmtNum(r.cash)} 元${r.stock ? `＋配股 ${U.fmtNum(r.stock)} 元` : ''}${r.own ? '（你記的）' : ''}`;
      const drop = r.cash !== null && typeof price === 'number' && price > 0 ? `約 ${pct(r.cash / price)}` : '';
      const tag = (held.has(r.code) ? '<span class="badge member">持有</span>' : '') +
        (watched.has(r.code) ? '<span class="badge">觀察</span>' : '');
      return `
        <li class="up-row">
          <span class="up-date">${md(r.exDate)} ${r.exDate === today ? '今天' : U.weekday(r.exDate)}</span>
          <span class="up-cash">${U.esc(cash)}</span>
          <span class="up-name"><span class="card-code">${U.esc(r.code)}</span>${U.esc(nameOf(r.code))} ${tag}</span>
          <span class="up-pct">${drop}</span>
        </li>`;
    };

    let body;
    if (!held.size && !watched.size) body = '<span class="kpi-sub">還沒有持股和觀察的股票</span>';
    else if (!Announced.ready() && !rows.length) {
      body = `<span class="kpi-sub">${Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載'}</span>`;
    } else if (!rows.length) body = `<span class="kpi-sub">接下來 ${DAYS} 天沒有已公告的除權息</span>`;
    else {
      const shown = open ? rows.slice(0, MAX) : rows.slice(0, 1);
      const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
      body = `<ul class="up-list">${shown.map(row).join('')}</ul>` +
        (open && rows.length > MAX ? `<span class="kpi-sub">還有 ${rows.length - MAX} 筆沒有列出</span>` : '') +
        (open || rows.length === 1
          ? '<span class="kpi-sub">除權息日當天參考價會扣掉股利，大約少右邊的 %；想領這次股利，最晚前一個交易日買進</span>' : '') +
        (rows.length > 1 ? `<button type="button" class="up-more" data-act="upcoming" aria-expanded="${open}">` +
          `${open ? '收起' : `還有 ${rows.length - 1} 筆`}${chevron}</button>` : '') +
        '<button type="button" class="link-btn up-all" data-act="upcoming-all">看全部（股利 → 除權息）</button>';
    }
    return `
      <div class="kpi wide upcoming">
        <small>即將除權息</small>
        <span class="kpi-sub">持股和觀察清單，接下來 ${DAYS} 天</span>
        ${body}
      </div>`;
  }

  // ---------- 詳細版（股利 → 除權息頁最上面） ----------
  const PAGE_MAX = 5;
  const PAGE_KEY = 'stockbook.upcomingPageOpen';
  let pageOpen = false;
  try { pageOpen = localStorage.getItem(PAGE_KEY) === '1'; } catch (_) {}
  const WEEKS = { this: '本週', next: '下週', later: '之後' };

  // 本週、下週、之後：週一到週日算一週
  function weekOf(exDate, today) {
    const monday = plusDays(today, -((new Date(`${today}T00:00:00`).getDay() + 6) % 7));
    return exDate < plusDays(monday, 7) ? 'this' : exDate < plusDays(monday, 14) ? 'next' : 'later';
  }

  // 持股（跟著設定裡勾的成員）、觀察清單，名稱
  function mine(today) {
    const h = Holdings.all(today);
    const held = new Map((h ? h.positions : []).filter(p => p.shares > 0).map(p => [key(p.code), p]));
    const watched = new Map(Store.list('watch').map(r => [key(r.code), r.name]));
    const nameOf = c => held.get(c)?.name || watched.get(c) ||
      (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || Announced.forCode(c)[0]?.name || '';
    return { held, watched, nameOf };
  }

  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const pct = n => `${U.fmtNum(U.round(n * 100, 2), 2)}%`;
  const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

  function pageHTML() {
    const today = U.today();
    const { held, watched, nameOf } = mine(today);
    if (!held.size && !watched.size) return '';
    const rows = list([...held.keys(), ...watched.keys()], { today, days: null });
    const recorded = Store.list('dividends', 'all');
    const several = Store.shown().length > 1;
    const head = `<div class="up-panel-head"><b>即將除權息</b><small>持股和觀察清單${rows.length ? `，${rows.length} 筆` : ''}</small></div>`;
    if (!rows.length) {
      const why = !Announced.ready()
        ? (Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載')
        : '接下來沒有已公告的除權息';
      return `<div class="up-panel">${head}<p class="up-foot">${why}</p></div>`;
    }

    const row = r => {
      const pos = held.get(r.code);
      const { price } = Market.quote(r.code);
      const cash = r.cash === null ? '金額待公告'
        : `${U.fmtNum(r.cash)} 元${r.stock ? `＋配股 ${U.fmtNum(r.stock)} 元` : ''}${r.own ? '（你記的）' : ''}`;
      const tags = (pos ? '<span class="badge member">持有</span>' : '') + (watched.has(r.code) ? '<span class="badge">觀察</span>' : '');
      const meta = [r.payDate ? `發放 ${md(r.payDate)}` : '發放日待公告'];
      let act = '';
      if (pos) {
        const shares = several && pos.parts?.length
          ? pos.parts.filter(x => x.shares > 0).map(x => `${Store.memberName(x.member)} ${Privacy.num(U.fmtNum(x.shares))} 股`).join('、')
          : `${Privacy.num(U.fmtNum(pos.shares))} 股`;
        meta.push(r.cash === null ? shares : `${shares}，預估領 ${Privacy.num(U.fmtNum(Math.round(r.cash * pos.shares)))} 元`);
        act = recorded.some(d => Announced.sameEvent(d, r)) ? '<span class="up-done">已記 ✓</span>'
          : r.cash === null ? '<span class="up-done">金額公告後再記</span>'
          : `<button type="button" class="up-add" data-act="up-add" data-value="${U.esc(`${r.code}|${r.exDate}`)}">記下來</button>`;
      }
      return `
        <li class="up-row up-item">
          <span class="up-date">${md(r.exDate)} ${r.exDate === today ? '今天' : U.weekday(r.exDate)}</span>
          <span class="up-cash">${U.esc(cash)}</span>
          <span class="up-name"><button type="button" class="up-stock" data-act="up-stock" data-value="${U.esc(r.code)}"><span class="card-code">${U.esc(r.code)}</span>${U.esc(nameOf(r.code))}</button> ${tags}</span>
          <span class="up-pct">${r.cash !== null && price > 0 ? `約 ${pct(r.cash / price)}` : ''}</span>
          <span class="up-meta">${U.esc(meta.join(' · '))}</span>
          ${act ? `<span class="up-act">${act}</span>` : ''}
        </li>`;
    };

    let html = '';
    let group = null;
    (pageOpen ? rows : rows.slice(0, PAGE_MAX)).forEach(r => {
      const g = weekOf(r.exDate, today);
      if (g !== group) {
        html += `${group ? '</ul>' : ''}<h4 class="up-group">${WEEKS[g]}</h4><ul class="up-list">`;
        group = g;
      }
      html += row(r);
    });
    html += '</ul>';
    const more = rows.length > PAGE_MAX
      ? `<button type="button" class="up-more" data-act="up-more" aria-expanded="${pageOpen}">${pageOpen ? '收起' : `還有 ${rows.length - PAGE_MAX} 筆`}${chevron}</button>` : '';
    return `
      <div class="up-panel">
        ${head}
        ${html}
        ${more}
        <p class="up-foot">右邊的 % 是每股現金 ÷ 現價：除權息日當天參考價大約少這麼多。想領這次股利，最晚前一個交易日買進。持有的照目前的股數算，點「記下來」加到下面的除權息</p>
      </div>`;
  }

  // 詳細版裡的按鈕（list.js 呼叫）：回傳 { redraw } 重畫這一頁、{ added, msg } 新增了一筆除權息；不是這裡的按鈕回傳 null
  function pageAct(name, value) {
    if (name === 'up-more') {
      pageOpen = !pageOpen;
      try { localStorage.setItem(PAGE_KEY, pageOpen ? '1' : '0'); } catch (_) {}
      return { redraw: true };
    }
    if (name === 'up-stock') {
      Detail.open(value);
      return {};
    }
    if (name !== 'up-add') return null;
    const [code, exDate] = String(value).split('|');
    const today = U.today();
    const r = list([code], { today, days: null }).find(x => x.exDate === exDate);
    if (!r || r.cash === null) return { redraw: true };
    if (Store.list('dividends', 'all').some(d => Announced.sameEvent(d, r))) return { redraw: true };
    const name2 = mine(today).nameOf(r.code);
    const added = Store.add('dividends',
      { code: r.code, name: name2, exDate: r.exDate, payDate: r.payDate, cash: r.cash, stock: r.stock, baseShares: {} });
    return { added, msg: `已記下 ${r.code} ${name2} ${md(r.exDate)} 除息` };
  }

  return { list, cardHTML, toggle, pageHTML, pageAct, weekOf };
})();
