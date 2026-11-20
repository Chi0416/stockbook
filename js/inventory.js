












const INVENTORY = { title: '庫存' };

function createInventory(hooks) {

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


  const onKeyword = () => { state.keyword = keywordInput.value; renderList(); };
  keywordInput.addEventListener('input', e => { if (!(e.isComposing && U.zhuyinPending(keywordInput.value))) onKeyword(); });
  keywordInput.addEventListener('compositionend', onKeyword);

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

  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('[data-act="privacy"]')) return;
    Privacy.toggle();
    kpisEl.querySelector('[data-act="privacy"]')?.focus({ preventScroll: true });
  });

  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('.kpi.hero') || e.target.closest('[data-act="privacy"]')) return;
    Trend.open();
  });


  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const shares = n => Privacy.num(U.fmtNum(n));

  const eyeHTML = () => `
    <button type="button" class="eye-btn" data-act="privacy" aria-pressed="${Privacy.hidden}"
      aria-label="${Privacy.hidden ? '顯示金額' : '隱藏金額'}" title="${Privacy.hidden ? '顯示金額' : '隱藏金額'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>${Privacy.hidden ? '<path d="M4 4l16 16"/>' : ''}</svg>
    </button>`;


  function renderKpis(holdings) {

    const basis = h => (h.snapDate ? `依 ${U.fmtDate(h.snapDate)} 庫存快照推算到今天`
      : h.mixed ? '依各成員的庫存快照和交易紀錄推算到今天'
      : '依交易紀錄加總到今天');


    let hero;
    if (holdings) {
      const priced = holdings.positions.filter(p => p.shares > 0 && priceOf(p.code) !== null);
      const value = priced.reduce((s, p) => s + p.shares * priceOf(p.code), 0);
      const pricedCost = priced.reduce((s, p) => s + p.cost, 0);
      const pl = Math.round(value) - Math.round(pricedCost);

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



  function checkNote() {
    if (typeof Holdings.check !== 'function') return '';
    const n = Holdings.check().filter(c => c.status === 'diff').length;
    return n ? `<p class="kpi-note">有 ${n} 筆庫存快照的股數和交易紀錄對不上，明細請看「庫存快照」那一頁</p>` : '';
  }


  function noteHTML(p) {

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


  function priceOf(code) {
    return Market.quote(code).price;
  }


  function priceNote(positions) {
    const codes = positions.filter(p => p.shares > 0).map(p => p.code);
    const note = Market.priceNote(codes);
    return note ? Note.line(Market.priceLine(codes), '價格', `<p>${U.esc(note)}</p>`) : '';
  }

  let mixed = false;
  const mark = code => (mixed ? Market.closeTag(code) : '');


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



  const codes = () => [...listEl.querySelectorAll('[data-code]')].map(n => n.dataset.code);

  return { el, refresh, reset, changed: refresh, shown, codes };
}
