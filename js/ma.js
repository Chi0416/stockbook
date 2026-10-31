// 月線扣抵（20 日均線）和 K 線圖：算法、畫圖（選股的 K 線頁見 kline.js；詳細頁的小圖、大圖見 detail.js）
//   月線 = 最近 20 個交易日收盤價的平均；每過一個交易日加進當天的價格、扣掉最舊的那一天，扣掉的那天的收盤價就是「扣抵值」
//     今天的月線 − 前一天的月線 = (今天的價格 − 扣抵值) ÷ 20：價格比扣抵值高，月線往上彎；比較低，往下彎；一樣，持平
//   5 日線（最近 5 個交易日的平均）同樣的算法，K 線圖上一起畫
//   收盤價是 shared/candles.json（見 candles.js）；沒有成交的日子不算一天，和 KD 一樣
//   「今天」是這一檔最後一筆收盤價的下一個交易日：盤中是今天，收盤資料更新以後是下一個交易日
//   接下來 5 天（今天和之後 4 天）依序要扣的收盤價現在就知道了：比價格低是「扣低」，價格不變的話月線會往上彎
//   假設價格一直是這個價格：接下來 5 天的月線、5 日線（proj、proj5），K 線圖上畫成虛線
//   大圖可以點：和帳戶走勢一樣，圖上面一行讀數平常是最新那一天，手指（滑鼠）點到、滑到哪一根就換成那一天
//     K 棒：收（比前一天高紅、低綠）、開、高、低；右邊假設的那幾格：那天的月線、扣哪一天的多少
//   大圖下面一條是成交量（張），柱子和 K 棒同一個顏色；點到哪一根，那一條的左上角寫那天的量（舊的資料沒有成交量就不畫）
const MA = (() => {
  const N = 20;
  const N5 = 5;
  const DAYS = 5; // 接下來看幾天（今天和之後 4 天）：扣低幾天、虛線畫幾格
  const W = 1000; // 大圖的座標寬、高（畫面上照框的大小縮放，線的粗細不變）
  const H = 400;
  const VH = 90;  // 成交量那一條的高（座標）：有成交量時 K 棒畫在上面的 H - VH
  const VTOP = 26; // 成交量那一條上面留給「量 x 張」那一行的空間，最高的那根柱子從這裡開始
  let pts = [];      // 大圖每一格（點的時候用）：[{ x, y: 那天月線的位置（沒有是 null）, html: 讀數, vol: 那天的成交量（沒有是 null） }]
  let volTop = null; // 成交量那一條的上緣（座標）；沒有成交量是 null
  let latest = 0;    // 最新那一根是第幾格
  let sel = null;    // 點到第幾格；null 是最新那一根（換一檔、重新打開時回到最新，見 resetChart）
  const sign = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
  const sum = list => list.reduce((s, x) => s + x.close, 0);

  // list（新的在前）第 i 筆那天的 n 日均線：那天往前 n 筆的平均；不夠是 null
  const at = (list, i, n = N) => (i + n <= list.length ? sum(list.slice(i, i + n)) / n : null);
  // 價格一直是 p 的話，接下來第 1～5 天的 n 日均線：第 k 天加進 k 個 p，扣掉 k 個最舊的
  const project = (list, p, n) => Array.from({ length: DAYS }, (_, k) => ((k + 1) * p + sum(list.slice(0, Math.max(0, n - 1 - k)))) / n);

  // code 的月線；price 是今天的價格（自己輸入的、或現價），不是正數時只算前一天的月線和扣抵值
  //   算不出來：{ why: 原因 }
  //   算得出來：{ code, list: 有成交的每一天（見 Candles.get）, last: 最後一筆收盤價的日期, prev: 前一天的月線,
  //     prevDir: 前一天的月線比再前一天 1 高、-1 低、0 一樣（資料不夠是 null）, prev5: 前一天的 5 日線,
  //     deduct: 今天的扣抵值 { date, close }, next: 之後 4 天的扣抵值（先扣的在前）, deducts: 今天和之後 4 天,
  //     price, ma: 今天的月線, dir: 1 上彎、-1 下彎、0 持平, ma5: 今天的 5 日線, dir5,
  //     low、high: 這 5 天的扣抵值有幾天比價格低（扣低）、高（扣高）,
  //     proj、proj5: 價格一直是 price 的話，這 5 天的月線、5 日線 }
  function calc(code, price) {
    const list = Candles.get(code);
    if (!list) return { why: Candles.waiting() };
    if (list.length < N) {
      return { why: list.length ? `只有 ${list.length} 天有成交，要 ${N} 天才算得出月線` : '沒有這檔的收盤資料（興櫃、還沒開始交易的沒有）' };
    }
    const p = typeof price === 'number' && price > 0 ? price : null;
    const deducts = list.slice(N - DAYS, N).reverse();
    const proj = p === null ? [] : project(list, p, N);
    const proj5 = p === null ? [] : project(list, p, N5);
    return {
      code,
      list,
      last: list[0].date,
      prev: at(list, 0),
      prevDir: list.length > N ? sign(list[0].close, list[N].close) : null,
      prev5: at(list, 0, N5),
      deduct: deducts[0],
      next: deducts.slice(1),
      deducts,
      price: p,
      ma: p === null ? null : proj[0],
      dir: p === null ? null : sign(p, deducts[0].close),
      ma5: p === null ? null : proj5[0],
      dir5: p === null ? null : sign(p, list[N5 - 1].close),
      low: p === null ? null : deducts.filter(d => d.close < p).length,
      high: p === null ? null : deducts.filter(d => d.close > p).length,
      proj,
      proj5,
    };
  }

  // 輸入的價格是哪一天的：最後一筆收盤價在今天以前、今天是平日 →「今天」；收盤資料已經有今天的、週末 →「下一個交易日」
  function dayName(last) {
    const t = U.today();
    const wd = new Date(`${t}T00:00:00`).getDay();
    return last < t && wd > 0 && wd < 6 ? '今天' : '下一個交易日';
  }

  // 畫圖共用：K 棒、均線的位置；slots 是一共幾格（K 棒加上右邊假設的 5 格），w、h 是座標寬、高
  function frame(r, w, h, extra = []) {
    const bars = r.list.filter(x => x.open !== null).reverse(); // 舊的在左；第 i 根是 list 的第 n - 1 - i 筆
    const n = bars.length;
    const slots = n + DAYS;
    const x = i => (i + 0.5) / slots * w;
    const mas = bars.map((_, i) => at(r.list, n - 1 - i));
    const vals = [...bars.flatMap(b => [b.high, b.low]), ...mas.filter(v => v !== null), ...r.proj, ...extra];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.06;
    lo -= pad;
    hi += pad;
    const y = v => h - (v - lo) / (hi - lo) * h;
    return { bars, n, slots, x, y, lo, hi, mas, slot: w / slots };
  }
  const f = v => U.round(v, 1);
  const tone = b => (b.close > b.open ? 'up' : b.close < b.open ? 'down' : 'flat');
  // K 棒（影線和實體）：開盤等於收盤時實體是一條細線（minH 高）
  function barsSVG({ bars, x, y, slot }, minH) {
    const bw = slot * 0.62;
    return bars.map((b, i) => {
      const top = y(Math.max(b.open, b.close));
      const bh = Math.max(y(Math.min(b.open, b.close)) - top, minH);
      return `<line class="kc-wick ${tone(b)}" x1="${f(x(i))}" x2="${f(x(i))}" y1="${f(y(b.high))}" y2="${f(y(b.low))}" vector-effect="non-scaling-stroke"/>` +
        `<rect class="kc-body ${tone(b)}" x="${f(x(i) - bw / 2)}" y="${f(top)}" width="${f(bw)}" height="${f(bh)}"/>`;
    }).join('');
  }
  // 一條均線（vals 是每一根的值，null 斷開）和接在最後一根後面的虛線（proj）
  function linesSVG({ n, x, y }, vals, proj, cls) {
    const line = vals.reduce((d, v, i) => (v === null ? d : `${d}${d && vals[i - 1] !== null ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`), '');
    const dash = proj.length && vals[n - 1] !== null ? `M${f(x(n - 1))} ${f(y(vals[n - 1]))}${proj.map((v, k) => `L${f(x(n + k))} ${f(y(v))}`).join('')}` : '';
    return `<path class="kc-ma ${cls}" d="${line}" vector-effect="non-scaling-stroke"/>` +
      (dash ? `<path class="kc-ma ${cls} dash" d="${dash}" vector-effect="non-scaling-stroke"/>` : '');
  }

  // 小圖（選股 K 線頁的每一列、詳細頁）：20 根 K 棒和月線，右邊 5 格是價格不變時月線的虛線；不能點、沒有格線
  function miniHTML(r) {
    const w = 200;
    const h = 60;
    const fr = frame(r, w, h, r.price ? [r.price] : []);
    return `<svg class="kc-mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      ${barsSVG(fr, 1)}${linesSVG(fr, fr.mas, r.proj, 'm20')}</svg>`;
  }

  // 大圖（calc 的結果）：左邊 20 根 K 棒（收盤比開盤高紅、低綠、一樣灰），月線藍色、5 日線黃色實線
  //   最左邊那 5 根就是接下來 5 天要扣的，後面畫淺色底、上面寫「扣抵」：和下面那一排扣抵值是同一批，扣低的話虛線往上
  //   右邊 5 格是假設的：輸入的價格（點）、價格不變（淡淡的點線），月線、5 日線從最後一根接一段虛線
  //   和帳戶走勢一樣：座標寬 1000、高 400 照框的大小縮放，線的粗細不變；格線的數字寫在左邊
  //   有成交量時，最下面 VH 那一條畫成交量：柱子對齊上面的 K 棒，最高的那根頂到這一條的上面（留一行寫量）
  function chartHTML(r) {
    const hasVol = r.list.some(b => b.open !== null && typeof b.vol === 'number');
    volTop = hasVol ? H - VH : null;
    const fr = frame(r, W, hasVol ? H - VH : H, [...r.proj5, ...(r.price ? [r.price] : [])]);
    const { bars, n, x, y, lo, hi, mas, slot } = fr;
    const mas5 = bars.map((_, i) => at(r.list, n - 1 - i, N5));
    const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;
    const grid = Trend.ticks(lo, hi).filter(v => y(v) > H * 0.08);
    const vmax = Math.max(1, ...bars.map(b => b.vol || 0));
    const vy = v => H - v / vmax * (VH - VTOP);
    const vols = !hasVol ? '' : `<line class="kc-vbase" x1="0" x2="${W}" y1="${H - VH}" y2="${H - VH}" vector-effect="non-scaling-stroke"/>` +
      bars.map((b, i) => (typeof b.vol !== 'number' ? '' :
        `<rect class="kc-vol ${tone(b)}" x="${f(x(i) - slot * 0.31)}" y="${f(vy(b.vol))}" width="${f(slot * 0.62)}" height="${f(Math.max(H - vy(b.vol), b.vol ? 1 : 0))}"/>`)).join('');
    const from = n - N; // 要扣的第一根（list 的第 20 筆）
    const band = from >= 0 ? `<rect class="kc-band" x="${f(x(from) - slot / 2)}" y="0" width="${f(slot * DAYS)}" height="${H}"/>` : '';
    const level = r.price ? `<line class="kc-level" x1="${f(x(n) - slot / 2)}" x2="${W}" y1="${f(y(r.price))}" y2="${f(y(r.price))}" vector-effect="non-scaling-stroke"/>` : '';
    const dot = r.price ? `<span class="kc-dot" style="left:${pct(x(n), W)};top:${pct(y(r.price), H)}"></span>` : '';
    const md = d => U.fmtDate(d).slice(5);
    const num = v => U.fmtNum(v);
    const ma2 = v => U.fmtNum(U.round(v, 2), 2);
    // 讀數：K 棒的收盤和前一天比（list 裡再舊一筆），比較高紅、低綠
    const barRead = (b, prev) => {
      const t = typeof prev !== 'number' ? '' : b.close > prev ? 'up' : b.close < prev ? 'down' : '';
      return `<span class="kc-date">${U.esc(md(b.date))} ${U.weekday(b.date)}</span><span>收 <b class="${t}">${num(b.close)}</b></span>` +
        `<span>開 ${num(b.open)}</span><span>高 ${num(b.high)}</span><span>低 ${num(b.low)}</span>`;
    };
    const projRead = k => `<span class="kc-date">假設第 ${k + 1} 天</span><span>月線 <b>${ma2(r.proj[k])}</b></span>` +
      `<span>扣 ${U.esc(md(r.deducts[k].date))} 的 ${num(r.deducts[k].close)}</span>`;
    pts = [
      ...bars.map((b, i) => ({ x: x(i), y: mas[i] === null ? null : y(mas[i]), html: barRead(b, r.list[n - i]?.close), vol: b.vol })),
      ...r.proj.map((v, k) => ({ x: x(n + k), y: y(v), html: projRead(k), vol: null })),
    ];
    latest = n - 1;
    const cur = sel !== null && sel < pts.length ? sel : latest; // 打字換價格時，點到的那一格留著
    return `
      <div class="kc-read" aria-live="polite">${pts[cur].html}</div>
      <div class="kc-legend"><span><i class="kc-key m5"></i>5 日線</span><span><i class="kc-key"></i>月線</span>${r.price ? `<span><i class="kc-key dash"></i>價格一直是 ${num(r.price)}</span>` : ''}</div>
      <div class="kc-plot${hasVol ? ' has-vol' : ''}" tabindex="0" data-i="${cur}" role="img"
        aria-label="K 線圖，${U.esc(U.fmtDate(bars[0].date))} 到 ${U.esc(U.fmtDate(bars[n - 1].date))}，共 ${n} 天，藍線是月線、黃線是 5 日線，右邊的虛線是假設的${hasVol ? '，下面是成交量' : ''}；左右鍵換日期">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${band}
          ${grid.map(v => `<line class="kc-grid" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('')}
          <line class="kc-now" x1="${f(x(n - 1) + slot / 2)}" x2="${f(x(n - 1) + slot / 2)}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
          ${vols}
          ${barsSVG(fr, 2)}${level}
          ${linesSVG(fr, mas5, r.proj5, 'm5')}
          ${linesSVG(fr, mas, r.proj, 'm20')}
        </svg>
        ${grid.map(v => `<span class="kc-tick" style="top:${pct(y(v), H)}">${num(v)}</span>`).join('')}
        ${from >= 0 ? `<span class="kc-band-label" style="left:${pct(x(from) - slot / 2, W)};width:${pct(slot * DAYS, W)}">扣抵</span>` : ''}
        ${dot}
        <span class="kc-mark">${markHTML(cur)}</span>
      </div>
      <div class="kc-axis">
        <span class="first" style="left:${pct(x(0) - slot * 0.31, W)}">${U.esc(md(bars[0].date))}</span>
        <span style="left:${pct(x(n - 1), W)}">${U.esc(md(bars[n - 1].date))}</span>
        <span class="last">假設</span>
      </div>`;
  }

  // 第 i 格的直線和月線上的點；有成交量時，成交量那一條的左上角寫這一格的量（假設的那幾格只寫「成交量」）
  function markHTML(i) {
    const p = pts[i];
    const at = v => `${U.round(v / W * 100, 3)}%`;
    const vol = volTop === null ? '' :
      `<span class="kc-vlabel" style="top:${U.round(volTop / H * 100, 3)}%">${typeof p.vol === 'number' ? `量 <b>${U.fmtNum(p.vol)}</b> 張` : '成交量'}</span>`;
    return `<span class="kc-cross" style="left:${at(p.x)}"></span>` +
      (p.y === null ? '' : `<span class="kc-mdot" style="left:${at(p.x)};top:${U.round(p.y / H * 100, 3)}%"></span>`) + vol;
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

  // 大圖所在的地方打開時掛一次（root 是 sheet 的內容，圖重畫了也不用再掛）：手指、滑鼠移到的地方換成最近的那一格
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

  return { N, DAYS, calc, dayName, miniHTML, chartHTML, bindChart, resetChart: () => { sel = null; } };
})();
