







const PATTERN = (() => {
  const px = v => U.fmtNum(U.round(v, 2), 2);
  const KIND = { sym: '對稱三角', asc: '上升三角', desc: '下降三角' };
  const MOVE = { up: '突破', down: '跌破' };
  const TREND = {
    D: { name: '下降趨勢線', trend: '下降中', break: '剛突破', base: '突破後整理', color: 'var(--pat-down)' },
    U: { name: '上升趨勢線', trend: '上升中', break: '剛跌破', base: '跌破後整理', color: 'var(--pat-up)' },
  };
  const UNIT = { d: '天', w: '週' };
  const state = { frame: 'd', card: 'd' };



  function items(f) {
    if (!f) return [];
    const out = [];
    const b = f.box;
    if (b) {
      const conv = !!(b.conv || b.tri);
      out.push({
        type: 'box', x: b, conv, len: b.len, a: b.top, b: b.bot,
        rank: b.status !== 'in' ? 5 : conv ? 3 : 2,
        label: b.status !== 'in' ? `箱型${MOVE[b.status]}` : conv ? '收斂中' : b.proto ? '雛形箱' : '箱型',
        tone: b.status === 'up' ? 'up' : b.status === 'down' ? 'down' : '',
      });
    }
    const t = f.tri;
    if (t) {
      out.push({
        type: 'tri', x: t, len: t.len, a: t.upper[3], b: t.lower[3],
        rank: t.status !== 'in' ? 5 : 2,
        label: `${KIND[t.kind]}${t.status !== 'in' ? MOVE[t.status] : ''}`,
        tone: t.status === 'up' ? 'up' : t.status === 'down' ? 'down' : '',
      });
    }
    ['D', 'U'].forEach(d => {
      const l = f[d];
      if (!l) return;
      out.push({
        type: d, x: l, len: l.len, a: l.line[3],
        rank: l.status === 'break' ? 5 : l.status === 'base' ? 4 : 1,
        label: l.status === 'trend' ? TREND[d].trend : l.status === 'base' ? TREND[d].base : d === 'D' ? '突破下降線' : '跌破上升線',
        tone: l.status === 'trend' ? '' : d === 'D' ? 'up' : 'down',
      });
    });
    return out;
  }

  const FILTER = {
    all: () => true, box: i => i.type === 'box', conv: i => i.type === 'box' && i.conv, tri: i => i.type === 'tri',
    D: i => i.type === 'D', U: i => i.type === 'U', brk: i => i.rank === 5,
  };
  const best = (f, filter) => items(f).filter(FILTER[filter] || FILTER.all).sort((x, y) => y.rank - x.rank || y.len - x.len)[0] || null;


  const W = 1000, H = 360, PAD = 10;
  function chartHTML(bars, f, ma) {
    const n = bars.length;
    const lines = [...['D', 'U'].flatMap(d => [f[d], ...(f[d + 'x'] || [])].filter(Boolean).map(l => ({ d, l })))];
    let hi = Math.max(...bars.map(b => b.high)), lo = Math.min(...bars.map(b => b.low));
    const fit = v => { if (typeof v === 'number') { hi = Math.max(hi, v); lo = Math.min(lo, v); } };
    (ma || []).forEach(fit);
    if (f.tri) [f.tri.upper[1], f.tri.upper[3], f.tri.lower[1], f.tri.lower[3]].forEach(fit);
    if (f.box?.tri) [f.box.tri.upper[1], f.box.tri.upper[3], f.box.tri.lower[1], f.box.tri.lower[3]].forEach(fit);
    lines.forEach(({ l }) => [l.line[1], l.line[3]].forEach(fit));
    const slot = W / n, x = i => slot * (i + 0.5), y = v => PAD + (hi - v) / (hi - lo || 1) * (H - PAD * 2);
    const ve = 'vector-effect="non-scaling-stroke"';
    const seg = (l, attrs) => `<line x1="${x(l[0])}" y1="${y(l[1])}" x2="${x(l[2])}" y2="${y(l[3])}" ${attrs} ${ve}/>`;
    const rect = (b, cls) => `<rect class="${cls}" x="${x(b.from) - slot / 2}" y="${y(b.top)}" width="${slot * (b.to - b.from + 1)}" height="${Math.max(1, y(b.bot) - y(b.top))}" ${ve}/>`;
    let svg = [0.25, 0.5, 0.75].map(r => `<line class="pat-grid" x1="0" x2="${W}" y1="${PAD + r * (H - PAD * 2)}" y2="${PAD + r * (H - PAD * 2)}" ${ve}/>`).join('');
    if (f.box) svg += rect(f.box, `pat-box${f.box.proto ? ' proto' : ''}`);
    bars.forEach((b, i) => {
      const cls = b.close >= b.open ? 'up' : 'down';
      svg += `<line class="pat-wick ${cls}" x1="${x(i)}" x2="${x(i)}" y1="${y(b.high)}" y2="${y(b.low)}" ${ve}/>`;
      svg += `<rect class="pat-body ${cls}" x="${x(i) - slot * 0.32}" y="${y(Math.max(b.open, b.close))}" width="${slot * 0.64}" height="${Math.max(2, Math.abs(y(b.open) - y(b.close)))}"/>`;
    });
    if (ma) {
      const pts = ma.map((v, i) => (v === null ? '' : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
      if (pts) svg += `<polyline class="pat-ma" points="${pts}" ${ve}/>`;
    }
    if (f.tri) svg += seg(f.tri.upper, 'class="pat-tri"') + seg(f.tri.lower, 'class="pat-tri"');
    if (f.box?.tri) svg += seg(f.box.tri.upper, 'class="pat-tri"') + seg(f.box.tri.lower, 'class="pat-tri"');
    lines.forEach(({ d, l }) => {
      svg += seg(l.line, `class="pat-trend ${d}${l.weak ? ' weak' : ''}"`);
      if (l.box) svg += rect(l.box, `pat-base ${d}`);
    });
    const md = d => U.fmtDate(d).slice(5);
    return `<div class="pat-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>
      <span class="pat-hi">${px(hi)}</span><span class="pat-lo">${px(lo)}</span></div>
      <div class="pat-axis"><span>${md(bars[0].date)}</span><span>${md(bars[Math.floor(n / 2)].date)}</span><span>${md(bars[n - 1].date)}</span></div>`;
  }


  function descHTML(f, frame) {
    const unit = UNIT[frame];
    const out = [];
    const b = f.box;
    if (b) {
      const name = b.proto ? '雛形箱' : '箱型';
      let t = `<b>${name}${b.status === 'in' ? '整理中' : MOVE[b.status]}</b>：箱頂 ${px(b.top)}、箱底 ${px(b.bot)}（寬 ${U.fmtNum(b.width, 2)}%），整理 ${b.len} ${unit}`;
      if (b.touches) t += `，碰箱頂 ${b.touches[0]} 次、箱底 ${b.touches[1]} 次`;
      if (b.proto) t += `；還不到 ${frame === 'd' ? '20 天' : '10 週'}，是趨勢線穿過以後的整理`;
      if (b.squeeze) t += `；寬度從 ${U.fmtNum(b.squeeze[0], 1)}% 收到 ${U.fmtNum(b.squeeze[1], 1)}%${b.conv ? '，<b class="hit">收斂中</b>' : ''}`;
      if (b.tri) t += `，箱子裡是${KIND[b.tri.kind]}`;
      out.push(t);
    }
    const tr = f.tri;
    if (tr) {
      const left = Math.max(0, Math.round(tr.apex - tr.upper[2]));
      out.push(`<b>${KIND[tr.kind]}${tr.status === 'in' ? '整理中' : MOVE[tr.status]}</b>：壓力線今天 ${px(tr.upper[3])}、支撐線今天 ${px(tr.lower[3])}，從 ${tr.len} ${unit}前開始，大約再 ${left} ${unit}交會`);
    }
    ['D', 'U'].forEach(d => [f[d], ...(f[d + 'x'] || [])].filter(Boolean).forEach(l => {
      const T = TREND[d];
      let t = `<b style="color:${T.color}">${T.name}${l.weak ? '（虛線）' : ''}</b> ${T[l.status]}：從 ${l.len} ${unit}前開始${d === 'D' ? '跌' : '漲'}了 ${U.fmtNum(l.move, 1)}%，線上碰到 ${l.touches} 次，線今天在 ${px(l.line[3])}`;
      if (l.status === 'trend') t += `，收盤離線 ${U.fmtNum(l.dist, 1)}%`;
      if (l.box) t += `；穿過以後 ${l.box.len} ${unit}在 ${px(l.box.bot)}～${px(l.box.top)} 之間`;
      out.push(t);
    }));
    return out.length ? out.map(t => `<span class="pat-line">${t}</span>`).join('') : `<span class="pat-line">${frame === 'd' ? '日線' : '週線'}沒有箱型、三角收斂、趨勢線</span>`;
  }

  const segHTML = (attr, value, labels, has = () => true) => `<div class="seg pat-seg">${Object.entries(labels).map(([v, label]) =>
    `<button type="button" ${attr}="${v}" aria-pressed="${v === value}"${has(v) ? '' : ' disabled'}>${label}</button>`).join('')}</div>`;

  return { px, KIND, MOVE, TREND, UNIT, state, items, best, chartHTML, descHTML, segHTML };
})();

const PATTERN_VIEW = {
  sorts: [['sig', '值得注意的在前'], ['len', '天數多的在前'], ['code', '依代號']],
  flip: {},
  shows: [['all', '全部'], ['box', '箱型'], ['conv', '收斂中'], ['tri', '三角收斂'], ['D', '下降趨勢線'], ['U', '上升趨勢線'], ['brk', '突破／跌破'],
    ['m-box', '全市場箱型'], ['m-conv', '全市場收斂中'], ['m-tri', '全市場三角收斂'], ['m-D', '全市場下降趨勢線'], ['m-U', '全市場上升趨勢線'], ['m-brk', '全市場突破／跌破']],
  empty: '還沒有持股和自選股<br>到「帳務」記一筆買進，或點右上角「新增自選」<br>也可以在上面選「全市場」、搜尋全市場',
  onFrame: null,

  frameEl() {
    const el = document.createElement('div');
    el.innerHTML = PATTERN.segHTML('data-pat-list', PATTERN.state.frame, { d: '日線（60 天）', w: '週線（41 週）' });
    return el.firstElementChild;
  },
  make({ tagsHTML, state }) {
    const { px, UNIT, best } = PATTERN;
    const md = d => U.fmtDate(d).slice(5);
    let filter = 'all';

    function enrich(r) {
      const m = Market.get(r.code);
      const it = best(Patterns.get(r.code)?.[PATTERN.state.frame], filter);
      return { ...r, it, rank: it ? it.rank : 0, len: it ? it.len : null, close: m ? m.close : null, date: m ? m.date : '' };
    }
    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const compare = {
      sig: (a, b) => b.rank - a.rank || (b.len ?? -1) - (a.len ?? -1) || byCode(a, b),
      len: (a, b) => (a.len === null) - (b.len === null) || (b.len ?? 0) - (a.len ?? 0) || byCode(a, b),
      code: byCode,
    };

    const sync = () => { filter = 'all'; };
    function show(value) {
      filter = value.replace('m-', '');
      return { market: value.startsWith('m-'), keep: filter === 'all' ? null : r => !!r.it };
    }
    const noneText = () => U.esc(Patterns.waiting() || Market.waiting() || '目前沒有符合的股票');

    function patCell(it) {
      if (!it) return Table.cell(Patterns.ready() ? '—' : '');

      const second = it.type === 'D' || it.type === 'U'
        ? (it.x.status === 'trend' ? `離線 ${U.fmtNum(it.x.dist, 1)}%` : it.x.box ? `${px(it.x.box.bot)}～${px(it.x.box.top)}` : `線 ${px(it.a)}`)
        : `${px(it.a)}／${px(it.b)}`;
      return Table.cell(`<span class="${it.tone}">${it.label}</span>`, second, 'strong');
    }

    function tableHTML(rows, search) {
      const dir = s => (state.sort === s ? (s === 'code' ? 'asc' : 'desc') : '');
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dir('code') },
        { label: ['收盤價'] },
        { label: ['形態', '上緣／下緣'], sort: 'sig', dir: dir('sig') },
        { label: ['天數'], sort: 'len', dir: dir('len') },
      ];
      const unit = UNIT[PATTERN.state.frame];
      return Table.html(cols, rows.map(r => {
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(md(r.date))}</small>` : '';
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search)),
            Table.cell(r.close === null ? '—' : `${stale}${px(r.close)}`),
            patCell(r.it),
            Table.cell(r.len === null ? '—' : `${r.len} ${unit}`),
          ],
        });
      }));
    }

    function cardHTML(r, search) {
      const tags = tagsHTML(r, search);
      const f = Patterns.get(r.code)?.[PATTERN.state.frame];
      return `
      <div class="card pat-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>收盤價</small><b>${r.close === null ? '—' : px(r.close)}</b></span>
        </span>
        <span class="pat-out">${f ? PATTERN.descHTML(f, PATTERN.state.frame) : `<span class="pat-line">${U.esc(Patterns.waiting() || '沒有這檔的形態')}</span>`}</span>
      </div>`;
    }


    function introHTML() {
      return Note.line(U.esc(Patterns.waiting() || Market.closeLine()), '形態怎麼看',
          '<p><b>箱型</b>：一段日子都在差不多的高低之間來回，上緣是箱頂、下緣是箱底。日線至少整理 20 天、週線 10 週，箱頂、箱底都碰過兩次以上；還不到這麼久、但趨勢線穿過以後在橫盤的叫<b>雛形箱</b>。</p>' +
          '<p><b>收斂中</b>：箱子裡最近幾天的高低差比剛開始窄了一半以上，或箱子裡收出一個三角形。</p>' +
          '<p><b>三角收斂</b>：高點一次比一次低、低點一次比一次高，兩條線往中間夾；上面平的是上升三角、下面平的是下降三角。</p>' +
          '<p><b>下降趨勢線</b>連反彈的高點、<b>上升趨勢線</b>連回檔的低點，線上至少碰到 3 次才列出來。下降中、上升中是還沒穿過線；剛突破、剛跌破是最近幾天收盤穿過線；突破後整理、跌破後整理是穿過以後在一個窄範圍裡橫著走。</p>' +
          '<p><b>上緣／下緣</b>：箱型是箱頂和箱底，三角是兩條線今天的價位，趨勢線是線今天的價位和收盤離線多遠。<b>天數</b>是整理了多久、線從多久以前開始（週線是週數）。</p>' +
          '<p>一檔有好幾種時，列表寫最值得注意的那一種：剛突破跌破、穿過後整理、收斂中、箱型和三角，最後才是還在趨勢裡的。點一檔看圖：只碰到兩次的趨勢線畫成虛線，只是參考。</p>' +
          '<p>只用每天的開高低收判斷，沒有還原除權息；這些只是把形態找出來，不是買賣建議。</p>' +
          `<p class="muted">${U.esc(Market.closeNote())}</p>`);
    }

    return { enrich, compare, sync, show, noneText, tableHTML, cardHTML, introHTML };
  },
};



const PATTERN_PLAN = (() => {
  const { state, segHTML, chartHTML, descHTML } = PATTERN;
  function inner(code) {
    const r = Patterns.get(code);
    if (!r) return `<p class="card-note">${U.esc(Patterns.waiting() || '沒有這檔的形態')}</p>`;
    const frame = r[state.card] ? state.card : r.d ? 'd' : 'w';
    const f = r[frame];
    const bars = Patterns.bars(code);
    const list = bars ? bars[frame] : null;
    const chart = list ? chartHTML(list, f, frame === 'w' ? bars.ma : null)
      : `<p class="card-note">${U.esc(Patterns.barsWaiting() || '沒有這檔的 K 線')}</p>`;
    const legend = frame === 'w' ? '<span class="pat-legend"><i class="ma"></i>20 週均線</span>' : '';
    return `${segHTML('data-pat-card', frame, { d: '日 K（60 天）', w: '週 K（41 週）' }, v => !!r[v])}${legend}${chart}
      <span class="pat-desc">${descHTML(f, frame)}</span>`;
  }
  return {
    title: () => '形態',
    need: () => { Patterns.need(); Patterns.needBars(); },
    has: code => !!Patterns.get(code) || !!Patterns.waiting(),
    cardHTML: code => `<div class="pat-out" data-pat-code="${U.esc(code)}">${inner(code)}</div>`,
    inner,
    note: '<p>橘色的框是箱型（虛線框是還不夠久的雛形箱），橘色的兩條線是三角收斂；紫色是下降趨勢線、青色是上升趨勢線，只碰到兩次的畫成虛線，只是參考；趨勢線穿過以後的整理範圍是同顏色的虛線框。週 K 的藍線是 20 週均線。</p>' +
      '<p>日 K 看最近 60 個有成交的日子，週 K 看最近 41 週（這週還沒過完的是到目前為止）。沒有還原除權息。</p>',
  };
})();


document.addEventListener('click', e => {
  const list = e.target.closest('[data-pat-list]');
  if (list) {
    PATTERN.state.frame = list.dataset.patList;
    list.parentElement.querySelectorAll('[data-pat-list]').forEach(b => b.setAttribute('aria-pressed', String(b === list)));
    PATTERN_VIEW.onFrame?.();
    return;
  }
  const card = e.target.closest('[data-pat-card]');
  if (card) {
    PATTERN.state.card = card.dataset.patCard;
    const out = card.closest('.pat-out');
    if (out) out.innerHTML = PATTERN_PLAN.inner(out.dataset.patCode);
  }
});
