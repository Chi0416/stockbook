// 月線扣抵（20 日均線）：詳細頁（detail.js）的一段，自己輸入今天的價格，算出月線會變成多少、往上還是往下彎，下面畫 K 線圖
//   月線 = 最近 20 個交易日收盤價的平均；每過一個交易日加進當天的價格、扣掉最舊的那一天，扣掉的那天的收盤價就是「扣抵值」
//     今天的月線 − 前一天的月線 = (今天的價格 − 扣抵值) ÷ 20：價格比扣抵值高，月線往上彎；比較低，往下彎；一樣，持平
//   收盤價是 shared/candles.json（見 candles.js）；沒有成交的日子不算一天，和 KD 一樣
//   「今天」是這一檔最後一筆收盤價的下一個交易日：盤中是今天，收盤資料更新以後是下一個交易日
//   接下來的扣抵值：之後每個交易日依序扣掉的收盤價（現在就知道了）；比輸入的價格低是「扣低」，價格不變的話月線會往上彎
//   假設價格一直是輸入的價格：今天和接下來 5 天的月線（proj），K 線圖上畫成虛線
//   K 線圖可以點：和帳戶走勢一樣，圖上面一行讀數平常是最新那一天，手指（滑鼠）點到、滑到哪一根就換成那一天
//     K 棒：收（比前一天高紅、低綠）、開、高、低；右邊假設的那幾格：那天的月線、扣哪一天的多少
const MA = (() => {
  const N = 20;
  const NEXT = 5; // 列出接下來幾天的扣抵值，虛線也畫到這幾天
  const W = 1000; // K 線圖的座標寬、高（畫面上照框的大小縮放，線的粗細不變）
  const H = 400;
  let pts = [];      // K 線圖每一格（點的時候用）：[{ x, y: 那天月線的位置（沒有是 null）, html: 讀數 }]
  let latest = 0;    // 最新那一根是第幾格
  let sel = null;    // 點到第幾格；null 是最新那一根（重新打開詳細頁時回到最新，見 resetChart）
  const sign = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
  const sum = list => list.reduce((s, x) => s + x.close, 0);

  // list（新的在前）第 i 筆那天的月線：那天往前 20 筆的平均；不夠 20 筆是 null
  const at = (list, i) => (i + N <= list.length ? sum(list.slice(i, i + N)) / N : null);

  // code 的月線；price 是今天的價格（自己輸入的），不是正數時只算前一天的月線和扣抵值
  //   算不出來：{ why: 原因 }
  //   算得出來：{ list: 有成交的每一天（見 Candles.get）, last: 最後一筆收盤價的日期, prev: 前一天的月線,
  //     prevDir: 前一天的月線比再前一天 1 高、-1 低、0 一樣（資料不夠是 null）,
  //     deduct: 今天的扣抵值 { date, close }, price, ma: 今天的月線, dir: 1 上彎、-1 下彎、0 持平,
  //     next: 接下來每天的扣抵值 [{ date, close }]，先扣的在前,
  //     proj: 價格一直是 price 的話，今天和接下來每天的月線（第 k 天加進 k 個 price，扣掉 k 個最舊的）}
  function calc(code, price) {
    const list = Candles.get(code);
    if (!list) return { why: Candles.waiting() };
    if (list.length < N) {
      return { why: list.length ? `只有 ${list.length} 天有成交，要 ${N} 天才算得出月線` : '沒有這檔的收盤資料（興櫃、還沒開始交易的沒有）' };
    }
    const p = typeof price === 'number' && price > 0 ? price : null;
    const proj = p === null ? [] : Array.from({ length: NEXT + 1 }, (_, k) => ((k + 1) * p + sum(list.slice(0, N - 1 - k))) / N);
    return {
      code,
      list,
      last: list[0].date,
      prev: at(list, 0),
      prevDir: list.length > N ? sign(list[0].close, list[N].close) : null,
      deduct: list[N - 1],
      price: p,
      ma: p === null ? null : proj[0],
      dir: p === null ? null : sign(p, list[N - 1].close),
      next: list.slice(N - 1 - NEXT, N - 1).reverse(),
      proj,
    };
  }

  // 輸入的價格是哪一天的：最後一筆收盤價在今天以前、今天是平日 →「今天」；收盤資料已經有今天的、週末 →「下一個交易日」
  function dayName(last) {
    const t = U.today();
    const wd = new Date(`${t}T00:00:00`).getDay();
    return last < t && wd > 0 && wd < 6 ? '今天' : '下一個交易日';
  }

  // K 線圖（calc 的結果）：左邊最近 20 根 K 棒（收盤比開盤高紅、低綠、一樣灰），月線藍色實線（前面 19 天的收盤價算的，從第一根就畫得出來）
  //   右邊空 6 格是假設的：第 1 格是輸入的價格（點）、後面 5 天價格不變（淡淡的虛線），月線從最後一根接一段虛線
  //   這 6 天要扣的那 6 根 K 棒（20 根的話就是最左邊 6 根），後面畫淺色底、上面寫「扣抵」：和下面那一排扣抵值是同一批，扣低的話虛線往上
  //   和帳戶走勢一樣：座標寬 1000、高 400 照框的大小縮放，線的粗細不變；格線的數字寫在左邊
  function chartHTML(r) {
    const bars = r.list.filter(x => x.open !== null).reverse(); // 舊的在左；第 i 根是 list 的第 n - 1 - i 筆
    const n = bars.length;
    const slots = n + NEXT + 1;
    const x = i => (i + 0.5) / slots * W;
    const mas = bars.map((_, i) => at(r.list, n - 1 - i));
    const vals = [...bars.flatMap(b => [b.high, b.low]), ...mas.filter(v => v !== null), ...r.proj, ...(r.price ? [r.price] : [])];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.06;
    lo -= pad;
    hi += pad;
    const y = v => H - (v - lo) / (hi - lo) * H;
    const f = v => U.round(v, 1);
    const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;
    const slot = W / slots;
    const bw = slot * 0.62;
    const tone = b => (b.close > b.open ? 'up' : b.close < b.open ? 'down' : 'flat');

    const grid = Trend.ticks(lo, hi).filter(v => y(v) > H * 0.08);
    // 扣抵的 6 根：list 的第 19 筆（今天扣）到第 14 筆
    const from = n - N;
    const band = from >= 0 ? `<rect class="kc-band" x="${f(x(from) - slot / 2)}" y="0" width="${f(slot * (NEXT + 1))}" height="${H}"/>` : '';
    const wicks = bars.map((b, i) => `<line class="kc-wick ${tone(b)}" x1="${f(x(i))}" x2="${f(x(i))}" y1="${f(y(b.high))}" y2="${f(y(b.low))}" vector-effect="non-scaling-stroke"/>`).join('');
    const bodies = bars.map((b, i) => {
      const top = y(Math.max(b.open, b.close));
      const h = Math.max(y(Math.min(b.open, b.close)) - top, 2); // 開盤等於收盤：一條細線
      return `<rect class="kc-body ${tone(b)}" x="${f(x(i) - bw / 2)}" y="${f(top)}" width="${f(bw)}" height="${f(h)}"/>`;
    }).join('');
    const line = mas.reduce((d, v, i) => (v === null ? d : `${d}${d && mas[i - 1] !== null ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`), '');
    const dash = r.proj.length && mas[n - 1] !== null
      ? `M${f(x(n - 1))} ${f(y(mas[n - 1]))}${r.proj.map((v, k) => `L${f(x(n + k))} ${f(y(v))}`).join('')}` : '';
    const level = r.price ? `<line class="kc-level" x1="${f(x(n) - slot / 2)}" x2="${W}" y1="${f(y(r.price))}" y2="${f(y(r.price))}" vector-effect="non-scaling-stroke"/>` : '';
    const dot = r.price ? `<span class="kc-dot" style="left:${pct(x(n), W)};top:${pct(y(r.price), H)}"></span>` : '';
    const md = d => U.fmtDate(d).slice(5);
    const num = v => U.fmtNum(v);
    // 讀數：K 棒的收盤和前一天比（list 裡再舊一筆），比較高紅、低綠
    const barRead = (b, prev) => {
      const tone = typeof prev !== 'number' ? '' : b.close > prev ? 'up' : b.close < prev ? 'down' : '';
      return `<span class="kc-date">${md(b.date)} ${U.weekday(b.date)}</span><span>收 <b class="${tone}">${num(b.close)}</b></span>` +
        `<span>開 ${num(b.open)}</span><span>高 ${num(b.high)}</span><span>低 ${num(b.low)}</span>`;
    };
    const projRead = (k, v, d) => `<span class="kc-date">假設第 ${k + 1} 天</span><span>月線 <b>${U.fmtNum(U.round(v, 2), 2)}</b></span>` +
      `<span>扣 ${md(d.date)} 的 ${num(d.close)}</span>`;
    pts = [
      ...bars.map((b, i) => ({ x: x(i), y: mas[i] === null ? null : y(mas[i]), html: barRead(b, r.list[n - i]?.close) })),
      ...r.proj.map((v, k) => ({ x: x(n + k), y: y(v), html: projRead(k, v, r.list[N - 1 - k]) })),
    ];
    latest = n - 1;
    const cur = sel !== null && sel < pts.length ? sel : latest; // 打字換價格時，點到的那一格留著
    return `
      <div class="kc-read" aria-live="polite">${pts[cur].html}</div>
      <div class="kc-legend"><span><i class="kc-key"></i>月線</span>${r.price ? `<span><i class="kc-key dash"></i>價格一直是 ${U.fmtNum(r.price)} 的月線</span>` : ''}</div>
      <div class="kc-plot" tabindex="0" data-i="${cur}" role="img"
        aria-label="K 線圖，${U.esc(U.fmtDate(bars[0].date))} 到 ${U.esc(U.fmtDate(bars[n - 1].date))}，共 ${n} 天，藍線是月線，右邊的虛線是假設的；左右鍵換日期">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${band}
          ${grid.map(v => `<line class="kc-grid" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('')}
          <line class="kc-now" x1="${f(x(n - 1) + slot / 2)}" x2="${f(x(n - 1) + slot / 2)}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
          ${wicks}${bodies}${level}
          <path class="kc-ma" d="${line}" vector-effect="non-scaling-stroke"/>
          ${dash ? `<path class="kc-ma dash" d="${dash}" vector-effect="non-scaling-stroke"/>` : ''}
        </svg>
        ${grid.map(v => `<span class="kc-tick" style="top:${pct(y(v), H)}">${U.fmtNum(v)}</span>`).join('')}
        ${from >= 0 ? `<span class="kc-band-label" style="left:${pct(x(from) - slot / 2, W)};width:${pct(slot * (NEXT + 1), W)}">扣抵</span>` : ''}
        ${dot}
        <span class="kc-mark">${markHTML(cur)}</span>
      </div>
      <div class="kc-axis">
        <span class="first" style="left:${pct(x(0) - bw / 2, W)}">${md(bars[0].date)}</span>
        ${from > 4 && from < n - 6 ? `<span style="left:${pct(x(from), W)}">${md(bars[from].date)}</span>` : ''}
        <span style="left:${pct(x(n - 1), W)}">${md(bars[n - 1].date)}</span>
        <span class="last">假設</span>
      </div>`;
  }

  // 第 i 格的直線和月線上的點
  function markHTML(i) {
    const p = pts[i];
    const at = v => `${U.round(v / W * 100, 3)}%`;
    return `<span class="kc-cross" style="left:${at(p.x)}"></span>` +
      (p.y === null ? '' : `<span class="kc-mdot" style="left:${at(p.x)};top:${U.round(p.y / H * 100, 3)}%"></span>`);
  }

  // 換到第 i 格：只改讀數、直線和點，不重畫整張圖
  function select(plot, i) {
    i = Math.max(0, Math.min(pts.length - 1, i));
    sel = i === latest ? null : i;
    if (String(i) === plot.dataset.i) return;
    plot.dataset.i = i;
    plot.querySelector('.kc-mark').innerHTML = markHTML(i);
    plot.closest('.kc').querySelector('.kc-read').innerHTML = pts[i].html;
  }

  // 詳細頁打開時掛一次（root 是詳細頁的內容，圖重畫了也不用再掛）：手指、滑鼠移到的地方換成最近的那一格
  //   滑鼠離開時回到最新那一根（手指放開後停在那一天）；鍵盤左右鍵也可以換
  function bindChart(root) {
    const nearest = (plot, clientX) => {
      const b = plot.getBoundingClientRect();
      const at = (clientX - b.left) / b.width * W;
      return pts.reduce((best, p, i) => (Math.abs(p.x - at) < Math.abs(pts[best].x - at) ? i : best), 0);
    };
    const follow = e => {
      const plot = e.target.closest('.kc-plot');
      if (plot && pts.length) select(plot, nearest(plot, e.clientX));
    };
    root.addEventListener('pointermove', follow);
    root.addEventListener('pointerdown', follow);
    root.addEventListener('pointerout', e => {
      const plot = e.target.closest('.kc-plot');
      if (plot && !plot.contains(e.relatedTarget) && e.pointerType === 'mouse') select(plot, latest);
    });
    root.addEventListener('keydown', e => {
      const plot = e.target.closest('.kc-plot');
      if (!plot || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      select(plot, Number(plot.dataset.i) + (e.key === 'ArrowLeft' ? -1 : 1));
    });
  }

  return { N, calc, dayName, chartHTML, bindChart, resetChart: () => { sel = null; } };
})();
