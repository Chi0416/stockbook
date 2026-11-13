











const Trend = (() => {
  const dlg = document.getElementById('trend-sheet');
  const W = 1000;
  const H = 400;
  const RANGES = [['1m', '1 個月', 1], ['3m', '3 個月', 3], ['1y', '1 年', 12], ['all', '全部', 0]];
  const POINTS = 7;
  const GAP = 40;
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  let range = 'all';
  let points = [];
  let hooks = { showHistory() {} };


  const tickText = n => Privacy.num(Math.abs(n) >= 10000 ? `${U.fmtNum(U.round(n / 10000, 1))} 萬` : U.fmtNum(n));
  const money = n => (n === null ? '—' : Privacy.num(U.fmtNum(Math.round(n))));
  const md = d => `${U.fmtDate(d).slice(5)} ${U.weekday(d)}`;
  const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;


  function fromOf(months) {
    if (!months) return '';
    const [y, m, d] = U.today().split('-').map(Number);
    const t = new Date(y, m - 1 - months, d);
    return `${t.getFullYear()}-${U.pad2(t.getMonth() + 1)}-${U.pad2(t.getDate())}`;
  }


  function readHTML(i) {
    const p = points[i];
    const pl = p.cost === null ? null : Math.round(p.value) - Math.round(p.cost);
    const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
    const rate = pl !== null && p.cost > 0 ? `（${Privacy.num(`${U.fmtNum(U.round(pl / p.cost * 100, 2), 2)}%`)}）` : '';
    return `<span class="trend-date">${U.esc(p.date.slice(0, 4))}/${U.esc(md(p.date))}${p.live ? '<span class="trend-live">盤中</span>' : ''}</span>` +
      `<span class="trend-item">市值 <strong>${money(p.value)}</strong></span>` +
      `<span class="trend-item">付出成本 <strong>${money(p.cost)}</strong></span>` +
      `<span class="trend-item pl">損益 <strong class="${tone}">${money(pl)}${rate}</strong></span>`;
  }


  function markHTML(i) {
    const p = points[i];
    return `<span class="trend-cross" style="left:${pct(p.x, W)}"></span>` +
      `<span class="trend-dot" style="left:${pct(p.x, W)};top:${pct(p.y, H)}"></span>`;
  }


  const path = (dashed = false) => points.reduce((d, p, i) => {
    const q = points[i - 1];
    if (!q || (days(q.date, p.date) >= GAP) !== dashed) return d;
    return `${d}M${U.round(q.x, 1)} ${U.round(q.y, 1)}L${U.round(p.x, 1)} ${U.round(p.y, 1)}`;
  }, '');

  function chartHTML(series) {
    const vals = series.map(s => s.value);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const n = series.length;
    const x = i => (i + 0.5) / n * W;
    const y = v => H - (v - lo) / (hi - lo) * H;
    points = series.map((s, i) => ({ ...s, x: x(i), y: y(s.value) }));
    const grid = U.ticks(lo, hi).filter(v => y(v) > H * 0.06);
    const last = points.length - 1;
    const few = n <= POINTS;

    const dots = few ? points.map(p => `<span class="trend-pt" style="left:${pct(p.x, W)};top:${pct(p.y, H)}"></span>`).join('') : '';
    const labelAt = i => `<span style="left:${pct(points[i].x, W)}"${few ? '' : i === 0 ? ' class="first"' : ' class="last"'}>` +
      `${U.esc(few ? U.fmtDate(points[i].date).slice(5) : U.fmtDate(points[i].date))}</span>`;
    const labels = (few ? points.map((_, i) => i) : [0, last]).filter((i, k, all) => all.indexOf(i) === k).map(labelAt).join('');
    return `
      <div class="trend-read" aria-live="polite">${readHTML(last)}</div>
      <div class="trend-plot" tabindex="0" data-i="${last}" role="img"
        aria-label="帳戶走勢，${U.esc(U.fmtDate(series[0].date))} 到 ${U.esc(U.fmtDate(series.at(-1).date))}，共 ${series.length} 天；左右鍵換日期">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${grid.map(v => `<line class="trend-grid" x1="0" x2="${W}" y1="${U.round(y(v), 1)}" y2="${U.round(y(v), 1)}" vector-effect="non-scaling-stroke"/>`).join('')}
          <path class="trend-line" d="${path()}" vector-effect="non-scaling-stroke"/>
          <path class="trend-line gap" d="${path(true)}" vector-effect="non-scaling-stroke"/>
        </svg>
        ${grid.map(v => `<span class="trend-tick" style="top:${U.round(y(v) / H * 100, 3)}%">${tickText(v)}</span>`).join('')}
        ${dots}
        <span class="trend-mark">${markHTML(last)}</span>
      </div>
      <div class="trend-axis">${labels}</div>
      ${series.length === 1 ? '<p class="trend-note">只有一天的紀錄，多記幾天就看得到走勢</p>' : ''}`;
  }

  function render() {
    const all = History.series();
    const [, label, months] = RANGES.find(r => r[0] === range);
    const series = all.filter(s => s.date >= fromOf(months));
    const who = Store.scopeLabel();
    let body;
    points = [];
    if (!all.length) {
      body = '<p class="trend-note">還沒有紀錄。收盤資料更新後打開記錄簿，會自動記下每天的付出成本和市值；以前的可以到「帳務 → 帳戶紀錄」自己補。</p>';
    } else if (!series.length) {
      body = `<p class="trend-note">最近 ${label}沒有紀錄，最近一筆是 ${U.esc(U.fmtDate(all.at(-1).date))}</p>`;
    } else body = chartHTML(series);
    dlg.querySelector('.sheet-body').innerHTML = `
      <div class="seg range" role="group" aria-label="期間">
        ${RANGES.map(([k, text]) => `<button type="button" data-act="range" data-value="${k}" aria-pressed="${k === range}">${text}</button>`).join('')}
      </div>
      ${who ? `<p class="trend-who">${U.esc(who)}</p>` : ''}
      <div class="trend">${body}</div>
      <button type="button" class="link-btn trend-more" data-act="history">每一天的數字（帳務 → 帳戶紀錄）</button>`;
  }


  function select(plot, i) {
    i = Math.max(0, Math.min(points.length - 1, i));
    if (String(i) === plot.dataset.i) return;
    plot.dataset.i = i;
    plot.querySelector('.trend-mark').innerHTML = markHTML(i);
    plot.closest('.trend').querySelector('.trend-read').innerHTML = readHTML(i);
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    if (!dlg) return;
    const body = dlg.querySelector('.sheet-body');
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    body.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (btn?.dataset.act === 'range') {
        range = btn.dataset.value;
        render();
      } else if (btn?.dataset.act === 'history') {
        dlg.close();
        hooks.showHistory();
      }
    });

    const nearest = (plot, clientX) => {
      const r = plot.getBoundingClientRect();
      const at = (clientX - r.left) / r.width * W;
      return points.reduce((best, p, i) => (Math.abs(p.x - at) < Math.abs(points[best].x - at) ? i : best), 0);
    };
    const follow = e => {
      const plot = e.target.closest('.trend-plot');
      if (plot && points.length) select(plot, nearest(plot, e.clientX));
    };
    body.addEventListener('pointermove', follow);
    body.addEventListener('pointerdown', follow);
    body.addEventListener('pointerout', e => {
      const plot = e.target.closest('.trend-plot');
      if (plot && !plot.contains(e.relatedTarget) && e.pointerType === 'mouse') select(plot, points.length - 1);
    });
    body.addEventListener('keydown', e => {
      const plot = e.target.closest('.trend-plot');
      if (!plot || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      select(plot, Number(plot.dataset.i) + (e.key === 'ArrowLeft' ? -1 : 1));
    });
  }

  function open() {
    if (!dlg) return;
    range = 'all';
    render();
    if (!dlg.open) dlg.showModal();
  }


  function refresh() {
    if (dlg?.open) render();
  }

  return { init, open, refresh };
})();
