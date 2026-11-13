








const DEDUCT_VIEW = {
  sorts: [['low', '扣低多的在前'], ['high', '扣高多的在前'], ['code', '依代號']],
  flip: { low: 'high' },
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面搜尋全市場',
  make({ tagsHTML, state }) {
    const md = d => U.fmtDate(d).slice(5);
    const px = v => U.fmtNum(U.round(v, 2), 2);
    const TURN = { 1: ['up', '↑ 上彎'], '-1': ['down', '↓ 下彎'], 0: ['', '持平'] };
    const DAYS = 5;

    function enrich(r) {
      const m = Market.get(r.code);
      const k = Deducts.get(r.code);
      const ok = k && k.ma !== undefined ? k : null;
      return { ...r, close: m ? m.close : null, date: m ? m.date : '', k: ok, days: k?.days ?? null };
    }

    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

    const most = (f, dir) => (a, b) => (b.k?.[f] ?? -1) - (a.k?.[f] ?? -1) || ((b.k?.slope ?? 0) - (a.k?.slope ?? 0)) * dir || byCode(a, b);
    const compare = { low: most('low', 1), high: most('high', -1), code: byCode };


    function why(r) {
      if (!Deducts.ready()) return Deducts.waiting();
      if (r.days !== null) return `只有 ${r.days} 天有成交，還算不出月線`;
      return '沒有這檔的收盤資料（興櫃、還沒開始交易的沒有）';
    }

    const miniOf = r => StockSheet.miniHTML(r.code, Deducts.assume(r.code, r.close));

    function miniCell(r) {
      if (!r.k && Deducts.ready()) return Table.cell('—');
      return `<span class="tcell kl-cell">${r.k ? miniOf(r) : '<span class="kc-mini"></span>'}</span>`;
    }

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'high' ? 'asc' : s === 'code' ? 'asc' : 'desc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['K 線'] },
        { label: ['收盤價', '月線'] },
        { label: ['月線', '扣低'], sort: 'low', dir: dir('low') || dir('high') },
      ];
      return Table.html(cols, rows.map(r => {
        const { k } = r;
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(md(r.date))}</small>` : '';
        const [cls, text] = k ? TURN[k.dir] : ['', ''];
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search)),
            miniCell(r),
            Table.cell(r.close === null ? '—' : `${stale}${px(r.close)}`, k ? px(k.ma) : '—'),
            k ? Table.cell(`<span class="${cls}">${text}</span>`, `扣低 ${k.low}/${DAYS}`, 'strong')
              : Table.cell('—', r.days !== null ? `只有 ${r.days} 天` : ''),
          ],
        });
      }));
    }

    function cardHTML(r, search) {
      const { k } = r;
      const cell = (label, v) => `<span class="cell"><small>${label}</small><span>${v}</span></span>`;
      const [cls, text] = k ? TURN[k.dir] : ['', '—'];
      const tags = tagsHTML(r, search);
      const notes = k
        ? [`今天扣 ${md(k.deducts[0].date)} 的 ${U.fmtNum(k.deducts[0].close)}；前一天的月線 ${px(k.prev)}`,
          `之後要扣：${k.deducts.slice(1).map(d => `${md(d.date)} ${U.fmtNum(d.close)}`).join('、')}`]
        : [why(r)];
      return `
      <div class="card kline-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>月線</small><b class="kl-dir ${cls}">${text}</b></span>
        </span>
        ${k ? `<span class="kl-mini">${miniOf(r)}</span>` : ''}
        <span class="card-grid">
          ${cell('收盤價', r.close === null ? '—' : px(r.close))}
          ${cell('月線', k ? px(k.ma) : '—')}
          ${cell('週線', k ? px(k.ma5) : '—')}
          ${cell('扣低', k ? `${k.low}/${DAYS}` : '—')}
        </span>
        ${notes.map(n => `<span class="card-note">${U.esc(n)}</span>`).join('')}
      </div>`;
    }


    function introHTML() {
      return Note.line(U.esc(Deducts.waiting() || Market.closeLine()), '扣抵怎麼看',
        '<p>小圖是最近 20 天的 K 棒和月線，右邊的虛線是價格不變時月線怎麼走。</p>' +
        '<p>月線的方向、扣低幾天都是用最新收盤價算好的，每個工作天收盤後更新，盤中不會變。</p>' +
        '<p>扣低越多，價格不變的話月線越容易往上彎；扣高越多越容易往下彎。</p>' +
        '<p>清單是設定裡勾的成員的庫存加上自選，上面的搜尋找的是全市場。點一檔看扣抵值、K 線、成交量和 KD。</p>' +
        `<p class="muted">${U.esc(Market.closeNote())}</p>`);
    }

    return { enrich, compare, tableHTML, cardHTML, introHTML };
  },
};



const DEDUCT_PLAN = (() => {
  const mmdd = d => U.esc(U.fmtDate(d).slice(5));
  const px = v => U.fmtNum(U.round(v, 2), 2);
  const TURN = { 1: ['up', '上彎'], '-1': ['down', '下彎'], 0: ['', '持平'] };
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;

  function dayName(last) {
    const t = U.today();
    const wd = new Date(`${t}T00:00:00`).getDay();
    return last < t && wd > 0 && wd < 6 ? '今天' : '下一個交易日';
  }

  const textOf = (code, typed) => typed ?? (Market.get(code) ? String(Market.get(code).close) : '');
  const assumed = (code, typed) => Deducts.assume(code, U.parseNum(textOf(code, typed)));


  function outHTML(code, typed) {
    const k = Deducts.get(code);
    const m = Market.get(code);
    const r = assumed(code, typed);
    const cls = r ? TURN[r.dir][0] : '';
    const before = k.prevDir === null ? '' : `，${TURN[k.prevDir][1]}`;
    const week = r ? `；週線 ${px(r.ma5)}，${TURN[r.dir5][1]}` : '';

    const chg = r ? (Math.abs(r.chg) >= 100 ? U.round(r.chg, 2) : r.chg) : 0;
    return `
      <span class="card-grid">
        ${cell(`扣抵值 ${mmdd(k.deducts[0].date)}`, U.fmtNum(k.deducts[0].close), cls)}
        ${cell('月線', r ? px(r.ma) : '—', 'strong')}
        ${cell('變化', r ? `${chg > 0 ? '+' : ''}${U.fmtNum(chg, 2)}<small>${TURN[r.dir][1]}</small>` : '—', `strong ${cls}`)}
      </span>
      <span class="card-note">前一天${m ? `（${mmdd(m.date)}）` : ''}的月線 ${px(k.prev)}${before}${week}</span>`;
  }

  function cardHTML(code, typed) {
    const k = Deducts.get(code);
    if (!k) return `<p class="card-note">${U.esc(Deducts.waiting() || '沒有這檔的扣抵資料')}</p>`;
    if (k.ma === undefined) return `<p class="card-note">只有 ${k.days} 天有成交，還算不出月線</p>`;
    const m = Market.get(code);
    return `
      <label class="ma-price"><span>${dayName(m?.date || '')}的價格</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${U.esc(textOf(code, typed))}" data-ma></label>
      <div class="ma-out">${outHTML(code, typed)}</div>`;
  }


  function dash(code, typed) {
    const k = Deducts.get(code);
    if (!k?.b) return null;
    const r = assumed(code, typed);
    return { from: k.deducts[0].date, price: r ? r.price : null, proj: r ? r.proj : [], proj5: r ? r.proj5 : [], deducts: k.deducts };
  }

  return {
    cardHTML, outHTML, dash, slots: 5,
    note: '<p>上面可以自己打價格，右邊的虛線是價格一直是這個數字時，月線、週線接下來 5 天會怎麼走。</p>' +
      '<p>點虛線那 5 格，上面寫第幾天的月線、週線和那天要扣的收盤價。</p>' +
      '<p>最左邊有底色的 5 天是接下來要扣掉的。</p>',
  };
})();
