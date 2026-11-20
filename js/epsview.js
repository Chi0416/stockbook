








const EPS_VIEW = {
  noIndex: true,
  sorts: [['ahead', '超前多的在前'], ['growth', '同期成長多在前'], ['at', '最近公布在前'], ['code', '依代號']],
  flip: {},
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面搜尋全市場',
  make({ tagsHTML, state }) {
    const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
    const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
    const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${U.fmtNum(Math.abs(Math.round(v)))}%`;
    const tone = v => (typeof v !== 'number' || v === 0 ? '' : v > 0 ? 'up' : 'down');

    const yearName = y => {
      const now = Number(U.today().slice(0, 4));
      return y === now ? '今年' : y === now - 1 ? '去年' : `${y} 年`;
    };
    const rank = e => e.year * 4 + e.q;

    let skipped = 0;
    const sync = () => { skipped = 0; };
    const enrich = r => ({ ...r, e: EpsDetails.get(r.code) });

    function keep(r) {
      if (!EpsDetails.ready() || r.e) return true;
      skipped += 1;
      return false;
    }

    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

    const high = f => (a, b) => {
      const x = f(a) ?? null;
      const y = f(b) ?? null;
      return (x === null) - (y === null) || (x === null ? 0 : y - x) || byCode(a, b);
    };
    const compare = {
      ahead: high(r => r.e?.ahead),
      growth: high(r => r.e?.growth),
      at: high(r => (r.e?.at ? Date.parse(r.e.at) : null)),
      code: byCode,
    };


    function qTagHTML(e) {
      const s = EpsDetails.season();
      if (!e || !s || rank(e) === rank(s)) return '';
      return ` <span class="badge ${rank(e) > rank(s) ? 'q-new' : 'q-old'}">${e.year === s.year ? '' : e.year}Q${e.q}</span>`;
    }

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'code' ? 'asc' : 'desc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['今年累計', '去年全年'] },
        { label: ['達成率', '進度'] },
        { label: ['超前', '同期'], sort: 'ahead', dir: dir('ahead') },
      ];
      return Table.html(cols, rows.map(({ e, ...r }) => Table.row({
        attrs: `data-code="${U.esc(r.code)}"`,
        cells: [
          Table.name(r.name, r.code, tagsHTML(r, search) + qTagHTML(e)),
          Table.cell(fmt(e?.now), fmt(e?.last)),
          Table.cell(e?.pct == null ? '—' : `${U.fmtNum(e.pct)}%`, e ? `${e.pace}%` : '—'),
          Table.cell(e?.ahead == null ? '—' : `<span class="${tone(e.ahead)}">${signed(e.ahead)}</span>`, e?.growth == null ? '—' : `<span class="${tone(e.growth)}">${signed(e.growth)}</span>`, 'strong eps-ahead'),
        ],
      })));
    }


    function noteOf(e) {
      if (!e) return EpsDetails.waiting();
      const prev = yearName(e.year - 1);
      if (e.last === null) return `沒有${prev}全年的 EPS，算不出達成率`;
      if (e.last <= 0) return `${prev}全年虧損，算不出達成率`;
      return e.low ? `${prev}全年只賺 ${fmt(e.last)}，基期很低，達成率容易很誇張，參考就好` : '';
    }

    function cardHTML({ e, ...r }, search) {
      const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
      const tags = tagsHTML(r, search) + qTagHTML(e);
      const t = tone(e?.ahead);
      const bar = e?.pct == null ? '' : `<span class="eps-bar ${t}" aria-hidden="true"><span class="eps-fill" style="width:${Math.max(0, Math.min(100, e.pct))}%"></span><span class="eps-pace" style="left:${e.pace}%"></span></span>`;
      const note = noteOf(e);
      return `
      <div class="card eps-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>達成率</small><b class="eps-pct ${t}">${e?.pct == null ? '—' : `${U.fmtNum(e.pct)}%`}</b></span>
        </span>
        ${bar}
        ${e ? `<span class="card-grid">
          ${cell(`${yearName(e.year)}到第 ${e.q} 季`, fmt(e.now))}
          ${cell(`${yearName(e.year - 1)}全年`, fmt(e.last))}
          ${cell('進度', `${e.pace}%`)}
          ${cell('超前', e.ahead == null ? '—' : signed(e.ahead), `strong ${t}`)}
        </span>` : ''}
        ${e && e.same !== null ? `<span class="card-note">${U.esc(`${yearName(e.year - 1)}同期 ${fmt(e.same)}`)}${e.growth == null ? '' : `，<span class="${tone(e.growth)}">${U.esc(`${yearName(e.year)}${e.growth >= 0 ? '多' : '少'} ${U.fmtNum(Math.abs(Math.round(e.growth)))}%`)}</span>`}</span>` : ''}
        ${note ? `<span class="card-note">${U.esc(note)}</span>` : ''}
      </div>`;
    }


    function introHTML() {
      const s = EpsDetails.season();
      const line = [];
      if (!EpsDetails.ready()) line.push(EpsDetails.waiting());
      else {
        if (s) {
          const nextName = s.q === 4 ? `${s.year + 1} 年第 1 季` : `第 ${s.q + 1} 季`;
          line.push(s.ahead ? `${nextName}財報已有 ${U.fmtNum(s.ahead)} 家` : `財報到 ${s.year} 年第 ${s.q} 季`);
        }
        if (EpsDetails.updated()) line.push(`${md(EpsDetails.updated())} 更新`);
        if (skipped && !state.keyword.trim()) line.push(`${skipped} 檔沒有 EPS`);
      }
      return Note.line(U.esc(line.join('・')), 'EPS 怎麼看',
        '<p><b>達成率</b>看今年到目前賺的是去年全年的幾成；<b>進度</b>是每過一季 25%。達成率比進度多就是<b>超前</b>（紅色，今年賺得比去年快），少就是落後（綠色）。</p>' +
        '<p><b>同期</b>是和去年累計到同一季比，多或少幾 %，比去年多紅色、少綠色；旺季在下半年的公司前幾季會一直落後，看這個分得出來。</p>' +
        '<p>財報季有些公司先公布下一季：代號後面標出到第幾季，先公布的粉紅底（例如 Q3），還沒公布的灰底（例如 Q2）；排序選「最近公布在前」看誰剛公布。</p>' +
        '<p>去年虧損、今年才上市的算不出達成率；去年賺很少的達成率會很誇張，參考就好。ETF、興櫃沒有 EPS，不列。</p>' +
        '<p>清單是設定裡勾的成員的庫存加上自選，上面的搜尋找的是全市場。點一檔看 EPS、股利預估、殖利率和歷史股利。</p>');
    }

    return { sync, enrich, keep, compare, tableHTML, cardHTML, introHTML };
  },
};
