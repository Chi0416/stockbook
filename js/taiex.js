


















const Taiex = (() => {
  const NAME = 'taiex';
  const W = 1000;
  const H = 400;
  const VH = 90;
  const VTOP = 26;
  const BARS = 20;
  const dlg = typeof document !== 'undefined' ? document.getElementById('taiex-sheet') : null;


  let data = typeof TAIEX_DATA !== 'undefined' ? TAIEX_DATA : null;
  const charts = {};
  const sels = {};
  const KINDS = {
    chips: [['total', '合計'], ['foreign', '外資'], ['trust', '投信'], ['dealer', '自營商']],
    margin: [['loan', '融資'], ['short', '融券'], ['ratio', '維持率']],
  };
  const kinds = { chips: 'total', margin: 'loan' };



  const file = U.dataFile(NAME, {
    preset: data,
    lazy: true,
    set: next => { data = next; },
  });
  const load = file.load;
  file.onChange(() => refresh());
  const need = file.check;



  function bars(d = data) {
    if (!d) return [];
    const all = d.days.map(r => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], amount: r[5] }));
    const avg = (i, n) => (i + n <= all.length ? all.slice(i, i + n).reduce((s, b) => s + b.close, 0) / n : null);
    return all.slice(0, BARS).map((b, i) => ({ ...b, ma5: avg(i, 5), ma20: avg(i, 20), prev: all[i + 1]?.close ?? null })).reverse();
  }

  function minutes(d = data) {
    const it = d?.intraday;
    if (!it || !Array.isArray(it.points) || !it.points.length) return null;
    const pts = it.points.map(([value, cum], i) => {
      const m = 9 * 60 + i;
      return { time: `${U.pad2(Math.floor(m / 60))}:${U.pad2(m % 60)}`, value, amount: cum / 100, minute: (cum - (i ? it.points[i - 1][1] : 0)) / 100 };
    });
    return { date: it.date, prev: it.prev, pts };
  }


  function chips(d = data) {
    return (Array.isArray(d?.chips) ? d.chips : []).map(r => ({ date: r[0], foreign: r[1], trust: r[2], dealer: r[3], total: r[4] }));
  }


  function ratios(d = data) {
    return (Array.isArray(d?.ratio) ? d.ratio : []).map(r => ({ date: r[0], ratio: r[1] }));
  }




  const COST_NAMES = { avg: '平均成本法', adds: '只看加碼日', lifo: '後進先出', fifo: '先進先出' };
  function cost(d = data) {
    if (!d?.cost) return null;
    return { ...d.cost, rows: d.cost.rows.map(([key, c, ratio, line]) => ({ key, name: COST_NAMES[key], cost: c, ratio, line })) };
  }


  const CALLS = [['上市', 0.6], ['上櫃', 0.5]];
  const callPrices = price => CALLS.map(([market, rate]) => ({ market, rate, price: price * rate * 1.3, drop: (1 - rate * 1.3) * 100 }));
  let callInput = '';


  const room = r => Math.max(0, (1 - 130 / r) * 100);
  function margin(d = data) {
    return (Array.isArray(d?.margin) ? d.margin : []).map(r => ({ date: r[0], loan: r[1], loanChg: r[2], short: r[3], shortChg: r[4] }));
  }


  const f = v => U.round(v, 1);
  const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;
  const idx = v => U.fmtNum(U.round(v, 2), 2);
  const yi = v => `${U.fmtNum(U.round(v, 0))} 億`;
  const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${idx(Math.abs(n))}`;
  const toneOf = (a, b) => (typeof b !== 'number' || a === b ? 'flat' : a > b ? 'up' : 'down');
  const md = d => `${U.fmtDate(d).slice(5)} ${U.weekday(d)}`;

  const change = (v, prev) => {
    if (typeof prev !== 'number' || !(prev > 0)) return '';
    const c = v - prev;
    return `<span class="${toneOf(v, prev).replace('flat', '')}">${signed(c)} ${signed(c / prev * 100)}%</span>`;
  };

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


  function volSVG(list, x, slot, cap = Infinity) {
    const vmax = Math.max(1, ...list.map(v => Math.min(v.amount || 0, cap)));
    const vy = v => H - Math.min(v, vmax) / vmax * (VH - VTOP);
    return `<line class="kc-vbase" x1="0" x2="${W}" y1="${H - VH}" y2="${H - VH}" vector-effect="non-scaling-stroke"/>` +
      list.map((v, i) => (typeof v.amount !== 'number' ? '' :
        `<rect class="kc-vol ${v.tone}" x="${f(x(i) - slot * 0.31)}" y="${f(vy(v.amount))}" width="${f(slot * 0.62)}" height="${f(Math.max(H - vy(v.amount), v.amount ? 1 : 0))}"/>`)).join('');
  }


  function plotHTML(key, label, svg, ticks, axis, { two = false, small = false } = {}) {
    const c = charts[key];
    const cur = sels[key] != null && sels[key] < c.pts.length ? sels[key] : c.latest;
    return `
      <div class="kc-read${two ? ' tx-two' : ''}" aria-live="polite">${c.pts[cur].html}</div>
      <div class="kc-plot tx-plot${small ? ' small' : ''}" tabindex="0" data-chart="${key}" data-i="${cur}" role="img" aria-label="${U.esc(label)}；左右鍵換${key === 'day' ? '時間' : '日期'}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>
        ${ticks}
        <span class="kc-mark">${markHTML(key, cur)}</span>
      </div>
      <div class="kc-axis">${axis}</div>`;
  }


  function dayHTML(m) {
    const n = m.pts.length;
    const live = m.pts.map((p, i) => ({ ...p, i })).slice(1);
    const top = H - VH;
    const { lo, hi, y } = scale([...live.map(p => p.value), m.prev], top);
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const line = live.map((p, k) => `${k ? 'L' : 'M'}${f(x(p.i))} ${f(y(p.value))}`).join('');
    const yp = f(y(m.prev));
    const grid = U.ticks(lo, hi).filter(v => y(v) > top * 0.08);
    charts.day = {
      pts: live.map(p => ({
        x: x(p.i),
        y: y(p.value),
        html: `<span class="kc-date">${p.time}</span><span><b>${idx(p.value)}</b></span>${change(p.value, m.prev)}<span>成交 ${yi(p.amount)}</span>`,
        vol: `這一分鐘 <b>${U.fmtNum(U.round(p.minute, 1), 1)}</b> 億`,
      })),
      latest: live.length - 1,
    };
    const vols = m.pts.map((p, i) => ({ amount: i ? p.minute : null, tone: toneOf(p.value, m.pts[i - 1]?.value) }));

    const cap = Math.max(...m.pts.slice(2, -1).map(p => p.minute), 0) || Infinity;
    const at = t => m.pts.findIndex(p => p.time === t);
    const axis = [['09:00', 'first'], ['10:00', ''], ['11:00', ''], ['12:00', ''], ['13:30', 'last']]
      .filter(([t]) => at(t) >= 0)
      .map(([t, cls]) => (cls === 'last' ? `<span class="last">${t}</span>` : `<span${cls ? ` class="${cls}"` : ''} style="left:${pct(cls ? 0 : x(at(t)), W)}">${t}</span>`)).join('');
    const svg = `
      <defs>
        <clipPath id="tx-up"><rect x="0" y="0" width="${W}" height="${yp}"/></clipPath>
        <clipPath id="tx-down"><rect x="0" y="${yp}" width="${W}" height="${f(H - yp)}"/></clipPath>
      </defs>
      ${gridSVG(grid, y)}
      <line class="kc-level" x1="0" x2="${W}" y1="${yp}" y2="${yp}" vector-effect="non-scaling-stroke"/>
      ${volSVG(vols, x, slot, cap)}
      <path class="tx-line up" d="${line}" clip-path="url(#tx-up)" vector-effect="non-scaling-stroke"/>
      <path class="tx-line down" d="${line}" clip-path="url(#tx-down)" vector-effect="non-scaling-stroke"/>`;
    return plotHTML('day', `加權指數 ${U.fmtDate(m.date)} 當日走勢，虛線是前一天收盤 ${idx(m.prev)}，下面是每分鐘的成交金額`, svg, tickHTML(grid, y), axis);
  }


  function kHTML(list) {
    const n = list.length;
    const top = H - VH;
    const { lo, hi, y } = scale([...list.flatMap(b => [b.high, b.low]), ...list.flatMap(b => [b.ma5, b.ma20]).filter(v => v !== null)], top);
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const bw = slot * 0.62;
    const grid = U.ticks(lo, hi).filter(v => y(v) > top * 0.08);
    const tone = b => toneOf(b.close, b.open);
    const candles = list.map((b, i) => {
      const t = y(Math.max(b.open, b.close));
      const bh = Math.max(y(Math.min(b.open, b.close)) - t, 2);
      return `<line class="kc-wick ${tone(b)}" x1="${f(x(i))}" x2="${f(x(i))}" y1="${f(y(b.high))}" y2="${f(y(b.low))}" vector-effect="non-scaling-stroke"/>` +
        `<rect class="kc-body ${tone(b)}" x="${f(x(i) - bw / 2)}" y="${f(t)}" width="${f(bw)}" height="${f(bh)}"/>`;
    }).join('');
    const ma = (k, cls) => {
      const d = list.reduce((s, b, i) => (b[k] === null ? s : `${s}${s && list[i - 1]?.[k] != null ? 'L' : 'M'}${f(x(i))} ${f(y(b[k]))}`), '');
      return d ? `<path class="kc-ma ${cls}" d="${d}" vector-effect="non-scaling-stroke"/>` : '';
    };
    charts.k = {
      pts: list.map((b, i) => ({
        x: x(i),
        y: b.ma20 === null ? null : y(b.ma20),
        html: `<span class="kc-date">${U.esc(md(b.date))}</span><span>收 <b class="${toneOf(b.close, b.prev).replace('flat', '')}">${idx(b.close)}</b></span>${change(b.close, b.prev)}` +
          `<i class="tx-br"></i><span>開 ${idx(b.open)}</span><span>高 ${idx(b.high)}</span><span>低 ${idx(b.low)}</span>`,
        vol: typeof b.amount === 'number' ? `成交 <b>${U.fmtNum(U.round(b.amount, 0))}</b> 億` : '成交金額',
      })),
      latest: n - 1,
    };
    const vols = list.map(b => ({ amount: b.amount, tone: tone(b) }));
    const axis = `<span class="first" style="left:${pct(x(0) - slot * 0.31, W)}">${U.esc(U.fmtDate(list[0].date).slice(5))}</span>` +
      `<span class="last">${U.esc(U.fmtDate(list[n - 1].date).slice(5))}</span>`;
    const svg = `${gridSVG(grid, y)}${volSVG(vols, x, slot)}${candles}${ma('ma5', 'm5')}${ma('ma20', 'm20')}`;
    return `<div class="kc-legend"><span><i class="kc-key m5"></i>週線</span><span><i class="kc-key"></i>月線</span></div>` +
      plotHTML('k', `加權指數日 K 線，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list[n - 1].date)}，共 ${n} 天，黃線是週線、藍線是月線，下面是每天的成交金額`, svg, tickHTML(grid, y), axis, { two: true });
  }


  function markHTML(key, i) {
    const p = charts[key].pts[i];
    return `<span class="kc-cross" style="left:${pct(p.x, W)}"></span>` +
      (p.y === null ? '' : `<span class="kc-mdot${key === 'day' ? ' tx-dot' : ''}" style="left:${pct(p.x, W)};top:${pct(p.y, H)}"></span>`) +
      (p.vol ? `<span class="kc-vlabel" style="top:${pct(H - VH, H)}">${p.vol}</span>` : '');
  }
  function select(plot, i) {
    const c = charts[plot.dataset.chart];
    if (!c) return;
    i = Math.max(0, Math.min(c.pts.length - 1, i));
    sels[plot.dataset.chart] = i === c.latest ? null : i;
    if (String(i) === plot.dataset.i) return;
    plot.dataset.i = i;
    plot.querySelector('.kc-mark').innerHTML = markHTML(plot.dataset.chart, i);
    plot.previousElementSibling.innerHTML = c.pts[i].html;
  }

  const DAY_NOTE = '<p>最近一個交易日 9:00 到 13:30，每分鐘一點。比前一天收盤（虛線）高的那段是紅色、低的是綠色。</p>' +
    '<p>下面是每一分鐘的成交金額，讀數的「成交」是到那一分鐘為止的累計。這是 13:30 以前的整股成交，比日 K 線的成交金額少一點（沒有盤後定價、零股、鉅額交易）。</p>' +
    '<p>每個工作天收盤後更新，盤中不會跟著跳。</p>';
  const K_NOTE = '<p>最近 20 個交易日的加權指數，紅色是收盤比開盤高、綠色是比較低；黃線是週線（5 日均線）、藍線是月線（20 日均線）。</p>' +
    '<p>下面是每天的成交金額（全天，含盤後定價、零股、鉅額交易），和券商 App 的大盤成交值一樣。</p>' +
    '<p>資料來源是證交所，每個工作天收盤後更新。</p>';
  const CHIPS_NOTE = '<p>上市的三大法人每天的買賣超（買進減賣出），單位是億元；紅色是買超、綠色是賣超。</p>' +
    '<p>上面切換看合計、外資、投信或自營商；點到哪一天，上面寫那天的四個數字。外資含外資自營商，自營商含自行買賣和避險，和券商 App 一樣。</p>' +
    '<p>橫軸和日 K 線是同樣的 20 天，可以上下對照。證交所每個工作天收盤後公布。</p>';
  const MARGIN_NOTE = '<p>上市的融資、融券：線是餘額（融資是億元、融券是張，看左邊的刻度），長條是每天比前一個交易日增減多少，增加紅、減少綠，從圖中間那條線往上下長。</p>' +
    '<p>融資是借錢買股票，融券是借股票來賣。點到哪一天，上面寫那天融資、融券的餘額和增減。</p>' +
    '<p>證交所公布得比較晚，當天的可能要晚上或隔天才有。</p>' +
    '<p><b>維持率</b>是大盤融資維持率（民間算法，和 CMoney、財經M平方一樣）：每一檔融資股的融資餘額 × 收盤價加起來，除以融資金額。上市融資買進當下約 166%，低於 130% 券商會追繳；民間算法到 140% 附近，通常被當成警戒區。</p>' +
    '<p>「再跌」是融資股平均再跌多少會碰到 130%；「約加權」假設融資股和大盤跌得一樣多，實際上融資股（中小型股、題材股、槓桿 ETF）通常跌得比較兇。證交所的整戶維持率（融資、融券合併計算）沒有公開，數字通常比這個高。只算上市。</p>';
  const COST_NOTE = '<p>用最近 60 個交易日上市的融資餘額，推估這段期間新增融資的平均成本：每天融資增加多少，就當成那天用加權指數的收盤借進來。</p>' +
    '<p>融資減少的日子看不出是誰還的，所以用 4 種假設各算一次：平均成本法（減少不改變均價）、只看加碼日（不管減少）、後進先出（最近追高的先出場）、先進先出（最早進場的先出場）。</p>' +
    '<p>維持率 ≈ 166.67%（上市融資買進當下）× 現在加權 ÷ 平均成本；130% 線是平均成本 × 0.78，加權跌到這裡，這批融資平均會碰到追繳。</p>' +
    '<p>這段期間融資減少的比增加的多（淨減）時，平均成本法、後進先出、先進先出會把新增的都扣光，寫「這段期間新增的都還掉了」，只剩只看加碼日有數字。</p>' +
    '<p>只是推估：用加權指數代替融資股的成本，融資股通常跌得比大盤兇；用收盤代表當天的買進價；融資餘額是淨額，同一天有人斷頭也有人加碼；只算上市。實際的維持率看上面「融資融券」的維持率。</p>';
  const CALL_NOTE = '<p>融資買進後，股價跌到「追繳價」維持率就是 130%，券商會在收盤後通知，2 個營業日內要補繳，不然 T+3 處分（斷頭）。</p>' +
    '<p>上市融資 6 成：追繳價 = 買進價 × 0.78（跌約 22%）；上櫃融資 5 成：追繳價 = 買進價 × 0.65（跌約 35%）。也可以用 融資金額 × 1.3 ÷ 股數 算。</p>' +
    '<p>券商實際是看整戶擔保維持率（融資、融券合併，不同股票的盈虧可以互抵），這裡只算單一檔。打的價格不會存起來。</p>';
  const head = (title, note) => `<h3 class="section-head"><span class="sec-name">${title}</span>${Note.btn(title, note)}</h3>`;

  const segHTML = (list, label) => `<div class="seg tx-seg n${KINDS[list].length}" role="group" aria-label="${label}">` +
    KINDS[list].map(([k, t]) => `<button type="button" data-act="kind" data-list="${list}" data-value="${k}" aria-pressed="${kinds[list] === k}">${t}</button>`).join('') + '</div>';
  const toneCls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const tone = v => (toneCls(v) ? ` ${toneCls(v)}` : '');
  const int = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${U.fmtNum(Math.abs(n))}`;

  const readNum = (on, text, v) => (on ? `<b class="${toneCls(v)}">${text}</b>` : `<span class="${toneCls(v)}">${text}</span>`);

  const lateNote = rows => (rows.length && rows[0].date < data.date ? `<p class="trend-note">${U.esc(md(data.date))} 的還沒公布，公布後會補上</p>` : '');

  const axisOf = (list, x, slot) => `<span class="first" style="left:${pct(x(0) - slot * 0.31, W)}">${U.esc(U.fmtDate(list[0].date).slice(5))}</span>` +
    `<span class="last">${U.esc(U.fmtDate(list.at(-1).date).slice(5))}</span>`;
  const zeroSVG = y0 => `<line class="tx-zero" x1="0" x2="${W}" y1="${f(y0)}" y2="${f(y0)}" vector-effect="non-scaling-stroke"/>`;

  const barSVG = (cx, w, y0, y1, cls) => `<rect class="tx-bar${cls}" x="${f(cx - w / 2)}" y="${f(Math.min(y0, y1))}" width="${f(w)}" height="${f(Math.max(Math.abs(y1 - y0), 1))}"/>`;


  function chipsHTML(list) {
    const rows = chips();
    const title = head('三大法人買賣超（億）', CHIPS_NOTE);
    if (!rows.length || !list.length) return `${title}<p class="trend-note">還沒有三大法人的資料</p>`;
    const by = new Map(rows.map(r => [r.date, r]));
    const k = kinds.chips;
    const n = list.length;
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const vals = list.map(b => by.get(b.date)?.[k] ?? null);
    const nums = vals.filter(v => v !== null);
    let lo = Math.min(0, ...nums);
    let hi = Math.max(0, ...nums);
    const pad = (hi - lo || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const y = v => H - (v - lo) / (hi - lo) * H;
    const grid = U.ticks(lo, hi).filter(v => v !== 0 && y(v) > H * 0.08);
    const read = (b, r) => (!r ? `<span class="kc-date">${U.esc(md(b.date))}</span><span>還沒公布</span>` :
      `<span class="kc-date">${U.esc(md(b.date))}</span><span>合計 ${readNum(k === 'total', signed(r.total), r.total)}</span><i class="tx-br"></i>` +
      KINDS.chips.slice(1).map(([key, t]) => `<span>${t} ${readNum(k === key, signed(r[key]), r[key])}</span>`).join(''));
    charts.chips = { pts: list.map((b, i) => ({ x: x(i), y: null, html: read(b, by.get(b.date)), vol: null })), latest: n - 1 };
    const svg = `${gridSVG(grid, y)}${zeroSVG(y(0))}${vals.map((v, i) => (v === null ? '' : barSVG(x(i), slot * 0.62, y(0), y(v), tone(v)))).join('')}`;
    const name = KINDS.chips.find(([key]) => key === k)[1];
    return `${title}${segHTML('chips', '三大法人')}${lateNote(rows)}` +
      plotHTML('chips', `三大法人${name}買賣超，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，紅色買超、綠色賣超`, svg, tickHTML(grid, y), axisOf(list, x, slot), { two: true, small: true });
  }


  function ratioHTML(list, title) {
    const rows = ratios();
    const top = `${title}${segHTML('margin', '融資融券')}`;
    if (!rows.length || !list.length) return `${top}<p class="trend-note">還沒有維持率的資料</p>`;
    const by = new Map(rows.map(r => [r.date, r.ratio]));
    const close = new Map(list.map(b => [b.date, b.close]));
    const n = list.length;
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const vals = list.map(b => by.get(b.date) ?? null);
    const nums = vals.filter(v => v !== null);
    let lo = Math.min(125, ...nums);
    let hi = Math.max(170, ...nums);
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const y = v => H - (v - lo) / (hi - lo) * H;
    const line = vals.reduce((d, v, i) => (v === null ? d : `${d}${d && vals[i - 1] !== null ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`), '');
    const LEVELS = [[130, '130% 追繳', ' warn'], [140, '140% 警戒', ''], [166.67, '166% 買進', '']];
    const levels = LEVELS.map(([v, , cls]) => `<line class="tx-level${cls}" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('');
    const labels = LEVELS.map(([v, t]) => `<span class="kc-tick" style="top:${pct(y(v), H)}">${t}</span>`).join('');
    const read = (b, i) => {
      const r = vals[i];
      if (r === null) return `<span class="kc-date">${U.esc(md(b.date))}</span><span>還沒公布</span>`;
      const prev = vals.slice(0, i).reverse().find(v => v !== null);
      const chg = typeof prev === 'number' ? ` <span class="${toneCls(r - prev)}">${signed(r - prev)}</span>` : '';
      const left = room(r);
      return `<span class="kc-date">${U.esc(md(b.date))}</span><span>維持率 <b>${U.fmtNum(U.round(r, 1), 1)}%</b>${chg}</span><i class="tx-br"></i>` +
        (left > 0 ? `<span>再跌 <b>${U.fmtNum(U.round(left, 1), 1)}%</b> 碰 130%</span><span>約加權 ${U.fmtNum(Math.round(close.get(b.date) * 130 / r))}</span>`
          : '<span><b class="down">已經低於 130%</b></span>');
    };
    charts.margin = { pts: list.map((b, i) => ({ x: x(i), y: vals[i] === null ? null : y(vals[i]), html: read(b, i), vol: null })), latest: n - 1 };
    const svg = `${levels}<path class="tx-bal" d="${line}" vector-effect="non-scaling-stroke"/>`;
    return `${top}${lateNote(rows)}` +
      plotHTML('margin', `大盤融資維持率，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，虛線是 130%、140%、166%`, svg, labels, axisOf(list, x, slot), { two: true, small: true });
  }


  function costHTML() {
    const c = cost();
    const title = head('融資成本推估', COST_NOTE);
    if (!c) return `${title}<p class="trend-note">${data?.cost === null ? '融資餘額的資料還不夠' : '融資成本推估還沒更新，每個工作天收盤後會更新'}</p>`;
    const n0 = v => (v === null ? '—' : U.fmtNum(Math.round(v)));
    const yi1 = v => U.fmtNum(U.round(v, 1), 1);
    const net = c.end - c.start;
    return `${title}
      <p class="tx-sub">${U.esc(U.fmtDate(c.from).slice(5))}～${U.esc(U.fmtDate(c.to).slice(5))} 融資加碼 ${yi1(c.added)} 億、減少 ${yi1(c.reduced)} 億，淨${net >= 0 ? '增' : '減'} ${yi1(Math.abs(net))} 億；加權 ${idx(c.now)}</p>
      <table class="ev-table tx-table">
        <thead><tr><th>假設</th><th class="num">平均成本</th><th class="num">維持率</th><th class="num">130% 線</th></tr></thead>
        <tbody>${c.rows.map(r => `<tr><td>${r.name}</td>${r.cost === null ? '<td colspan="3" class="num tx-empty">這段期間新增的都還掉了</td>'
          : `<td class="num">${n0(r.cost)}</td><td class="num">${U.fmtNum(Math.round(r.ratio))}%</td><td class="num">${n0(r.line)}</td>`}</tr>`).join('')}</tbody>
      </table>`;
  }


  function callRows() {
    const price = U.parseNum(callInput);
    if (!(price > 0)) return '<tr><td colspan="3" class="tx-empty">打買進價，算出碰到 130% 的價格</td></tr>';
    return callPrices(price).map(r => `<tr><td>${r.market}（融資 ${r.rate * 10} 成）</td><td class="num total">${U.fmtNum(U.round(r.price, 2), 2)}</td><td class="num">跌 ${U.fmtNum(Math.round(r.drop))}%</td></tr>`).join('');
  }
  function callHTML() {
    return `${head('個股追繳價試算', CALL_NOTE)}
      <label class="ma-price tx-call"><span>融資買進價</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${U.esc(callInput)}" data-act="call-price" aria-label="融資買進價"></label>
      <table class="ev-table tx-table">
        <thead><tr><th>市場</th><th class="num">追繳價</th><th class="num">跌幅</th></tr></thead>
        <tbody class="tx-call-out">${callRows()}</tbody>
      </table>`;
  }



  function marginHTML(list) {
    const title = head('融資融券', MARGIN_NOTE);
    if (kinds.margin === 'ratio') return ratioHTML(list, title);
    const rows = margin();
    if (!rows.length || !list.length) return `${title}<p class="trend-note">還沒有融資融券的資料</p>`;
    const by = new Map(rows.map(r => [r.date, r]));
    const loan = kinds.margin === 'loan';
    const [vk, ck] = loan ? ['loan', 'loanChg'] : ['short', 'shortChg'];
    const unit = loan ? '億' : '張';
    const n = list.length;
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const vals = list.map(b => by.get(b.date)?.[vk] ?? null);
    const chgs = list.map(b => by.get(b.date)?.[ck] ?? null);
    const { lo, hi, y } = scale(vals.filter(v => v !== null), H);
    const grid = U.ticks(lo, hi).filter(v => y(v) > H * 0.08);
    const line = vals.reduce((d, v, i) => (v === null ? d : `${d}${d && vals[i - 1] !== null ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`), '');
    const amax = Math.max(1, ...chgs.filter(v => v !== null).map(Math.abs));
    const mid = H / 2;
    const cy = v => mid - v / amax * mid * 0.94;
    const read = (b, r) => (!r ? `<span class="kc-date">${U.esc(md(b.date))}</span><span>還沒公布</span>` :
      `<span class="kc-date">${U.esc(md(b.date))}</span><span>融資餘額 ${readNum(loan, idx(r.loan), 0)} 億</span><span>增減 <span class="${toneCls(r.loanChg)}">${signed(r.loanChg)}</span> 億</span><i class="tx-br"></i>` +
      `<span>融券餘額 ${readNum(!loan, U.fmtNum(r.short), 0)} 張</span><span>增減 <span class="${toneCls(r.shortChg)}">${int(r.shortChg)}</span> 張</span>`);
    charts.margin = {
      pts: list.map((b, i) => ({
        x: x(i),
        y: vals[i] === null ? null : y(vals[i]),
        html: read(b, by.get(b.date)),
        vol: null,
      })),
      latest: n - 1,
    };
    const svg = `${gridSVG(grid, y)}
      ${zeroSVG(mid)}
      ${chgs.map((v, i) => (v === null ? '' : barSVG(x(i), slot * 0.62, mid, cy(v), tone(v)))).join('')}
      <path class="tx-bal" d="${line}" vector-effect="non-scaling-stroke"/>`;
    const ticks = tickHTML(grid, y);
    return `${title}${segHTML('margin', '融資融券')}${lateNote(rows)}` +
      plotHTML('margin', `${loan ? '融資' : '融券'}餘額（${unit}），${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，長條是每天的增減`, svg, ticks, axisOf(list, x, slot), { two: true, small: true });
  }

  function render() {
    if (!dlg?.open) return;
    const body = dlg.querySelector('.sheet-body');
    if (!file.ready()) {
      body.innerHTML = `<p class="sheet-status">${file.waiting('下載不了大盤資料（連上網路後會再試）', '大盤資料下載中…')}</p>`;
      return;
    }
    const m = minutes();
    const list = bars();
    body.innerHTML = `
      ${head(m ? `當日走勢 ${U.esc(md(m.date))}` : '當日走勢', DAY_NOTE)}
      ${m ? dayHTML(m) : `<p class="trend-note">${U.esc(md(data.date))} 的走勢還沒出來，晚上會更新</p>`}
      ${head(`日 K 線（${list.length} 天）`, K_NOTE)}
      ${kHTML(list)}
      ${chipsHTML(list)}
      ${marginHTML(list)}
      ${costHTML()}
      ${callHTML()}`;
  }

  function init() {
    if (!dlg) return;
    const body = dlg.querySelector('.sheet-body');
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

    const nearest = (plot, clientX) => {
      const r = plot.getBoundingClientRect();
      const at = (clientX - r.left) / r.width * W;
      const { pts } = charts[plot.dataset.chart];
      return pts.reduce((best, p, i) => (Math.abs(p.x - at) < Math.abs(pts[best].x - at) ? i : best), 0);
    };
    const follow = e => {
      const plot = e.target.closest('.tx-plot');
      if (plot && charts[plot.dataset.chart]) select(plot, nearest(plot, e.clientX));
    };

    body.addEventListener('click', e => {
      const btn = e.target.closest('[data-act="kind"]');
      if (!btn) return;
      kinds[btn.dataset.list] = btn.dataset.value;
      render();
      body.querySelector(`[data-act="kind"][data-list="${btn.dataset.list}"][data-value="${btn.dataset.value}"]`)?.focus({ preventScroll: true });
    });

    body.addEventListener('input', e => {
      if (!e.target.matches('[data-act="call-price"]')) return;
      callInput = e.target.value;
      const out = body.querySelector('.tx-call-out');
      if (out) out.innerHTML = callRows();
    });
    body.addEventListener('pointermove', follow);
    body.addEventListener('pointerdown', follow);
    body.addEventListener('pointerout', e => {
      const plot = e.target.closest('.tx-plot');
      if (plot && !plot.contains(e.relatedTarget) && e.pointerType === 'mouse') select(plot, charts[plot.dataset.chart].latest);
    });
    body.addEventListener('keydown', e => {
      const plot = e.target.closest('.tx-plot');
      if (!plot || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      select(plot, Number(plot.dataset.i) + (e.key === 'ArrowLeft' ? -1 : 1));
    });
  }

  function open() {
    if (!dlg) return;
    kinds.chips = 'total';
    kinds.margin = 'loan';
    callInput = '';
    Object.keys(sels).forEach(k => { sels[k] = null; });
    need();
    if (!dlg.open) dlg.showModal();
    render();
  }


  function refresh() {
    render();
  }

  return { init, open, load, need, refresh, bars, minutes, chips, margin, ratios, room, cost, callPrices };
})();
