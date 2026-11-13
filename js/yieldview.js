







const YIELD_VIEW = {
  noIndex: true,
  sorts: [['yield', '殖利率高的在前'], ['annual', '暴力年化高的在前'], ['code', '依代號']],
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面搜尋全市場',
  make({ tagsHTML, state }) {
    const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
    const px = v => U.fmtNum(U.round(v, 2), 2);
    const pct = v => (v === null || v === undefined ? '—' : `${U.fmtNum(v, 2)}%`);
    const tone = i => (!i || i.ya === null ? '' : i.trend > 0 ? 'up' : i.trend < 0 ? 'down' : '');

    function enrich(r) {
      const m = Market.get(r.code);
      return { ...r, close: m ? m.close : null, date: m ? m.date : '', info: Yields.get(r.code) };
    }

    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

    const high = k => (a, b) => (b.info?.[k] ?? -1) - (a.info?.[k] ?? -1) || byCode(a, b);
    const compare = { yield: high('y'), annual: high('ya'), code: byCode };


    function reason(info) {
      if (!Yields.ready()) return '';
      if (!info) return '沒有公告';
      if (!info.count) return '沒配息';
      return info.short ? `只配 ${info.count} 次` : '';
    }

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'code' ? 'asc' : 'desc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['收盤價', '近一年'] },
        { label: ['殖利率'], sort: 'yield', dir: dir('yield') },
        { label: ['暴力', '年化'], sort: 'annual', dir: dir('annual') },
      ];
      return Table.html(cols, rows.map(r => {
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(U.fmtDate(r.date).slice(5))}</small>` : '';
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search)),
            Table.cell(r.close === null ? '—' : `${stale}${px(r.close)}`, r.info?.count ? U.fmtNum(r.info.sum) : '—'),
            Table.cell(pct(r.info?.y), reason(r.info), 'strong'),
            Table.cell(pct(r.info?.ya), '', `strong ${tone(r.info)}`),
          ],
        });
      }));
    }


    function notes({ code, info }) {
      if (!Yields.ready()) return [Yields.waiting()];
      if (!info) return ['公告資料裡沒有這檔（上櫃 ETF、興櫃沒有資料）'];
      const today = U.today();
      const list = Events.list(code, []);
      const last = list.find(x => x.exDate <= today && typeof x.cash === 'number');
      const next = list.filter(x => x.exDate > today).at(-1);
      const out = [];
      if (!info.count) out.push('近一年沒有配息');
      else if (info.short) out.push(`近一年只有 ${info.count} 次配息，殖利率會偏低（剛上市的常這樣）`);
      if (last) out.push(`最近一次 ${md(last.exDate)} 除息 ${U.fmtNum(last.cash)} 元`);
      if (next) out.push(`下次 ${md(next.exDate)} 除息${typeof next.cash === 'number' ? ` ${U.fmtNum(next.cash)} 元` : '（金額待公告）'}`);
      return out;
    }

    function cardHTML(r, search) {
      const { info } = r;
      const cell = (label, v, cls = '') => `<span class="cell${cls}"><small>${label}</small><span>${v}</span></span>`;
      const t = tone(info);
      const tags = tagsHTML(r, search);
      return `
      <div class="card yield-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>殖利率</small><b class="yield-pct">${pct(info?.y)}</b></span>
        </span>
        <span class="card-grid">
          ${cell('收盤價', r.close === null ? '—' : px(r.close))}
          ${cell('近一年每股', info?.count ? `${U.fmtNum(info.sum)} 元` : '—')}
          ${cell('配息', info ? info.freq : '—')}
          ${cell('暴力年化', pct(info?.ya), ` strong${t ? ` ${t}` : ''}`)}
        </span>
        ${notes(r).map(n => `<span class="card-note">${U.esc(n)}</span>`).join('')}
      </div>`;
    }


    function introHTML() {
      const updated = Yields.updated();
      const line = Yields.waiting() || [Market.closeLine(), updated ? `除權息 ${md(updated)} 更新` : ''].filter(Boolean).join('・');
      return Note.line(U.esc(line), '殖利率怎麼看',
        '<p><b>殖利率</b> = 近一年每股現金股利 ÷ 收盤價，只算公告的除權息，不算自己記的。</p>' +
        '<p><b>暴力年化</b>：紅色是最近一次配得比近一年平均多，綠色是比較少。</p>' +
        '<p>「沒有公告」是公告資料裡沒有這檔（上櫃 ETF、興櫃）；「只配 N 次」是近一年配的次數比一年該配的少，殖利率會偏低，剛上市的常這樣。</p>' +
        '<p>清單是設定裡勾的成員的庫存加上自選，上面的搜尋找的是全市場。點一檔看除權息和歷史股利。</p>' +
        `<p class="muted">${U.esc(Market.closeNote())}</p>`);
    }

    return { enrich, compare, tableHTML, cardHTML, introHTML };
  },
};
