// 即將除權息：總覽的一張卡片（見 overview.js），列出持股接下來 30 天要除權息的
//   資料：公告的除權息（announced.js）加上自己記的除權息；同一次（代號相同、除權息日差 7 天內）以公告為主，
//         公告的金額還沒出來時用自己記的
//   持股跟著上面選的成員
//   可以摺疊：收起時只列最近的一筆；展開、收起在卡片右上角同一個位置（「還有 N 筆」↔「收起」）
//     展開或收起記在這台裝置，預設收起
//   點一筆打開那一檔的「我的」（overview.js），和詳細版一樣
//   最下面「看全部」：切到股利 → 即將除權息（見下面的 createPage）
//
// 詳細版：股利 → 即將除權息，一整頁（createPage）
//   不限 30 天：公告的、自己記的，除權息日今天以後的全部；分「本週」「下週」「之後」（週一到週日算一週），全部列出
//   每一筆：除權息日、股票、每股現金（配股）、發放日
//     點一筆打開那一檔的「我的」（見 mine.js），和股利一樣；只有帳務裡點一筆是修改
//     照目前的股數算預估領多少（看好幾位成員時寫每個人的股數；隱藏金額時 ***）
//       還沒記在除權息（帳務 → 除權息）：「記下來」一鍵加入（基準日股數自動推算，和訊息匣的「加入」一樣）；金額還沒公告的等公告了再記
//       記過了：寫「已記」
//   沒有持股時寫一句，叫你先記
const Upcoming = (() => {
  const DAYS = 30;
  const MAX = 8; // 展開時最多列幾筆，其他的寫「還有 N 筆沒有列出」
  const OPEN_KEY = U.key('upcomingOpen');
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
  //   own：自己記的除權息；沒給時用 Store 裡的（已經依代號分好，見 announced.js 的 recorded）
  function list(codes, { today = U.today(), days = DAYS, own } = {}) {
    const until = days === null ? '9999-12-31' : plusDays(today, days);
    const inRange = d => !!d && d >= today && d <= until;
    return [...new Set(codes.map(key).filter(Boolean))].flatMap(c => {
      const mine = (own ? own.filter(d => key(d.code) === c) : Announced.recorded(c)).filter(d => inRange(d.exDate));
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

  // 每股多少（卡片、詳細版、「我的」的下次除權息共用）；金額是自己記的，在日期後面標 *（見 events.js）
  const cashText = r => (r.cash === null ? '金額待公告'
    : `每股 ${U.fmtNum(r.cash)} 元${r.stock ? `＋配股 ${U.fmtNum(r.stock)} 元` : ''}`);

  // 卡片：holdings 是 Holdings.all 的結果（沒有持股時是 null）
  function cardHTML(holdings) {
    const today = U.today();
    const held = new Map((holdings ? holdings.positions : []).filter(p => p.shares > 0).map(p => [p.code, p.name]));
    const rows = list([...held.keys()], { today });
    const nameOf = c => held.get(c) || (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || '';
    const md = d => (d.startsWith(today.slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));

    const row = r => {
      const cash = cashText(r);
      return `
        <li class="up-row" data-code="${U.esc(r.code)}">
          <span class="up-date">${U.esc(md(r.exDate))} ${r.exDate === today ? '今天' : U.weekday(r.exDate)}${r.own ? Events.ownMark : ''}</span>
          <span class="up-cash">${U.esc(cash)}</span>
          <span class="up-name"><button type="button" class="up-stock"><span class="card-code">${U.esc(r.code)}</span>${U.esc(nameOf(r.code))}</button></span>
        </li>`;
    };

    let body;
    let toggle = '';
    let ownNote = ''; // 列出來的有 * 才寫
    if (!held.size) body = '<span class="kpi-sub">還沒有持股</span>';
    else if (!Announced.ready() && !rows.length) {
      body = `<span class="kpi-sub">${Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載'}</span>`;
    } else if (!rows.length) body = `<span class="kpi-sub">接下來 ${DAYS} 天沒有已公告的除權息</span>`;
    else {
      const shown = open ? rows.slice(0, MAX) : rows.slice(0, 1);
      if (shown.some(r => r.own)) ownNote = `；${Events.OWN_NOTE}`;
      const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
      // 展開、收起：右上角同一個位置（.sec-btn）
      if (rows.length > 1) {
        toggle = `<button type="button" class="sec-btn" data-act="upcoming" aria-expanded="${open}">` +
          `${open ? '收起' : `還有 ${rows.length - 1} 筆`}${chevron}</button>`;
      }
      body = `<ul class="up-list">${shown.map(row).join('')}</ul>` +
        (open && rows.length > MAX ? `<span class="kpi-sub">還有 ${rows.length - MAX} 筆沒有列出</span>` : '') +
        '<button type="button" class="link-btn up-all" data-act="upcoming-all">看全部（股利 → 即將除權息）</button>';
    }
    return `
      <div class="kpi wide upcoming">
        <span class="up-head"><small>即將除權息</small>${toggle}</span>
        <span class="kpi-sub">持股，接下來 ${DAYS} 天${ownNote}</span>
        ${body}
      </div>`;
  }

  // ---------- 詳細版（股利 → 即將除權息） ----------
  const WEEKS = { this: '本週', next: '下週', later: '之後' };

  // 本週、下週、之後：週一到週日算一週
  function weekOf(exDate, today) {
    const monday = plusDays(today, -((new Date(`${today}T00:00:00`).getDay() + 6) % 7));
    return exDate < plusDays(monday, 7) ? 'this' : exDate < plusDays(monday, 14) ? 'next' : 'later';
  }

  // 持股（跟著設定裡勾的成員）、名稱
  function mine(today) {
    const h = Holdings.all(today);
    const held = new Map((h ? h.positions : []).filter(p => p.shares > 0).map(p => [key(p.code), p]));
    const nameOf = c => held.get(c)?.name ||
      (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || Announced.forCode(c)[0]?.name || '';
    return { held, nameOf };
  }

  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));

  function pageHTML() {
    const today = U.today();
    const { held, nameOf } = mine(today);
    if (!held.size) return '<p class="empty">還沒有持股<br>到「帳務」記一筆買進，或照券商的庫存填一期快照</p>';
    const rows = list([...held.keys()], { today, days: null });
    const several = Store.shown().length > 1;
    // 上面一行和其他頁一樣，右邊「說明」點了用小泡泡打開（見 note.js）：記下來
    const line = Note.line(`持股${rows.length ? `，${rows.length} 筆` : ''}${rows.some(r => r.own) ? `；${Events.OWN_NOTE}` : ''}`, '即將除權息',
      '<p>照目前的股數算預估領多少，點「記下來」加到帳務的除權息</p>');
    if (!rows.length) {
      const why = !Announced.ready()
        ? (Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載')
        : '接下來沒有已公告的除權息';
      return `${line}<p class="empty">${why}</p>`;
    }

    const row = r => {
      const pos = held.get(r.code);
      const cash = cashText(r);
      const shares = several && pos.parts?.length
        ? pos.parts.filter(x => x.shares > 0).map(x => `${Store.memberName(x.member)} ${Privacy.num(U.fmtNum(x.shares))} 股`).join('、')
        : `${Privacy.num(U.fmtNum(pos.shares))} 股`;
      const meta = [
        r.payDate ? `發放 ${md(r.payDate)}` : '發放日待公告',
        r.cash === null ? shares : `${shares}，預估領 ${Privacy.num(U.fmtNum(Math.round(r.cash * pos.shares)))} 元`,
      ];
      const act = Announced.recorded(r.code).some(d => Announced.sameEvent(d, r)) ? '<span class="up-done">已記 ✓</span>'
        : r.cash === null ? '<span class="up-done">金額公告後再記</span>'
        : `<button type="button" class="up-add" data-act="up-add" data-value="${U.esc(`${r.code}|${r.exDate}`)}">記下來</button>`;
      // 整列點了都打開「我的」；股票名稱是按鈕，用鍵盤也點得到
      return `
        <li class="up-row up-item" data-code="${U.esc(r.code)}">
          <span class="up-date">${U.esc(md(r.exDate))} ${r.exDate === today ? '今天' : U.weekday(r.exDate)}${r.own ? Events.ownMark : ''}</span>
          <span class="up-cash">${U.esc(cash)}</span>
          <span class="up-name"><button type="button" class="up-stock"><span class="card-code">${U.esc(r.code)}</span>${U.esc(nameOf(r.code))}</button></span>
          <span class="up-meta">${meta.map(m => `<span>${U.esc(m)}</span>`).join('')}</span>
          <span class="up-act">${act}</span>
        </li>`;
    };

    let html = '';
    let group = null;
    rows.forEach(r => {
      const g = weekOf(r.exDate, today);
      if (g !== group) {
        html += `${group ? '</ul>' : ''}<h4 class="up-group">${WEEKS[g]}</h4><ul class="up-list">`;
        group = g;
      }
      html += row(r);
    });
    return `${line}<div class="up-panel">${html}</ul></div>`;
  }

  // 「記下來」：回傳新增的那一筆除權息和提示訊息；已經記過、金額還沒公告時回傳 null
  function record(value) {
    const [code, exDate] = String(value).split('|');
    const today = U.today();
    const r = list([code], { today, days: null }).find(x => x.exDate === exDate);
    if (!r || r.cash === null) return null;
    if (Store.list('dividends', 'all').some(d => Announced.sameEvent(d, r))) return null;
    const name = mine(today).nameOf(r.code);
    const added = Store.add('dividends',
      { code: r.code, name, exDate: r.exDate, payDate: r.payDate, cash: r.cash, stock: r.stock, baseShares: {} });
    return { added, msg: `已記下 ${r.code} ${name} ${md(r.exDate)} 除息（帳務 → 除權息）` };
  }

  // 股利的第二頁（app.js）：hooks.onChanged(表, 那一筆)、hooks.toast(訊息)、hooks.openStock(代號)
  //   和其他頁一樣，看不到的時候資料變了先記著，切過來時（shown）才畫
  function createPage(hooks) {
    const el = document.createElement('section');
    el.className = 'panel';
    el.hidden = true;
    el.innerHTML = '<div class="list"></div>';
    const listEl = el.querySelector('.list');
    let stale = false;
    function refresh() {
      if (el.hidden) {
        stale = true;
        return;
      }
      stale = false;
      listEl.innerHTML = pageHTML();
    }
    listEl.addEventListener('click', e => {
      const add = e.target.closest('[data-act="up-add"]');
      if (add) {
        const done = record(add.dataset.value);
        if (!done) { refresh(); return; }
        hooks.onChanged('dividends', done.added);
        hooks.toast(done.msg);
        return;
      }
      const item = e.target.closest('.up-item[data-code]');
      if (item) hooks.openStock(item.dataset.code);
    });
    // 上一檔、下一檔的順序：列出來的順序，同一檔只算一次
    const codes = () => [...new Set([...listEl.querySelectorAll('.up-item[data-code]')].map(n => n.dataset.code))];
    return { el, refresh, changed: refresh, reset: refresh, shown: () => { if (stale) refresh(); }, codes };
  }

  return { list, cardHTML, toggle, createPage, weekOf, cashText, md };
})();

const UPCOMING_PAGE = {
  title: '即將除權息',
};
