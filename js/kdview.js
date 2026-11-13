






const KD_VIEW = {
  sorts: [['low', 'K 值低到高'], ['high', 'K 值高到低'], ['code', '依代號']],
  flip: { low: 'high' },
  shows: [['all', '全部'], ['low', '低檔'], ['high', '高檔'], ['golden', '金叉'], ['dead', '死叉'],
    ['m-low', '全市場低檔'], ['m-high', '全市場高檔'], ['m-golden', '全市場金叉'], ['m-dead', '全市場死叉']],
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面選「全市場」、搜尋全市場',
  make({ tagsHTML, state }) {
    const md = d => U.fmtDate(d).slice(5);
    const px = v => U.fmtNum(U.round(v, 2), 2);
    const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
    const ZONE = { low: ['sell', '低檔'], high: ['buy', '高檔'] };
    const CROSS = { golden: ['up', '金叉'], dead: ['down', '死叉'] };
    const AT = { low: '低檔', mid: '中間', high: '高檔' };
    const zoned = v => `<span class="${KD.zone(v)}">${fmt(v)}</span>`;


    function kdOf(code) {
      const raw = Candles.raw(code);
      const out = { k: null, d: null, pk: null, pd: null };
      if (!raw) return out;
      const bars = raw.row.filter(Array.isArray);
      if (typeof bars[0]?.[5] === 'number') [out.k, out.d] = [bars[0][5], bars[0][6]];
      if (typeof bars[1]?.[5] === 'number') [out.pk, out.pd] = [bars[1][5], bars[1][6]];
      return out;
    }

    function enrich(r) {
      const m = Market.get(r.code);
      const kd = kdOf(r.code);
      return { ...r, ...kd, close: m ? m.close : null, date: m ? m.date : '', cross: KD.cross(kd), at: KD.crossAt(kd) };
    }

    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const byK = dir => (a, b) => (a.k === null) - (b.k === null) || (a.k === null ? 0 : (a.k - b.k) * dir) || byCode(a, b);
    const compare = { low: byK(1), high: byK(-1), code: byCode };


    function show(value) {
      const kind = value.replace('m-', '');
      const keep = {
        low: r => KD.zone(r.k) === 'low',
        high: r => KD.zone(r.k) === 'high',
        golden: r => r.cross === 'golden',
        dead: r => r.cross === 'dead',
      }[kind] || null;
      return { market: value.startsWith('m-'), keep };
    }

    const noneText = () => U.esc(Candles.waiting() || Market.waiting() || '目前沒有符合的股票');

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'high' ? 'desc' : 'asc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['收盤價'] },
        { label: ['K', 'D'], sort: 'low', dir: dir('low') || dir('high') },
        { label: ['交叉'] },
      ];
      return Table.html(cols, rows.map(r => {
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(md(r.date))}</small>` : '';
        const c = CROSS[r.cross];
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search)),
            Table.cell(r.close === null ? '—' : `${stale}${px(r.close)}`),
            r.k === null ? Table.cell('—', Candles.ready() ? '不到 9 天' : '') : Table.cell(zoned(r.k), zoned(r.d), 'strong'),
            c ? Table.cell(c[1], AT[r.at], `strong ${c[0]}`) : Table.cell('—'),
          ],
        });
      }));
    }

    function cardHTML(r, search) {
      const kz = KD.zone(r.k);
      const c = CROSS[r.cross];
      const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
      const tags = [tagsHTML(r, search), kz ? `<span class="badge ${ZONE[kz][0]}">${ZONE[kz][1]}</span>` : ''].join('');
      const prev = typeof r.pk === 'number' ? `前一個交易日 K ${fmt(r.pk)}、D ${fmt(r.pd)}` : '';
      const note = r.k === null ? (Candles.waiting() || '成交不到 9 天，還算不出 KD') : prev;
      return `
      <div class="card kd-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>K 值</small><b class="kd-k ${kz}">${fmt(r.k)}</b></span>
        </span>
        <span class="card-grid">
          ${cell('收盤價', r.close === null ? '—' : px(r.close))}
          ${cell('D 值', fmt(r.d), KD.zone(r.d))}
          ${cell('交叉', c ? `${c[1]}<small>${AT[r.at]}</small>` : '—', c ? `strong ${c[0]}` : '')}
        </span>
        ${note ? `<span class="card-note">${U.esc(note)}</span>` : ''}
      </div>`;
    }


    function introHTML() {
      return Note.line(U.esc(Candles.waiting() || `${Market.closeLine()}・K 低於 ${KD.low} 綠、高於 ${KD.high} 紅`), 'KD 怎麼看',
        `<p>日 KD（9 日）：K 值低於 ${KD.low} 是綠色、高於 ${KD.high} 是紅色` +
        '（<button type="button" class="link-btn" data-act="kd-marks">調整</button>）。</p>' +
        '<p>金叉（紅）是 K 由下往上穿過 D，死叉（綠）是由上往下，下面的小字是在低檔、中間還是高檔交叉。</p>' +
        '<p>上面的選單可以只看低檔、高檔、金叉、死叉；沒寫全市場的是設定裡勾的成員的庫存加上自選。點表頭換排序。</p>' +
        `<p class="muted">${U.esc(Market.closeNote())}</p>`);
    }

    return { enrich, compare, show, noneText, tableHTML, cardHTML, introHTML };
  },
};
