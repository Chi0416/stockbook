








const VOLPRICE = (() => {
  const px = v => U.fmtNum(U.round(v, 2), 2);
  const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${U.fmtNum(Math.abs(v), 2)}%`;
  const ZONES = ['下軌以下', '下軌 – 中軌', '中軌 – 上軌', '上軌以上'];
  const MACD = { 2: ['up', '金叉', '黃金交叉'], 1: ['near', '接近', '接近黃金交叉'] };

  const at = (v, p) => `${U.round(Math.min(1, Math.max(0, (p - v.min) / (v.max - v.min))) * 100, 1)}%`;

  function barHTML(v, close, cls = '') {
    const band = `left:${at(v, v.low)};right:calc(100% - ${at(v, v.high)})`;
    const dot = close === null ? '' : `<i class="vp-dot ${close >= v.poc ? 'high' : 'low'}" style="left:${at(v, close)}"></i>`;
    const edge = p => `<i class="vp-edge" style="left:${at(v, p)}"></i>`;
    return `<span class="vp-bar${cls ? ` ${cls}` : ''}"><i class="vp-band" style="${band}"></i>${edge(v.low)}<i class="vp-poc" style="left:${at(v, v.poc)}"></i>${edge(v.high)}${dot}</span>`;
  }





  const pair = (label, value) => `<span>${label}<b>${value}</b></span>`;
  function descHTML(v, close) {
    const vp = v.low === null ? '<span class="vp-line">有成交的日子太少，還算不出成交量分布</span>' : `
      ${barHTML(v, close, 'wide')}
      <span class="vp-rails">${pair('下軌', px(v.low))}<span class="poc">中軌 POC<b>${px(v.poc)}</b></span>${pair('上軌', px(v.high))}</span>
      <span class="vp-line">${pair('位置：', ZONES[v.zone])}${pair('距中軌', signed(v.gpoc))}${pair('距上軌', signed(v.ghigh))}</span>`;
    const state = v.dif === null ? '' : v.macd === 2 ? '<b class="hit">黃金交叉</b>' : v.macd === 1 ? '<b class="near">接近交叉</b>'
      : `<b>MACD ${v.osc > 0 ? '&gt;' : v.osc < 0 ? '&lt;' : '='} 訊號線</b>`;
    const macd = `<span class="vp-line"><span>MACD：${state || '<b>有成交的日子太少，還算不出來</b>'}</span></span>`;
    const n = VolPrices.window() ? `${VolPrices.window()} 天` : '';
    const tags = [v.hl === 1 ? `<span class="badge vp-high">${n}新高</span>` : v.hl === -1 ? `<span class="badge vp-low">${n}新低</span>` : '',
      v.vp ? '<span class="badge vp-hit">VPVR 下軌 → 中軌回升</span>' : '',
      v.macd === 2 ? '<span class="badge vp-hit">MACD 黃金交叉</span>' : v.macd === 1 ? '<span class="badge vp-near">MACD 接近黃金交叉</span>' : ''].join('');
    return `${vp}${macd}${tags ? `<span class="vp-tags">${tags}</span>` : ''}`;
  }
  return { px, signed, ZONES, MACD, barHTML, descHTML };
})();

const VOLPRICE_VIEW = {
  sorts: [['sig', '有訊號的在前'], ['gap', '距中軌低到高'], ['gapDesc', '距中軌高到低'], ['code', '依代號']],
  flip: { gap: 'gapDesc' },

  shows() {
    const n = VolPrices.window();
    const [hi, lo] = n ? [`${n}天新高`, `${n}天新低`] : ['新高', '新低'];
    return [['all', '全部'], ['cross', '黃金交叉'], ['near', '接近交叉'], ['up', '回升'], ['hi', hi], ['lo', lo],
      ['m-cross', '全市場黃金交叉'], ['m-near', '全市場接近交叉'], ['m-up', '全市場回升'], ['m-hi', `全市場${hi}`], ['m-lo', `全市場${lo}`]];
  },
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面選「全市場」、搜尋全市場',
  make({ tagsHTML, state }) {
    const { px, signed, ZONES, MACD, barHTML, descHTML } = VOLPRICE;
    const md = d => U.fmtDate(d).slice(5);

    function enrich(r) {
      const m = Market.get(r.code);
      const v = VolPrices.get(r.code);

      const rank = !v ? 0 : v.macd === 2 ? (v.vp ? 4 : 3) : v.vp ? 2 : v.macd === 1 ? 1 : 0;
      return { ...r, v, rank, gap: v?.gpoc ?? null, close: m ? m.close : null, date: m ? m.date : '' };
    }

    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const byGap = dir => (a, b) => (a.gap === null) - (b.gap === null) || (a.gap === null ? 0 : (a.gap - b.gap) * dir) || byCode(a, b);
    const compare = { sig: (a, b) => b.rank - a.rank || !a.v - !b.v || byCode(a, b), gap: byGap(1), gapDesc: byGap(-1), code: byCode };


    function show(value) {
      const keep = {
        cross: r => r.v?.macd === 2,
        near: r => r.v?.macd === 1,
        up: r => r.v?.vp === 1,
        hi: r => r.v?.hl === 1,
        lo: r => r.v?.hl === -1,
      }[value.replace('m-', '')] || null;
      return { market: value.startsWith('m-'), keep };
    }
    const noneText = () => U.esc(VolPrices.waiting() || Market.waiting() || '目前沒有符合的股票');


    function barCell(r) {
      if (r.v?.low === null || (!r.v && VolPrices.ready())) return Table.cell('—');
      if (!r.v) return '<span class="tcell vp-cell"><span class="vp-bar"></span><small>&nbsp;</small></span>';
      return `<span class="tcell vp-cell">${barHTML(r.v, r.close)}<small>${ZONES[r.v.zone]}</small></span>`;
    }
    function signalCell(r) {
      const m = MACD[r.v?.macd];
      const up = r.v?.vp ? '<span class="up">回升</span>' : '';
      if (!m && !up) return Table.cell('—');
      return Table.cell(m ? `<span class="${m[0]}">${m[1]}</span>` : '—', up, 'strong');
    }

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'gapDesc' || s === 'sig' ? 'desc' : 'asc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['位置'] },
        { label: ['收盤價', '距中軌'], sort: 'gap', dir: dir('gap') || dir('gapDesc') },
        { label: ['MACD', '回升'], sort: 'sig', dir: dir('sig') },
      ];
      return Table.html(cols, rows.map(r => {
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(md(r.date))}</small>` : '';
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search)),
            barCell(r),
            Table.cell(r.close === null ? '—' : `${stale}${px(r.close)}`, r.gap === null ? '—' : signed(r.gap)),
            signalCell(r),
          ],
        });
      }));
    }

    function cardHTML(r, search) {
      const { v } = r;
      const tags = tagsHTML(r, search);
      return `
      <div class="card vp-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>收盤價</small><b>${r.close === null ? '—' : px(r.close)}</b></span>
        </span>
        <span class="vp-out">${v ? descHTML(v, r.close) : `<span class="vp-line">${U.esc(VolPrices.waiting() || '沒有這檔的量價資料')}</span>`}</span>
      </div>`;
    }


    function introHTML() {
      return Note.line(U.esc(VolPrices.waiting() || Market.closeLine()), '量價怎麼看',
        '<p><b>位置</b>那條橫條是最近一季的成交量堆在哪些價位：有底色的那一段是成交最集中的區間，左邊緣是<b>下軌</b>、右邊緣是<b>上軌</b>，中間那一條是成交量最多的價位（<b>中軌</b>）；圓點是收盤價，在中軌以上紅色、以下綠色。</p>' +
        '<p><b>距中軌</b>是收盤價比中軌高或低幾 %。<b>回升</b>是前幾天收盤跌破下軌、現在站回下軌之上。</p>' +
        '<p><b>MACD</b>：金叉（紅）是今天剛站上訊號線；接近是還在訊號線下面，但差距一天比一天小、快要交叉。</p>' +
        '<p>只有日線資料，成交量分布是估算的，和看盤軟體用每一筆成交算的會差一點；剛除權息、分割的股票也會失真。這些只是把數字整理出來，不是買賣建議。</p>' +
        '<p><b>新高、新低</b>是最近一個交易日盤中碰到這段日子的最高、最低價，圓點會在橫條的最右邊、最左邊。沒有還原除權息，除息那天可能算成新低；和到價通知的新高、新低看的天數不一樣。</p>' +
        '<p>上面的選單可以只看黃金交叉、接近交叉、回升、新高、新低；沒寫全市場的是設定裡勾的成員的庫存加上自選。點表頭換排序。點一檔看三條軌的價位、距上軌幾 %、MACD 和 K 線。</p>' +
        `<p class="muted">${U.esc(Market.closeNote())}</p>`);
    }

    return { enrich, compare, show, noneText, tableHTML, cardHTML, introHTML };
  },
};


const VOLPRICE_PLAN = (() => {
  function cardHTML(code) {
    const v = VolPrices.get(code);
    if (!v) return `<p class="card-note">${U.esc(VolPrices.waiting() || '沒有這檔的量價資料')}</p>`;
    const m = Market.get(code);
    return `<div class="vp-out">${VOLPRICE.descHTML(v, m ? m.close : null)}</div>`;
  }


  const title = () => (VolPrices.window() ? `量價（${VolPrices.window()} 天）` : '量價');

  return {
    cardHTML, title, need: () => VolPrices.need(),

    has: code => !!VolPrices.get(code) || !!VolPrices.waiting(),
    note: '<p>橫條是這段日子成交量集中的區間：兩條灰線是下軌和上軌，橘色那條是成交量最多的價位（中軌 POC），圓點是收盤價；橫條的最左邊、最右邊是這段日子的最低價和最高價。</p>' +
      '<p>下軌、上軌不是最低價、最高價：成交量最集中的那一段才算在裡面，兩邊量少的價位在外面。</p>' +
      '<p>只有日線資料，是估算的，和看盤軟體用每一筆成交算的會差一點。</p>',
  };
})();
