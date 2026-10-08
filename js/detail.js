// 一檔股票的詳細資料：行情的卡片點了打開（從底部彈出，和新增表單一樣）
//   最上面：持有或觀察、星星（達標的條件，見 stars.js）
//   我的：目前持股（跟著設定裡勾的成員，好幾位時寫出每人的股數）、市值、損益試算、領到的股利；隱藏金額時顯示 ***
//   殖利率、KD：和行情頁同樣的算法（YIELD_PAGE、KD_PAGE），達到星星條件的數字旁邊標 ★
//   配息紀錄：公告的除權息加上自己記的（Yield.events），新的在前
//   最下面可以加入觀察清單、從觀察清單移除（觀察清單全家共用）
const Detail = (() => {
  const dlg = document.getElementById('stock-sheet');
  // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）時什麼都不做
  if (!dlg) return { init() {}, open() {}, refresh() {} };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  let code = null;
  let hooks = { toast() {}, onChanged() {} };

  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const pct = n => (typeof n === 'number' ? `${U.fmtNum(U.round(n * 100, 2), 2)}%` : '—');
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  const notesHTML = list => list.map(n => `<span class="card-note">${U.esc(n)}</span>`).join('');

  function init(h) {
    hooks = h;
  }

  function open(c) {
    code = key(c);
    render();
    if (!dlg.open) dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  // 資料變了（同步、隱藏金額、觀察清單）：開著的話重畫
  function refresh() {
    if (dlg.open) render();
  }

  // 我的：持股和領到的股利；都沒有時只寫一句
  function mineHTML(pos, price) {
    const today = U.today();
    const divs = VIEWS.cashDividends.rows().filter(r => key(r.code) === code && r.net !== null);
    const paid = divs.filter(r => r.payDate && r.payDate <= today);
    const thisYear = paid.filter(r => r.payDate.startsWith(today.slice(0, 4)));
    const pending = divs.filter(r => r.payDate > today);
    const sum = rows => rows.reduce((s, r) => s + r.net, 0);
    if (!pos && !divs.length) return '<p class="note muted">目前沒有持有，也還沒有領過股利</p>';

    let html = '';
    if (pos) {
      const value = price ? pos.shares * price : null;
      const pl = value === null ? null : Math.round(value) - Math.round(pos.cost);
      const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
      const rate = pl !== null && pos.cost > 0 ? Privacy.num(`${U.fmtNum(U.round(pl / pos.cost * 100, 2), 2)}%`) : '—';
      const each = pos.parts && Store.members().length > 1
        ? pos.parts.map(x => `${Store.memberName(x.member)} ${Privacy.num(U.fmtNum(x.shares))} 股`).join(' · ') : '';
      html += `
        <span class="card-grid">
          ${cell('股數', Privacy.num(U.fmtNum(pos.shares)))}
          ${cell('成本均價', Privacy.num(U.fmtNum(U.round(pos.cost / pos.shares, 2), 2)))}
          ${cell('付出成本', money(pos.cost))}
          ${cell('市值', value === null ? '—' : money(value))}
          ${cell('損益試算', pl === null ? '—' : Privacy.num(U.fmtNum(pl)), tone)}
          ${cell('報酬率', rate, tone)}
        </span>
        ${each ? `<span class="card-note">${U.esc(each)}</span>` : ''}`;
    } else {
      html += '<span class="card-note">目前沒有持有</span>';
    }
    if (divs.length) {
      html += `
        <span class="card-grid">
          ${cell('今年領到', `${money(sum(thisYear))} 元`)}
          ${cell('一共領到', `${money(sum(paid))} 元`)}
          ${pending.length ? cell('還沒入帳', `${money(sum(pending))} 元`) : ''}
        </span>`;
    }
    return html;
  }

  // 配息紀錄：公告的加上自己記的，新的在前；還沒除息的寫「預計」，金額還沒公告寫「待公告」
  function eventsHTML() {
    const today = U.today();
    const list = Yield.events(code, Store.list('dividends', 'all'));
    if (!list.length) return '<p class="note muted">公告資料裡沒有這檔的配息，也還沒有記過</p>';
    return `<ul class="member-list detail-events">${list.map(r => `
      <li>
        <span class="ev-date">${U.esc(U.fmtDate(r.exDate))}${r.exDate > today ? '<small>預計</small>' : ''}</span>
        <span class="ev-pay">${r.payDate ? `發放 ${U.esc(md(r.payDate))}` : ''}</span>
        <span class="ev-cash">${typeof r.cash === 'number' ? `${U.fmtNum(r.cash)} 元` : '待公告'}${r.own ? '<small>你記的</small>' : ''}</span>
      </li>`).join('')}</ul>`;
  }

  function render() {
    const today = U.today();
    const h = Holdings.all(today);
    const pos = (h ? h.positions : []).find(p => key(p.code) === code && p.shares > 0) || null;
    const watchRec = Store.list('watch').find(r => key(r.code) === code) || null;
    const names = typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {};
    const name = pos?.name || watchRec?.name || names[code] || Announced.forCode(code)[0]?.name || '';
    const r = STARS_PAGE.enrich({ code, name, held: !!pos, watched: !!watchRec });
    const { info, m } = r;
    const kz = KD.zone(r.k);
    const dz = KD.zone(m?.d);
    const cross = KD_PAGE.crossCell(m);
    const q = Market.quote(code);
    const priceFrom = !q.price ? '' : q.close ? `${md(q.close)} 收盤價` : '即時價格，可能延遲 20 分鐘';
    const total = Stars.on().length;

    titleEl.textContent = `${code} ${name}`.trim();
    const tag = holdTagsHTML(r);
    bodyEl.innerHTML = `
      <div class="detail-top">
        ${tag}
        <span class="detail-stars${r.n ? '' : ' none'}">${'★'.repeat(r.n)}${'☆'.repeat(Math.max(0, total - r.n))}</span>
        <span class="detail-met">${!total ? '星星條件都沒有打勾' : r.n ? `達標：${r.stars.map(x => x.short).join('、')}` : '沒有達標的條件'}</span>
      </div>

      <h3 class="section-head">我的</h3>
      <div class="card static detail-card">${mineHTML(pos, r.price)}</div>

      <h3 class="section-head">殖利率</h3>
      <div class="card static detail-card yield-card">
        <span class="card-grid">
          ${cell('現價', r.price ? U.fmtNum(r.price, 2) : '—')}
          ${cell(`殖利率${Stars.mark(r, 'yield')}`, pct(r.y), 'strong')}
          ${cell(`暴力年化${Stars.mark(r, 'trend')}`, pct(r.ya), `strong${r.ya === null ? '' : info.trend > 0 ? ' up' : info.trend < 0 ? ' down' : ''}`)}
          ${cell('近一年股利', info?.count ? `${U.fmtNum(info.sum)} 元` : '—')}
          ${cell('配息', info ? info.freq : '—')}
        </span>
        ${priceFrom ? `<span class="card-note">現價：${U.esc(priceFrom)}</span>` : ''}
        ${notesHTML(YIELD_PAGE.notes(r))}
      </div>

      <h3 class="section-head">KD（日 KD，9 日）</h3>
      <div class="card static detail-card kd-card">
        <span class="card-grid">
          ${cell(`K 值${Stars.mark(r, 'kdLow')}`, fmt(r.k), kz ? `strong ${kz}` : 'strong')}
          ${cell('D 值', fmt(m?.d), dz)}
          ${cell(`交叉${Stars.mark(r, 'golden')}`, cross[1], cross[0])}
        </span>
        ${notesHTML([KD_PAGE.note(r, { close: true })])}
      </div>

      <h3 class="section-head">配息紀錄</h3>
      ${eventsHTML()}

      ${watchRec
        ? '<button type="button" class="wide-btn danger" data-act="unwatch">從觀察清單移除</button>'
        : '<button type="button" class="wide-btn primary detail-watch" data-act="watch">加入觀察清單</button>'}`;
  }

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
  bodyEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'watch') {
      const rec = Store.add('watch', { code, name: titleEl.textContent.slice(code.length).trim() });
      hooks.onChanged('watch', rec);
      render();
      hooks.toast('已加入觀察清單');
    } else if (act === 'unwatch') {
      const rec = Store.list('watch').find(r => key(r.code) === code);
      if (!rec || !confirm(`確定從觀察清單移除：${titleEl.textContent}？`)) return;
      Store.remove('watch', rec.id);
      hooks.onChanged('watch', null);
      render();
      hooks.toast('已移除');
    }
  });

  return { init, open, refresh };
})();
