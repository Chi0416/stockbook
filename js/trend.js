// 帳戶走勢：總覽「庫存總市值」卡片點了，從底部彈出的折線圖（和新增表單一樣；資料是帳戶紀錄，見 history.js）
//   上面切換期間：1 個月｜3 個月｜1 年｜全部（每次打開都是全部）
//   只畫市值一條線，縱軸照市值的範圍，起伏才看得出來（付出成本通常低很多，一起畫的話縱軸拉太開，市值看起來是平的）
//     那一天的付出成本、損益寫在上面的讀數
//   橫軸每一筆紀錄一格、一樣寬，點在格子正中間（和券商 App 的走勢一樣，沒記的日子不留空），手指點哪一格就是哪一天
//   縱軸三、四條格線，以萬為單位；太靠近上緣的不寫，免得擠到讀數
//     紀錄不多時（POINTS 筆以內）每一筆畫一個小點、下面寫日期，看得出來有哪幾天；多的時候只寫頭尾的日期
//   讀數：平常是最近一天，手指（滑鼠）在圖上移動時換成最近的那一天；鍵盤左右鍵也可以換
//   兩筆之間隔了 GAP 天以上（中間沒記）：那一段畫虛線，看得出來中間有空檔（月底到月底一個月左右，照樣是實線）
//   盤中先記、還沒換成收盤價的那天，讀數的日期後面寫「盤中」
//   隱藏金額時數字都是 ***，線照畫（看不出金額）
//   最下面連到「記帳 → 帳戶紀錄」，每一天的數字在那裡
const Trend = (() => {
  const dlg = document.getElementById('trend-sheet');
  const W = 1000; // 圖的座標寬、高（畫面上照框的大小縮放，線的粗細不變）
  const H = 400;
  const RANGES = [['1m', '1 個月', 1], ['3m', '3 個月', 3], ['1y', '1 年', 12], ['all', '全部', 0]];
  const POINTS = 7;
  const GAP = 40;
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  let range = 'all';
  let points = []; // 目前畫的資料 [{ date, cost, value, live, x, y }]，移動時用
  let hooks = { showHistory() {} };

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
  const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;

  // 期間的第一天：今天往回推幾個月；全部是 ''
  function fromOf(months) {
    if (!months) return '';
    const [y, m, d] = U.today().split('-').map(Number);
    const t = new Date(y, m - 1 - months, d);
    return `${t.getFullYear()}-${U.pad2(t.getMonth() + 1)}-${U.pad2(t.getDate())}`;
  }

  // 讀數（第 i 天）：固定三行（日期｜市值、付出成本｜損益），移動時高度不變，圖才不會跳
  function readHTML(i) {
    const p = points[i];
    const pl = p.cost === null ? null : Math.round(p.value) - Math.round(p.cost);
    const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
    const rate = pl !== null && p.cost > 0 ? `（${Privacy.num(`${U.fmtNum(U.round(pl / p.cost * 100, 2), 2)}%`)}）` : '';
    return `<span class="trend-date">${U.esc(p.date.slice(0, 4))}/${U.esc(md(p.date))}${p.live ? '<span class="trend-live">盤中</span>' : ''}</span>` +
      `<span class="trend-item">市值 <strong>${money(p.value)}</strong></span>` +
      `<span class="trend-item">付出成本 <strong>${money(p.cost)}</strong></span>` +
      `<span class="trend-item pl">損益 <strong class="${tone}">${money(pl)}${rate}</strong></span>`; // 沒有付出成本時寫 —
  }

  // 第 i 天的直線和點
  function markHTML(i) {
    const p = points[i];
    return `<span class="trend-cross" style="left:${pct(p.x, W)}"></span>` +
      `<span class="trend-dot" style="left:${pct(p.x, W)};top:${pct(p.y, H)}"></span>`;
  }

  // 市值的線：隔了 GAP 天以上的那一段放進虛線（dashed 為 true 時只畫這些段）
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
    const grid = ticks(lo, hi).filter(v => y(v) > H * 0.06);
    const last = points.length - 1;
    const few = n <= POINTS;
    // 紀錄不多：每一筆一個小點，日期寫在點的正下方；多的時候只寫頭尾的完整日期（靠邊對齊，才不會超出框）
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
      body = '<p class="trend-note">還沒有紀錄。收盤資料更新後打開記錄簿，會自動記下每天的付出成本和市值；以前的可以到「記帳 → 帳戶紀錄」自己補。</p>';
    } else if (!series.length) {
      body = `<p class="trend-note">最近 ${label}沒有紀錄，最近一筆是 ${U.esc(U.fmtDate(all.at(-1).date))}</p>`;
    } else body = chartHTML(series);
    dlg.querySelector('.sheet-body').innerHTML = `
      <div class="seg range" role="group" aria-label="期間">
        ${RANGES.map(([k, text]) => `<button type="button" data-act="range" data-value="${k}" aria-pressed="${k === range}">${text}</button>`).join('')}
      </div>
      ${who ? `<p class="trend-who">${U.esc(who)}</p>` : ''}
      <div class="trend">${body}</div>
      <button type="button" class="link-btn trend-more" data-act="history">每一天的數字（記帳 → 帳戶紀錄）</button>`;
  }

  // 換到第 i 天：只改讀數、直線和點，不重畫整張圖
  function select(plot, i) {
    i = Math.max(0, Math.min(points.length - 1, i));
    if (String(i) === plot.dataset.i) return;
    plot.dataset.i = i;
    plot.querySelector('.trend-mark').innerHTML = markHTML(i);
    plot.closest('.trend').querySelector('.trend-read').innerHTML = readHTML(i);
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    if (!dlg) return; // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）
    const body = dlg.querySelector('.sheet-body');
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
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
    // 手指、滑鼠移到的地方換成最近的那一天；滑鼠離開時回到最近一天（手指放開後停在那一天）
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

  // 資料變了（記了新的一天、同步、隱藏金額、換成員）：開著的話重畫
  function refresh() {
    if (dlg?.open) render();
  }

  return { init, open, refresh, ticks };
})();
