



















function createQuoteList(range, { openStock = () => {}, view = null } = {}) {
  const STEP = 50;

  const ORDERED = range === 'watch' && typeof WatchOrder !== 'undefined';
  const SORTS = view?.sorts || [...(ORDERED ? [['mine', '自訂順序']] : []),
    ['code', '依代號'], ['codeDesc', '代號大的在前'], ['up', '漲幅大的在前'], ['down', '跌幅大的在前'], ['vol', '成交量大的在前'], ['volAsc', '成交量小的在前']];
  const FLIP = view ? view.flip || { up: 'down' } : { up: 'down', code: 'codeDesc', vol: 'volAsc' };
  const showsOf = () => (typeof view?.shows === 'function' ? view.shows() : view?.shows || null);
  const SHOWS = showsOf();
  const state = { keyword: '', sort: SORTS[0][0], show: SHOWS ? SHOWS[0]?.[0] ?? '' : '', limit: STEP };
  let listed = [];
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const names = () => (typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {});
  const md = d => U.fmtDate(d).slice(5);
  const px = v => U.fmtNum(U.round(v, 2), 2);
  const abs = v => U.fmtNum(U.round(Math.abs(v), 2), 2);
  const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${abs(v)}`;
  const arrow = v => (v > 0 ? '▲' : v < 0 ? '▼' : '');
  const tone = v => (typeof v !== 'number' || v === 0 ? '' : v > 0 ? 'up' : 'down');

  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <select class="f-sort" aria-label="${SHOWS ? '看哪些' : '排序'}">
        ${(SHOWS || SORTS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}
      </select>
      <input class="f-keyword" type="search" placeholder="搜尋全市場" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;
  const sortSel = el.querySelector('.f-sort');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  sortSel.addEventListener('change', () => {
    state[SHOWS ? 'show' : 'sort'] = sortSel.value;
    page.picked?.(sortSel.value);
    state.limit = STEP;
    render();
  });

  const onKeyword = () => { state.keyword = keywordInput.value; state.limit = STEP; render(); };
  keywordInput.addEventListener('input', e => { if (!(e.isComposing && U.zhuyinPending(keywordInput.value))) onKeyword(); });
  keywordInput.addEventListener('compositionend', onKeyword);
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (btn?.dataset.act === 'sort') {

      const v = btn.dataset.value;
      state.sort = FLIP[v] && state.sort === v ? FLIP[v] : v;
      if (!SHOWS) sortSel.value = state.sort;
      page.sorted?.(state.sort);
      state.limit = STEP;
      render();
      return;
    }
    if (btn?.dataset.act === 'more') {
      state.limit += STEP;
      render();
      return;
    }
    if (btn) return;
    const row = e.target.closest('.trow[data-code], .card[data-code]');
    if (row) openStock(row.dataset.code);
  });


  function mine() {
    const out = new Map();
    const h = Holdings.all(U.today());
    (h ? h.positions : []).filter(p => p.shares > 0).forEach(p => {
      if (!out.has(key(p.code))) out.set(key(p.code), { code: key(p.code), name: p.name, held: true, watched: false });
    });
    Store.list('watch').forEach(r => {
      const c = key(r.code);
      if (!c) return;
      if (out.has(c)) out.get(c).watched = true;
      else out.set(c, { code: c, name: r.name, held: false, watched: true });
    });
    return out;
  }


  function market(my) {
    const list = names();
    const out = Market.codes().map(code => my.get(code) || { code, name: list[code] || '', held: false, watched: false });
    my.forEach(r => { if (!Market.get(r.code)) out.push(r); });
    return out;
  }


  function enrich(r) {
    const m = Market.get(r.code);
    const bars = m ? Candles.get(r.code) : null;
    const prev = bars ? bars.find(b => b.date < m.date)?.close ?? null : null;
    const vol = bars ? bars.find(b => b.date === m.date)?.vol ?? null : null;
    const chg = m && prev ? m.close - prev : null;
    return { ...r, close: m ? m.close : null, date: m ? m.date : '', chg, pct: chg === null ? null : chg / prev * 100, vol };
  }



  const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const indexFirst = (a, b) => U.isIndex(b.code) - U.isIndex(a.code);
  const indexLast = (a, b) => U.isIndex(a.code) - U.isIndex(b.code);
  const last = (a, b, k) => (a[k] === null) - (b[k] === null);
  let order = new Map();
  const at = r => order.get(r.code) ?? Number.MAX_SAFE_INTEGER;
  const CMP = {
    mine: (a, b) => at(a) - at(b) || indexFirst(a, b) || byCode(a, b),
    code: (a, b) => indexFirst(a, b) || byCode(a, b),
    codeDesc: (a, b) => indexLast(a, b) || byCode(b, a),
    up: (a, b) => last(a, b, 'pct') || (b.pct ?? 0) - (a.pct ?? 0) || byCode(a, b),
    down: (a, b) => last(a, b, 'pct') || (a.pct ?? 0) - (b.pct ?? 0) || byCode(a, b),
    vol: (a, b) => indexLast(a, b) || last(a, b, 'vol') || (b.vol ?? 0) - (a.vol ?? 0) || byCode(a, b),
    volAsc: (a, b) => indexLast(a, b) || last(a, b, 'vol') || (a.vol ?? 0) - (b.vol ?? 0) || byCode(a, b),
  };

  const tagsHTML = (r, search) => ((r.held && (search || range !== 'held')) ? ' <span class="badge member">持有</span>' : '') +
    ((r.watched && (search || range !== 'watch')) ? ' <span class="badge">自選</span>' : '');
  function tableHTML(rows, search) {
    const DIR = { code: 'asc', codeDesc: 'desc', up: 'desc', down: 'asc', vol: 'desc', volAsc: 'asc' };
    const dir = (...s) => (s.includes(state.sort) ? DIR[state.sort] : '');
    const cols = [
      { label: ['證券', '代號'], sort: 'code', dir: dir('code', 'codeDesc') },
      { label: ['收盤價', '漲跌幅'], sort: 'up', dir: dir('up', 'down') },
      { label: ['成交量', '張'], sort: 'vol', dir: dir('vol', 'volAsc') },
    ];
    return Table.html(cols, rows.map(r => {
      const t = tone(r.chg);
      const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(md(r.date))}</small>` : '';
      return Table.row({
        attrs: `data-code="${U.esc(r.code)}"`,
        cells: [
          Table.name(r.name, r.code, tagsHTML(r, search)),
          r.close === null ? Table.cell('—')
            : Table.cell(`${stale}${px(r.close)}`, r.chg === null ? '—' : `${arrow(r.chg)}${abs(r.chg)} (${signed(r.pct)}%)`, `quote-price${t ? ` ${t}` : ''}`),
          Table.cell(r.vol === null ? '—' : `${U.fmtNum(r.vol)}${U.isIndex(r.code) ? ' 億' : ''}`),
        ],
      });
    }));
  }


  function cardHTML(r, search) {
    const t = tone(r.chg);
    const stale = r.date && r.date !== Market.date() ? `${md(r.date)} 收盤` : '收盤價';
    const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
    const tags = tagsHTML(r, search);
    return `
      <div class="card quote-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>${U.esc(stale)}</small><b class="${t}">${r.close === null ? '—' : px(r.close)}</b></span>
        </span>
        <span class="card-grid">
          ${cell('漲跌', r.chg === null ? '—' : signed(r.chg), t)}
          ${cell('漲跌幅', r.pct === null ? '—' : `${signed(r.pct)}%`, t)}
          ${cell(U.isIndex(r.code) ? '成交金額（億）' : '成交量（張）', r.vol === null ? '—' : U.fmtNum(r.vol))}
        </span>
      </div>`;
  }


  function introHTML() {
    return Note.line(U.esc(Market.closeLine()), '行情怎麼看',
      '<p>價格是收盤價；漲跌是和前一個交易日的收盤比，紅色漲、綠色跌；成交量是那天的張數（1000 股一張），加權指數沒有張數，寫的是成交金額（億）。</p>' +
      `<p>${range === 'held' ? '庫存是設定裡勾的成員現在持有的股票。' : '自選是全家共用的一份清單：點右上角「新增自選」加進來，或點開一檔按上面小標籤的「自選」。'}` +
      '上面的搜尋找的是全市場。</p>' +
      (ORDERED ? '<p>自訂順序在「新增自選」下面的清單調整：按住右邊 ≡ 上下拖，或按「置頂」。順序只記在這台裝置，換手機、登出要重排。</p>' : '') +
      '<p>點表頭排序，同一欄再點一次反過來。</p>' +
      '<p>點一檔看 K 線、成交量和 KD。</p>' +
      `<p class="muted">${U.esc(Market.closeNote())}</p>`);
  }

  const page = view ? view.make({ tagsHTML, state }) : { enrich, compare: CMP, tableHTML, cardHTML, introHTML };


  let stale = false;
  function refresh() {
    if (el.hidden) stale = true;
    else render();
  }
  function shown() {
    if (stale) render();
  }


  let showsHTML = '';
  function syncShows() {
    if (typeof view?.shows !== 'function') return;
    const html = showsOf().map(([v, label]) => `<option value="${U.esc(v)}">${U.esc(label)}</option>`).join('');
    if (html !== showsHTML) sortSel.innerHTML = showsHTML = html;
    sortSel.value = state.show;
  }

  function render() {
    stale = false;
    page.sync?.();
    syncShows();
    const kw = state.keyword.trim().toLowerCase();
    const search = !!kw;
    const my = mine();
    if (search && !Market.ready()) {
      countEl.textContent = '';
      listEl.innerHTML = `<p class="empty">${U.esc(Market.waiting())}</p>`;
      return;
    }
    const match = r => `${r.code} ${r.name}`.toLowerCase().includes(kw);
    const show = SHOWS && !search ? page.show(state.show) : null;
    const wide = search || !!show?.market;
    const base = search ? market(my).filter(match) : wide ? market(my) : [...my.values()].filter(r => (range === 'held' ? r.held : range === 'watch' ? r.watched : true));
    const enriched = (view?.noIndex ? base.filter(r => !U.isIndex(r.code)) : base).map(page.enrich);
    if (state.sort === 'mine') order = WatchOrder.rank([...my.values()].filter(r => r.watched).map(r => r.code));
    const kept = page.keep ? enriched.filter(page.keep) : enriched;
    const all = (show?.keep ? kept.filter(show.keep) : kept).sort(page.compare[state.sort]);
    const rows = wide ? all.slice(0, state.limit) : all;
    listed = rows.map(r => r.code);
    countEl.textContent = `${U.fmtNum(all.length)} 檔`;
    if (!rows.length) {
      const empty = search ? '全市場沒有符合的股票'
        : show?.keep ? page.noneText()
        : view ? view.empty
        : range === 'held' ? '目前沒有持股<br>到「帳務」記一筆買進，或照券商的庫存填一期快照'
        : '還沒有自選股<br>點右上角「新增自選」，打代號或名稱加進來<br>也可以在上面搜尋，點開一檔加入自選';
      listEl.innerHTML = `<p class="empty">${empty}</p>`;
      return;
    }
    const more = all.length > rows.length
      ? `<button type="button" class="wide-btn more-btn" data-act="more">再顯示 ${Math.min(STEP, all.length - rows.length)} 檔（還有 ${U.fmtNum(all.length - rows.length)} 檔）</button>` : '';
    listEl.innerHTML = page.introHTML() + (Cards.on ? rows.map(r => page.cardHTML(r, search)).join('') : page.tableHTML(rows, search)) + more;
  }

  function reset() {
    state.keyword = '';
    state.limit = STEP;
    keywordInput.value = '';
    refresh();
  }


  function changed(rec) {
    if (el.hidden) {
      stale = true;
      return;
    }
    render();
    const row = rec?.code && listEl.querySelector(`[data-code="${CSS.escape(key(rec.code))}"]`);
    if (row) {
      row.classList.add('flash');
      row.scrollIntoView({ block: 'nearest' });
    }
  }


  if (ORDERED) {
    WatchOrder.onChange(() => {
      state.sort = 'mine';
      sortSel.value = 'mine';
      refresh();
    });
  }

  return { el, refresh, reset, changed, shown, codes: () => listed };
}
