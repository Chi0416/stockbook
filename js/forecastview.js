







const FORECAST_VIEW = {
  noIndex: true,
  sorts: [['fy', '預估殖利高在前'], ['cash', '預估配高的在前'], ['y', '目前殖利高在前'], ['code', '依代號']],
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面搜尋全市場',
  make({ tagsHTML, state }) {
    const px = v => U.fmtNum(U.round(v, 2), 2);
    const pct = v => (v === null || v === undefined ? '—' : `${U.fmtNum(v, 2)}%`);
    const num = v => (v === null || v === undefined ? '—' : U.fmtNum(U.round(v, 2), 2));

    function enrich(r) {
      const m = Market.get(r.code);
      return { ...r, close: m ? m.close : null, date: m ? m.date : '', fc: Forecasts.get(r.code), now: Yields.get(r.code) };
    }

    function vs(r) {
      if (typeof r.fc?.cash !== 'number' || !r.now?.count || typeof r.now.sum !== 'number') return '';
      const d = U.round(r.fc.cash, 2) - U.round(r.now.sum, 2);
      return d > 0 ? ' up' : d < 0 ? ' down' : '';
    }

    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

    const high = k => (a, b) => (b.fc?.[k] ?? -1) - (a.fc?.[k] ?? -1) || byCode(a, b);
    const compare = { fy: high('fy'), cash: high('cash'), y: (a, b) => (b.now?.y ?? -1) - (a.now?.y ?? -1) || byCode(a, b), code: byCode };


    function reason(r) {
      if (!Forecasts.ready()) return '';
      if (!r.fc) return '沒有 EPS';
      if (r.fc.unknown) return '估不出來';
      return r.fc.decided ? '已決議' : '';
    }

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'code' ? 'asc' : 'desc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['收盤價'] },
        { label: ['預估殖利', '預估配'], sort: 'fy', dir: dir('fy') },
        { label: ['目前殖利', '近一年配'], sort: 'y', dir: dir('y') },
      ];
      return Table.html(cols, rows.map(r => {
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(U.fmtDate(r.date).slice(5))}</small>` : '';
        const decided = Forecasts.ready() && r.fc?.decided ? ' <span class="badge q-new">已決議</span>' : '';
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search) + decided),
            Table.cell(r.close === null ? '—' : `${stale}${px(r.close)}`),
            Table.cell(pct(r.fc?.fy), num(r.fc?.cash), `strong fc-now${vs(r)}`),
            Table.cell(pct(r.now?.y), r.now?.count ? num(r.now.sum) : '—'),
          ],
        });
      }));
    }

    function cardHTML(r, search) {
      const cell = (label, v) => `<span class="cell"><small>${label}</small><span>${v}</span></span>`;
      const tags = tagsHTML(r, search);
      const why = Forecasts.waiting() || reason(r);
      return `
      <div class="card yield-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>${r.fc?.decided ? '殖利率' : '預估殖利率'}</small><b class="yield-pct${vs(r)}">${pct(r.fc?.fy)}</b></span>
        </span>
        <span class="card-grid">
          ${cell('收盤價', r.close === null ? '—' : px(r.close))}
          ${cell(r.fc?.decided ? '已決議每股配' : '預估每股配', r.fc?.cash === null || !r.fc ? '—' : `${num(r.fc.cash)} 元`)}
          ${cell('近一年每股', r.now?.count ? `${num(r.now.sum)} 元` : '—')}
          ${cell('目前殖利率', pct(r.now?.y))}
        </span>
        ${why ? `<span class="card-note">${U.esc(why)}</span>` : ''}
      </div>`;
    }


    function introHTML() {
      return Note.line(U.esc(Forecasts.waiting() || Market.closeLine()), '股利預估怎麼看',
        '<p><b>預估配</b>是用公司今年的獲利和過去的配息習慣，估算今年賺的錢每股會配多少現金；<b>預估殖利率</b>是這個金額對收盤價的比例。只是估算，不代表公司真的會配這麼多。</p>' +
        '<p>左邊那一欄是估的，右邊那一欄是實際公告的：目前的殖利率、近一年配了多少，左右對照。預估配的比近一年多是紅色，少是綠色。</p>' +
        '<p>代號後面標「已決議」的，是今年賺的股利公司都決議了，寫的是決議的金額，不是估的。預估那一欄是 — 的：資料不夠、過去配的和賺的差太多，或是 ETF、興櫃沒有 EPS。</p>' +
        '<p>預估殖利率特別高時，多半是今年有一次性的收入，參考就好。</p>' +
        '<p>清單是設定裡勾的成員的庫存加上自選，上面的搜尋找的是全市場。點表頭換排序。點一檔看 EPS、股利預估、殖利率和歷史股利。</p>' +
        `<p class="muted">${U.esc(Market.closeNote())}</p>`);
    }

    return { enrich, compare, tableHTML, cardHTML, introHTML };
  },
};
