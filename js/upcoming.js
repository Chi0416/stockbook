
















const Upcoming = (() => {
  const DAYS = 30;
  const MAX = 8;
  const OPEN_KEY = U.key('upcomingOpen');
  let open = false;
  try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) {}


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


  const cashText = r => (r.cash === null ? '金額待公告'
    : `每股 ${U.fmtNum(r.cash)} 元${r.stock ? `＋配股 ${U.fmtNum(r.stock)} 元` : ''}`);


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
    let ownNote = '';
    if (!held.size) body = '<span class="kpi-sub">還沒有持股</span>';
    else if (!Announced.ready() && !rows.length) {
      body = `<span class="kpi-sub">${Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載'}</span>`;
    } else if (!rows.length) body = `<span class="kpi-sub">接下來 ${DAYS} 天沒有已公告的除權息</span>`;
    else {
      const shown = open ? rows.slice(0, MAX) : rows.slice(0, 1);
      if (shown.some(r => r.own)) ownNote = `；${Events.OWN_NOTE}`;
      const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

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


  const WEEKS = { this: '本週', next: '下週', later: '之後' };


  function weekOf(exDate, today) {
    const monday = plusDays(today, -((new Date(`${today}T00:00:00`).getDay() + 6) % 7));
    return exDate < plusDays(monday, 7) ? 'this' : exDate < plusDays(monday, 14) ? 'next' : 'later';
  }


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

    const codes = () => [...new Set([...listEl.querySelectorAll('.up-item[data-code]')].map(n => n.dataset.code))];
    return { el, refresh, changed: refresh, reset: refresh, shown: () => { if (stale) refresh(); }, codes };
  }

  return { list, cardHTML, toggle, createPage, weekOf, cashText, md };
})();

const UPCOMING_PAGE = {
  title: '即將除權息',
};
