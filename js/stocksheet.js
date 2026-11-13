





















const StockSheet = (() => {
  const dlg = document.getElementById('stock-sheet');

  if (!dlg) return { init() {}, open() {}, refresh() {}, bars: () => [], miniHTML: () => '' };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  const W = 1000;
  const H = 400;
  const VH = 90;
  const VTOP = 6;
  const BARS = 20;
  let code = null;
  let codes = [];
  let sel = null;
  let pts = [];
  let latest = 0;
  let hooks = { toast() {}, onChanged() {} };
  let menuFirst = false;
  let menuOpen = false;
  let plan = null;
  let more = null;
  let typed = null;

  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const f = v => Math.round(v * 10) / 10;
  const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;

  const ohlc = v => (v >= 10000 ? U.fmtNum(Math.round(v)) : U.fmtNum(U.round(v, 2), 2));
  const px = v => U.fmtNum(U.round(v, 2), 2);
  const toneOf = (a, b) => (typeof b !== 'number' || a === b ? 'flat' : a > b ? 'up' : 'down');
  const md = d => `${U.fmtDate(d).slice(5)} ${U.weekday(d)}`;
  const head = (title, note) => `<h3 class="section-head"><span class="sec-name">${title}</span>${Note.btn(title, note)}</h3>`;





  function bars(c = code) {
    const list = Candles.get(c);
    if (!list) return null;
    const avg = (i, n) => (i + n <= list.length ? list.slice(i, i + n).reduce((s, b) => s + b.close, 0) / n : null);
    const out = [];
    for (let i = 0; i < list.length && out.length < BARS; i++) {
      const b = list[i];
      if (b.open === null) break;
      const p = list[i + 1];
      out.push({ ...b, ma5: avg(i, 5), ma20: avg(i, 20), prev: p?.close ?? null, pk: p?.k ?? null, pd: p?.d ?? null });
    }
    return out.reverse();
  }


  function scale(vals, h) {
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.06;
    lo -= pad;
    hi += pad;
    return { lo, hi, y: v => h - (v - lo) / (hi - lo) * h };
  }
  const gridSVG = (grid, y) => grid.map(v => `<line class="kc-grid" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('');
  const tickHTML = (grid, y) => grid.map(v => `<span class="kc-tick" style="top:${pct(y(v), H)}">${U.fmtNum(v)}</span>`).join('');
  const lineSVG = (list, k, x, y, cls) => {
    const d = list.reduce((s, b, i) => (b[k] === null ? s : `${s}${s && list[i - 1]?.[k] != null ? 'L' : 'M'}${f(x(i))} ${f(y(b[k]))}`), '');
    return d ? `<path class="kc-ma${cls ? ` ${cls}` : ''}" d="${d}" vector-effect="non-scaling-stroke"/>` : '';
  };

  const axisHTML = (list, x, slot, dash) => `<span class="first" style="left:${pct(x(0) - slot * 0.31, W)}">${U.esc(U.fmtDate(list[0].date).slice(5))}</span>` +
    `<span class="last"${dash ? ` style="right:${pct(W - x(list.length - 1) - slot * 0.31, W)}"` : ''}>${U.esc(U.fmtDate(list.at(-1).date).slice(5))}</span>`;

  const dashSVG = (list, k, vals, x, y, cls) => {
    const n = list.length;
    const from = list[n - 1][k];
    if (from === null || !vals.length) return '';
    return `<path class="kc-ma${cls ? ` ${cls}` : ''} dash" d="M${f(x(n - 1))} ${f(y(from))}${vals.map((v, i) => `L${f(x(n + i))} ${f(y(v))}`).join('')}" vector-effect="non-scaling-stroke"/>`;
  };

  const candlesSVG = (list, x, y, bw, minH) => list.map((b, i) => {
    const tone = toneOf(b.close, b.open);
    const t = y(Math.max(b.open, b.close));
    const bh = Math.max(y(Math.min(b.open, b.close)) - t, minH);
    return `<line class="kc-wick ${tone}" x1="${f(x(i))}" x2="${f(x(i))}" y1="${f(y(b.high))}" y2="${f(y(b.low))}" vector-effect="non-scaling-stroke"/>` +
      `<rect class="kc-body ${tone}" x="${f(x(i) - bw / 2)}" y="${f(t)}" width="${f(bw)}" height="${f(bh)}"/>`;
  }).join('');


  function miniHTML(c, dash) {
    const list = bars(c);
    if (!list?.length) return '<span class="kc-mini"></span>';
    const w = 200;
    const h = 60;
    const slots = list.length + 5;
    const x = i => (i + 0.5) / slots * w;
    const proj = dash ? dash.proj : [];
    const { y } = scale([...list.flatMap(b => [b.high, b.low]), ...list.map(b => b.ma20).filter(v => v !== null), ...proj, ...(dash ? [dash.price] : [])], h);
    return `<svg class="kc-mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
      `${candlesSVG(list, x, y, w / slots * 0.62, 1)}${lineSVG(list, 'ma20', x, y, '')}${dashSVG(list, 'ma20', proj, x, y, '')}</svg>`;
  }

  const plotHTML = (chart, label, svg, ticks, axis, small = false) => `
    <div class="kc-read${chart === 'k' ? ' tx-two kc-ohlc' : ''}" aria-live="polite">${readOf(chart, cur())}</div>
    <div class="kc-plot tx-plot${small ? ' small' : ''}" tabindex="0" data-chart="${chart}" role="img" aria-label="${U.esc(label)}；左右鍵換日期">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>
      ${ticks}
      <span class="kc-mark">${markHTML(chart, cur())}</span>
    </div>
    <div class="kc-axis">${axis}</div>`;
  const cur = () => (sel !== null && sel < pts.length ? sel : latest);
  const readOf = (chart, i) => (chart === 'k' ? pts[i].k : pts[i].kd);

  function markHTML(chart, i) {
    const p = pts[i];
    const y = chart === 'k' ? p.ky : p.kdy;
    return `<span class="kc-cross" style="left:${pct(p.x, W)}"></span>` +
      (y === null ? '' : `<span class="kc-mdot${chart === 'kd' ? ' kd-dot' : ''}" style="left:${pct(p.x, W)};top:${pct(y, H)}"></span>`);
  }


  function kHTML(list, x, slot, dash) {
    const n = list.length;
    const top = H - VH;
    const { lo, hi, y } = scale([...list.flatMap(b => [b.high, b.low]), ...list.flatMap(b => [b.ma5, b.ma20]).filter(v => v !== null), ...(dash ? [...dash.proj, ...dash.proj5, ...(dash.price ? [dash.price] : [])] : [])], top);
    const bw = slot * 0.62;
    const grid = U.ticks(lo, hi).filter(v => y(v) > top * 0.08);
    const tone = b => toneOf(b.close, b.open);
    const candles = candlesSVG(list, x, y, bw, 2);
    const vmax = Math.max(1, ...list.map(b => b.vol || 0));
    const vy = v => H - v / vmax * (VH - VTOP);
    const vols = `<line class="kc-vbase" x1="0" x2="${W}" y1="${top}" y2="${top}" vector-effect="non-scaling-stroke"/>` +
      list.map((b, i) => (typeof b.vol !== 'number' ? '' :
        `<rect class="kc-vol ${tone(b)}" x="${f(x(i) - bw / 2)}" y="${f(vy(b.vol))}" width="${f(bw)}" height="${f(Math.max(H - vy(b.vol), b.vol ? 1 : 0))}"/>`)).join('');
    list.forEach((b, i) => {
      const t = typeof b.prev === 'number' && b.prev > 0 ? toneOf(b.close, b.prev).replace('flat', '') : '';
      pts[i].ky = b.ma20 === null ? null : y(b.ma20);
      pts[i].k = `<span class="kc-th">時</span><span class="kc-th">開</span><span class="kc-th">高</span><span class="kc-th">低</span><span class="kc-th">收</span><span class="kc-th">${U.isIndex(code) ? '量(億)' : '量'}</span>` +
        `<span class="kc-date">${U.esc(U.fmtDate(b.date).slice(5))}</span><span>${ohlc(b.open)}</span><span>${ohlc(b.high)}</span><span>${ohlc(b.low)}</span>` +
        `<b class="${t}">${ohlc(b.close)}</b><span>${typeof b.vol === 'number' ? U.fmtNum(b.vol) : '—'}</span>`;
    });

    pts.length = n;
    (dash?.proj || []).forEach((v, i) => {
      const d = dash.deducts[i];
      const day = `<span class="kc-date">第 ${i + 1} 天</span>`;
      pts.push({
        x: x(n + i), ky: y(v), kdy: null,
        k: '<span class="kc-proj"><span class="kc-th">時</span><span class="kc-th">月線</span><span class="kc-th">週線</span><span class="kc-th">扣抵值</span><span class="kc-th">扣抵日</span>' +
          `${day}<b>${px(v)}</b><span>${px(dash.proj5[i])}</span><span>${U.fmtNum(d.close)}</span><span>${U.esc(U.fmtDate(d.date).slice(5))}</span></span>`,
        kd: `${day}<span>假設的日子沒有 KD</span>`,
      });
    });

    const from = dash ? list.findIndex(b => b.date === dash.from) : -1;
    const band = from >= 0 ? `<rect class="kc-band" x="${f(x(from) - slot / 2)}" y="0" width="${f(slot * plan.slots)}" height="${H}"/>` : '';
    const bandLabel = from >= 0 ? `<span class="kc-band-label" style="left:${pct(x(from) - slot / 2, W)};width:${pct(slot * plan.slots, W)}">扣抵</span>` : '';
    const now = dash ? `<line class="kc-now" x1="${f(x(n - 1) + slot / 2)}" x2="${f(x(n - 1) + slot / 2)}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>` : '';
    const level = dash?.price ? `<line class="kc-level" x1="${f(x(n) - slot / 2)}" x2="${W}" y1="${f(y(dash.price))}" y2="${f(y(dash.price))}" vector-effect="non-scaling-stroke"/>` : '';
    const dot = dash?.price ? `<span class="kc-dot" style="left:${pct(x(n), W)};top:${pct(y(dash.price), H)}"></span>` : '';
    const svg = `${band}${now}${gridSVG(grid, y)}${vols}${candles}${level}${lineSVG(list, 'ma5', x, y, 'm5')}${lineSVG(list, 'ma20', x, y, '')}` +
      (dash ? `${dashSVG(list, 'ma5', dash.proj5, x, y, 'm5')}${dashSVG(list, 'ma20', dash.proj, x, y, '')}` : '');
    return `<div class="kc-legend"><span><i class="kc-key m5"></i>週線</span><span><i class="kc-key"></i>月線</span>${dash?.price ? `<span><i class="kc-key dash"></i>價格一直是 ${U.fmtNum(dash.price)}</span>` : ''}</div>` +
      plotHTML('k', `${code} 日 K 線，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，共 ${n} 天，黃線是週線、藍線是月線，下面是每天的成交量`,
        svg, `${tickHTML(grid, y)}${bandLabel}${dot}`, axisHTML(list, x, slot, dash));
  }


  function kdHTML(list, x, slot, dash) {
    const lo = -4;
    const hi = 104;
    const y = v => H - (v - lo) / (hi - lo) * H;
    const zone = v => KD.zone(v);
    const num = v => {
      const z = zone(v);
      return `<b class="${z === 'low' ? 'down' : z === 'high' ? 'up' : ''}">${U.fmtNum(U.round(v, 2), 2)}</b>`;
    };
    const CROSS = { golden: ['up', '黃金交叉'], dead: ['down', '死亡交叉'] };
    list.forEach((b, i) => {
      pts[i].kdy = b.k === null ? null : y(b.k);
      const c = CROSS[KD.cross({ k: b.k, d: b.d, pk: b.pk, pd: b.pd })];
      pts[i].kd = b.k === null ? `<span class="kc-date">${U.esc(md(b.date))}</span><span>成交不到 9 天，還算不出 KD</span>`
        : `<span class="kc-date">${U.esc(md(b.date))}</span><span>K ${num(b.k)}</span><span>D ${num(b.d)}</span>` +
          (c ? `<span class="${c[0]}">${c[1]}</span>` : '');
    });
    const levels = [KD.low, KD.high];
    const svg = `${gridSVG([50], y)}` +
      levels.map(v => `<line class="kc-level" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('') +
      `${lineSVG(list, 'd', x, y, 'kd-d')}${lineSVG(list, 'k', x, y, 'kd-k')}`;
    const ticks = [...levels, 50].map(v => `<span class="kc-tick" style="top:${pct(y(v), H)}">${v}</span>`).join('');
    return `<div class="kc-legend"><span><i class="kc-key kd-k"></i>K</span><span><i class="kc-key kd-d"></i>D</span><span><i class="kc-key dash kd-lv"></i>${KD.low}、${KD.high}</span></div>` +
      plotHTML('kd', `${code} 日 KD，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，黃線是 K、藍線是 D，虛線是 ${KD.low} 和 ${KD.high}`,
        svg, ticks, axisHTML(list, x, slot, dash), true);
  }

  const K_NOTE = '<p>最近 20 個交易日的日 K 線：紅色是收盤比開盤高、綠色是比較低；黃線是週線（5 日均線）、藍線是月線（20 日均線）。</p>' +
    '<p>下面是每天的成交量（張，1000 股一張）。點到哪一根，上面寫那天的開、高、低、收和成交量（收的紅綠是和前一天收盤比）；KD 跟著換成同一天。</p>' +
    '<p>資料來源是證交所、櫃買中心，每個工作天收盤後更新，盤中不會變。</p>';
  const INDEX_NOTE = '<p>加權指數沒有張數，下面那一條和讀數的量是那天的成交金額（億）。</p>';
  const kdNote = () => '<p>日 KD（9、3、3）：K 值是今天的收盤價在最近 9 天最高、最低之間的位置（0～100），再和前幾天平均過；D 值是 K 值再平均一次，走得比較慢。</p>' +
    `<p>K 值低於 ${KD.low} 是綠色、高於 ${KD.high} 是紅色，虛線就是這兩個數字` +
    '（<button type="button" class="link-btn" data-act="kd-marks">調整</button>）。</p>' +
    '<p>黃金交叉（紅）是 K 由下往上穿過 D，死亡交叉（綠）是由上往下。</p>' +
    '<p>和 K 線同樣的 20 天，上下對得起來。每個工作天收盤後更新。</p>';


  function frame(n) {
    const dash = plan?.dash(code, typed) || null;
    const slots = n + (dash ? plan.slots : 0);
    return { dash, x: i => (i + 0.5) / slots * W, slot: W / slots };
  }


  const cardOf = (inner, cls = '') => `<div class="card static detail-card sheet-chart${cls ? ` ${cls}` : ''}">${inner}</div>`;

  function chartsHTML() {
    const list = bars();
    const top = plan ? plan.cardHTML(code, typed) : '';
    const noList = text => (top ? cardOf(`${top}<p class="sheet-status">${text}</p>`, 'ma-card') : `<p class="sheet-status">${text}</p>`);
    if (!list) return noList(U.esc(Candles.waiting()));
    if (!list.length) return noList('沒有這檔的 K 線資料（興櫃、還沒開始交易的沒有）');
    const n = list.length;
    const { dash, x, slot } = frame(n);
    pts = list.map((b, i) => ({ x: x(i), ky: null, kdy: null, k: '', kd: '' }));
    latest = n - 1;
    const k = kHTML(list, x, slot, dash);
    const hasKd = list.some(b => b.k !== null);

    const kd = hasKd ? kdHTML(list, x, slot, dash)
      : `<p class="trend-note">${n < 9 ? `只有 ${n} 天有成交，要 9 天才算得出 KD` : 'KD 還沒更新，每個工作天收盤後會更新'}</p>`;
    return `${head(`日 K 線（${n} 天）`, K_NOTE + (U.isIndex(code) ? INDEX_NOTE : '') + (plan?.note || ''))}${top ? cardOf(`${top}<div class="kc">${k}</div>`, 'ma-card') : cardOf(k)}${head('KD', kdNote())}${cardOf(kd)}`;
  }

  function render() {
    const today = U.today();
    const h = Holdings.all(today);
    const pos = (h ? h.positions : []).find(p => key(p.code) === code && p.shares > 0) || null;
    const watchRec = Store.list('watch').find(r => key(r.code) === code) || null;
    const names = typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {};
    const name = pos?.name || watchRec?.name || names[code] || Announced.forCode(code)[0]?.name || '';
    titleEl.textContent = `${code} ${name}`.trim();
    const watchBtn = `<button type="button" class="badge detail-tool detail-watch${watchRec ? ' on' : ''}" data-act="${watchRec ? 'unwatch' : 'watch'}" aria-pressed="${!!watchRec}">自選</button>`;

    const i = codes.indexOf(code);
    const nav = codes.length > 1 && i >= 0 ? `
      <div class="kl-nav detail-nav">
        <button type="button" class="text-btn" data-act="prev"${i === 0 ? ' disabled' : ''}>‹ 上一檔</button>
        <span>${i + 1} / ${codes.length}</span>
        <button type="button" class="text-btn" data-act="next"${i === codes.length - 1 ? ' disabled' : ''}>下一檔 ›</button>
      </div>` : '';
    bodyEl.innerHTML = `${nav}
      <div class="detail-top">
        <span class="detail-tools">
          ${pos ? '<span class="badge member">持有</span>' : ''}
          ${watchBtn}
          ${U.isIndex(code) ? '' : Alerts.toolHTML(code, menuOpen)}
        </span>
        ${more ? `<button type="button" class="detail-more" data-act="more">${U.esc(more.label)} ›</button>` : ''}
      </div>
      ${chartsHTML()}`;
  }


  function select(i) {
    if (!pts.length) return;
    i = Math.max(0, Math.min(pts.length - 1, i));
    sel = i === latest ? null : i;
    bodyEl.querySelectorAll('.tx-plot').forEach(plot => {
      const chart = plot.dataset.chart;
      plot.querySelector('.kc-mark').innerHTML = markHTML(chart, i);
      plot.previousElementSibling.innerHTML = readOf(chart, i);
    });
  }

  function init(h) {
    hooks = h;
  }



  function open(c, { list = [], menu = false, plan: extra = null, link = null } = {}) {
    codes = list.map(key);
    menuFirst = menu;
    plan = extra;
    more = link;
    show(c);
    if (!dlg.open) dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  function show(c) {
    code = key(c);
    sel = null;
    typed = null;
    menuOpen = menuFirst;
    Candles.need();
    render();
    bodyEl.scrollTop = 0;
  }


  const typing = () => !!document.activeElement?.matches?.('#stock-sheet [data-ma]');
  function refresh() {
    if (!dlg.open || typing()) return;
    const top = bodyEl.scrollTop;
    render();
    bodyEl.scrollTop = top;
  }

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());

  function setMenu(v) {
    menuOpen = v;
    const menu = bodyEl.querySelector('.alert-menu');
    if (menu) menu.hidden = !v;
    bodyEl.querySelector('[data-act="alert-menu"]')?.setAttribute('aria-expanded', String(v));
  }

  dlg.addEventListener('click', e => {
    if (e.target === dlg) dlg.close();
    else if (menuOpen && !e.target.closest('.detail-menu')) setMenu(false);
  });

  dlg.addEventListener('cancel', e => {
    if (!menuOpen) return;
    e.preventDefault();
    setMenu(false);
  });
  bodyEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    const i = codes.indexOf(code);
    if (act === 'prev' && i > 0) {
      show(codes[i - 1]);
    } else if (act === 'next' && i >= 0 && i < codes.length - 1) {
      show(codes[i + 1]);
    } else if (act === 'more' && more) {
      more.open(code);
    } else if (act === 'alert-menu') {
      setMenu(!menuOpen);
    } else if (act === 'alert') {
      setMenu(false);
      Form.open('alerts', btn.dataset.id || null, { code, name: titleEl.textContent.slice(code.length).trim() });
    } else if (act === 'watch') {
      const rec = Store.add('watch', { code, name: titleEl.textContent.slice(code.length).trim() });
      hooks.onChanged('watch', rec);
      refresh();

      bodyEl.querySelector('.detail-watch')?.focus({ preventScroll: true });
      hooks.toast('已加入自選');
    } else if (act === 'unwatch') {
      const rec = Store.list('watch').find(r => key(r.code) === code);
      if (!rec) return;
      Store.remove('watch', rec.id);
      hooks.onChanged('watch', null);
      refresh();
      bodyEl.querySelector('.detail-watch')?.focus({ preventScroll: true });
      hooks.toast('已從自選移除');
    }
  });

  bodyEl.addEventListener('input', e => {
    if (!plan || !e.target.matches('[data-ma]')) return;
    typed = e.target.value;
    const out = bodyEl.querySelector('.ma-out');
    if (out) out.innerHTML = plan.outHTML(code, typed);
    const list = bars();
    const box = bodyEl.querySelector('.kc');
    if (box && list?.length) {
      const { dash, x, slot } = frame(list.length);
      box.innerHTML = kHTML(list, x, slot, dash);
      select(cur());
    }
  });
  bodyEl.addEventListener('focusin', e => { if (e.target.matches('[data-ma]')) e.target.select(); });

  const nearest = (plot, clientX) => {
    const r = plot.getBoundingClientRect();
    const at = (clientX - r.left) / r.width * W;
    return pts.reduce((best, p, i) => (Math.abs(p.x - at) < Math.abs(pts[best].x - at) ? i : best), 0);
  };
  const follow = e => {
    const plot = e.target.closest('.tx-plot');
    if (plot && pts.length) select(nearest(plot, e.clientX));
  };
  bodyEl.addEventListener('pointermove', follow);
  bodyEl.addEventListener('pointerdown', follow);
  bodyEl.addEventListener('pointerout', e => {
    const plot = e.target.closest('.tx-plot');
    if (plot && !plot.contains(e.relatedTarget) && e.pointerType === 'mouse' && !e.relatedTarget?.closest?.('.tx-plot')) select(latest);
  });
  bodyEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-ma]')) {
      e.target.blur();
      return;
    }
    if (!e.target.closest('.tx-plot') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    select(cur() + (e.key === 'ArrowLeft' ? -1 : 1));
  });

  return { init, open, refresh, bars, miniHTML };
})();
