// 帳戶走勢：總覽「庫存總市值」卡片最下面點開的折線圖（資料是帳戶紀錄，見 history.js）
//   兩條線：市值（橘）、付出成本（藍），同一個金額座標；兩條線中間的差就是損益
//   橫軸照日期（中間沒記的日子留空間），縱軸三、四條格線，以萬為單位
//   上面一行讀數：平常是最近一天，手指（滑鼠）在圖上移動時換成最近的那一天；鍵盤左右鍵也可以換
//   只補了市值的日子（付出成本空白）付出成本那條線斷開
//   隱藏金額時數字都是 ***，線照畫（看不出金額）
//   開關記在這台裝置；每一天的數字在「記帳 → 帳戶紀錄」
const Trend = (() => {
  const OPEN_KEY = 'stockbook.trendOpen';
  const W = 1000; // 圖的座標寬、高（畫面上照框的大小縮放，線的粗細不變）
  const H = 400;
  let open = false;
  try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) {}
  let points = []; // 目前畫的資料 [{ date, cost, value, x, yv, yc }]，移動時用

  function toggle() {
    open = !open;
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) {}
  }

  // 三、四條好讀的格線：間隔是 1、2、2.5、5 × 10 的次方
  function ticks(min, max) {
    if (max === min) return [min];
    const raw = (max - min) / 4;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
  }

  // 格線的數字：一萬以上寫「582 萬」
  const tickText = n => Privacy.num(Math.abs(n) >= 10000 ? `${U.fmtNum(U.round(n / 10000, 1))} 萬` : U.fmtNum(n));
  const money = n => (n === null ? '—' : Privacy.num(U.fmtNum(Math.round(n))));
  const md = d => `${U.fmtDate(d).slice(5)} ${U.weekday(d)}`;
  const day = d => Date.parse(d) / 86400000;

  // 讀數那一行（第 i 天）：數字用 strong，不用 b（總覽會把卡片裡的 b 當大數字縮放，見 overview.js 的 fitNumbers）
  function readHTML(i) {
    const p = points[i];
    const pl = p.cost === null ? null : Math.round(p.value) - Math.round(p.cost);
    const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
    const rate = pl !== null && p.cost > 0 ? `（${Privacy.num(`${U.fmtNum(U.round(pl / p.cost * 100, 2), 2)}%`)}）` : '';
    return `<span class="trend-date">${p.date.slice(0, 4)}/${md(p.date)}</span>` +
      `<span class="trend-item"><i class="key value"></i>市值 <strong>${money(p.value)}</strong></span>` +
      `<span class="trend-item"><i class="key cost"></i>付出成本 <strong>${money(p.cost)}</strong></span>` +
      `<span class="trend-item pl">損益 <strong class="${tone}">${money(pl)}${rate}</strong></span>`; // 沒有付出成本時寫 —，高度不變
  }

  // 第 i 天的直線和兩個點
  function markHTML(i) {
    const p = points[i];
    const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;
    return `<span class="trend-cross" style="left:${pct(p.x, W)}"></span>` +
      (p.yc === null ? '' : `<span class="trend-dot cost" style="left:${pct(p.x, W)};top:${pct(p.yc, H)}"></span>`) +
      `<span class="trend-dot value" style="left:${pct(p.x, W)};top:${pct(p.yv, H)}"></span>`;
  }

  // 一條線：沒有值的地方斷開
  const path = key => points.reduce((d, p, i) => {
    if (p[key] === null) return d;
    const prev = i > 0 && points[i - 1][key] !== null;
    return `${d}${prev ? 'L' : 'M'}${U.round(p.x, 1)} ${U.round(p[key], 1)}`;
  }, '');

  function chartHTML(series) {
    if (!series.length) {
      return '<p class="kpi-sub">還沒有紀錄。收盤資料更新後打開記錄簿，會自動記下每天的付出成本和市值；以前的可以到「記帳 → 帳戶紀錄」自己補。</p>';
    }
    const vals = series.flatMap(s => [s.value, s.cost]).filter(v => v !== null);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const t0 = day(series[0].date);
    const span = day(series.at(-1).date) - t0;
    const x = d => (span ? (day(d) - t0) / span * W : W / 2);
    const y = v => (v === null ? null : H - (v - lo) / (hi - lo) * H);
    points = series.map(s => ({ ...s, x: x(s.date), yv: y(s.value), yc: y(s.cost) }));
    const grid = ticks(lo, hi);
    const last = points.length - 1;
    return `
      <div class="trend-read" aria-live="polite">${readHTML(last)}</div>
      <div class="trend-plot" tabindex="0" data-i="${last}" role="img"
        aria-label="帳戶走勢，${U.esc(U.fmtDate(series[0].date))} 到 ${U.esc(U.fmtDate(series.at(-1).date))}，共 ${series.length} 天；左右鍵換日期">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${grid.map(v => `<line class="trend-grid" x1="0" x2="${W}" y1="${U.round(y(v), 1)}" y2="${U.round(y(v), 1)}" vector-effect="non-scaling-stroke"/>`).join('')}
          <path class="trend-line cost" d="${path('yc')}" vector-effect="non-scaling-stroke"/>
          <path class="trend-line value" d="${path('yv')}" vector-effect="non-scaling-stroke"/>
        </svg>
        ${grid.map(v => `<span class="trend-tick" style="top:${U.round(y(v) / H * 100, 3)}%">${tickText(v)}</span>`).join('')}
        <span class="trend-mark">${markHTML(last)}</span>
      </div>
      <div class="trend-axis"><span>${U.esc(U.fmtDate(series[0].date))}</span>${last ? `<span>${U.esc(U.fmtDate(series.at(-1).date))}</span>` : ''}</div>
      ${series.length === 1 ? '<p class="kpi-sub">目前只有一天的紀錄，多記幾天就看得到走勢</p>' : ''}
      <button type="button" class="link-btn" data-act="history-all">每一天的數字（記帳 → 帳戶紀錄）</button>`;
  }

  // 卡片最下面：開關，打開時下面是圖
  function html(series) {
    const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
    return `<button type="button" class="trend-toggle" data-act="trend" aria-expanded="${open}">帳戶走勢${chevron}</button>` +
      (open ? `<div class="trend">${chartHTML(series)}</div>` : '');
  }

  // 換到第 i 天：只改讀數、直線和點，不重畫整張圖
  function select(plot, i) {
    i = Math.max(0, Math.min(points.length - 1, i));
    if (String(i) === plot.dataset.i) return;
    plot.dataset.i = i;
    plot.querySelector('.trend-mark').innerHTML = markHTML(i);
    plot.closest('.trend').querySelector('.trend-read').innerHTML = readHTML(i);
  }

  // 手指、滑鼠移到的地方換成最近的那一天；離開時回到最近一天
  function bind(root) {
    const nearest = (plot, clientX) => {
      const r = plot.getBoundingClientRect();
      const at = (clientX - r.left) / r.width * W;
      return points.reduce((best, p, i) => (Math.abs(p.x - at) < Math.abs(points[best].x - at) ? i : best), 0);
    };
    root.addEventListener('pointermove', e => {
      const plot = e.target.closest('.trend-plot');
      if (plot && points.length) select(plot, nearest(plot, e.clientX));
    });
    root.addEventListener('pointerdown', e => {
      const plot = e.target.closest('.trend-plot');
      if (plot && points.length) select(plot, nearest(plot, e.clientX));
    });
    root.addEventListener('pointerout', e => {
      const plot = e.target.closest('.trend-plot');
      if (plot && !plot.contains(e.relatedTarget) && e.pointerType === 'mouse') select(plot, points.length - 1);
    });
    root.addEventListener('keydown', e => {
      const plot = e.target.closest('.trend-plot');
      if (!plot || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      select(plot, Number(plot.dataset.i) + (e.key === 'ArrowLeft' ? -1 : 1));
    });
  }

  return { html, toggle, bind, ticks, get open() { return open; } };
})();
